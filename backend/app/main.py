import asyncio
import os
import json
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import db
from .agent.agent import run_chat
from .agent.llm import OpenAICompatLLM
from .services import catalog, inquiries as inq, visit_plan
from .services.hours import now_tehran
from .services.text import split_budget


WARM_INTERVAL = float(os.environ.get("TOROB_WARM_INTERVAL_S", "240"))


async def _warm_loop():
    """Keep the catalog's hot pages resident: after a long idle the host evicts them and the next user pays 3-5 s."""
    loop = asyncio.get_running_loop()
    while True:
        await asyncio.sleep(WARM_INTERVAL)
        try:
            await loop.run_in_executor(None, db.warm_cache)
        except Exception:
            pass  # warming is best-effort


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.connect().close()  # creates state tables (local: in the catalog file; prod: in the attached state DB)
    asyncio.get_running_loop().run_in_executor(None, db.warm_cache)  # background: don't delay startup
    inq.LOOP = asyncio.get_running_loop()
    task = asyncio.create_task(inq.timeout_loop())
    warm = asyncio.create_task(_warm_loop())
    yield
    task.cancel()
    warm.cancel()


app = FastAPI(title="Torob In-Person Shopping Assistant API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def get_con():
    con = db.connect()
    try:
        yield con
    finally:
        con.close()


Con = Annotated[object, Depends(get_con)]


def _origin(lat: float | None, lon: float | None):
    return (lat, lon) if lat is not None and lon is not None else None


# ------------------------------------------------------------------ ops
@app.get("/healthz")
@app.get("/api/healthz")  # reachable through the public Next proxy in the single-container deploy
def healthz():
    return {"ok": True}


@app.get("/readyz")
@app.get("/api/readyz")
def readyz(con: Con):
    n = con.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    return {"ok": n > 0, "products": n, "tehran_time": now_tehran().isoformat()}


# ------------------------------------------------------------------ products
@app.get("/api/search/products", tags=["products"])
def search(con: Con, q: str | None = None, category: str | None = None, brand: str | None = None,
           price_min: int | None = None, price_max: int | None = None, has_shops: bool = True,
           limit: int = Query(20, le=60), offset: int = 0):
    """Search products. If the query itself contains a budget ('زیر ۳ میلیون') it is parsed and applied."""
    b, q = split_budget(q or "")
    pmax = price_max if price_max is not None else b.get("max")
    pmin = price_min if price_min is not None else b.get("min")
    res = catalog.search_products(con, q, category, brand, pmin, pmax, has_shops, limit, offset)
    res["facets"] = catalog.facets(con, q, category)
    res["applied"] = {"relaxed": res.get("relaxed", False), "price_min": pmin, "price_max": pmax, "budget_from_query": bool(b)}
    return res


@app.get("/api/products/{product_id}", tags=["products"])
def product(product_id: str, con: Con):
    p = catalog.get_product(con, product_id)
    if not p:
        raise HTTPException(404, "محصول پیدا نشد")
    return p


class CompareIn(BaseModel):
    ids: list[str] = Field(min_length=2, max_length=4)


@app.post("/api/products/compare", tags=["products"])
def compare(body: CompareIn, con: Con):
    return catalog.compare_products(con, body.ids)


@app.get("/api/products/{product_id}/similar", tags=["products"])
def similar(product_id: str, con: Con, limit: int = 8):
    return {"items": catalog.similar_products(con, product_id, limit)}


@app.get("/api/products/{product_id}/shops", tags=["shops"])
def product_shops(product_id: str, con: Con, lat: float | None = None, lon: float | None = None,
                  radius_km: float | None = None, installment: bool = False, provider: str | None = None,
                  open_now: bool = False, fast_delivery: bool = False, price_max: int | None = None,
                  include_category_only: bool = True, sort: str = "best", limit: int = Query(40, le=100)):
    """Shops for a product. `listed` have a registered offer; `category_only` merely work in the category (ask first)."""
    if not catalog.get_product(con, product_id):
        raise HTTPException(404, "محصول پیدا نشد")
    return catalog.find_shops(con, [product_id], _origin(lat, lon), radius_km, installment, provider, open_now,
                              fast_delivery, price_max, include_category_only, sort, limit)


# ------------------------------------------------------------------ shops / malls
@app.get("/api/shops/{shop_id}", tags=["shops"])
def shop(shop_id: str, con: Con, lat: float | None = None, lon: float | None = None):
    s = catalog.get_shop(con, shop_id, _origin(lat, lon))
    if not s:
        raise HTTPException(404, "فروشگاه پیدا نشد")
    return s


@app.get("/api/malls", tags=["malls"])
def malls(con: Con, limit: int = 30):
    return {"items": catalog.list_malls(con, limit)}


@app.get("/api/malls/{mall_key}", tags=["malls"])
def mall(mall_key: str, con: Con):
    m = catalog.mall_directory(con, mall_key)
    if not m:
        raise HTTPException(404, "پاساژ پیدا نشد")
    return m


@app.get("/api/categories/top", tags=["products"])
def top_categories(con: Con, limit: int = 24):
    rows = con.execute("SELECT category, COUNT(*) n FROM products WHERE shop_count>=2 AND category IS NOT NULL "
                       "GROUP BY category ORDER BY n DESC LIMIT ?", (limit,)).fetchall()
    return {"items": [{"name": r[0], "multi_shop_products": r[1]} for r in rows]}


# ------------------------------------------------------------------ sessions & inquiries
class SessionPatch(BaseModel):
    state: dict


@app.put("/api/sessions/{session_id}", tags=["sessions"])
def put_session(session_id: str, body: SessionPatch, con: Con):
    cur = inq.get_session(con, session_id) or {}
    cur.update(body.state)
    inq.save_session(con, session_id, cur)
    return cur


@app.get("/api/sessions/{session_id}", tags=["sessions"])
def get_session(session_id: str, con: Con):
    return inq.get_session(con, session_id) or {}


class InquiryIn(BaseModel):
    session_id: str
    shop_ids: list[str] = Field(min_length=1, max_length=5)
    product_id: str | None = None
    questions: list[str] = ["stock", "price"]
    note: str | None = None
    timeout_s: int | None = Field(None, ge=10, le=3600)


@app.get("/api/inquiry-questions", tags=["inquiries"])
def inquiry_questions():
    return {"items": [{"key": k, "text": t} for k, t in inq.QUESTIONS.items()]}


@app.post("/api/inquiries", tags=["inquiries"])
def create_inquiries(body: InquiryIn, con: Con):
    created = inq.create(con, body.session_id, body.shop_ids, body.product_id, body.questions, body.timeout_s, body.note)
    return {"items": [inq.view(con, c["id"]) for c in created]}


@app.get("/api/sessions/{session_id}/inquiries", tags=["inquiries"])
def session_inquiries(session_id: str, con: Con):
    inq.expire_overdue(con)
    return {"items": inq.list_for_session(con, session_id)}


@app.get("/api/sessions/{session_id}/events", tags=["inquiries"])
async def session_events(session_id: str, request: Request):
    """Server-sent events: inquiry status changes in real time."""
    q = inq.subscribe(session_id)

    async def gen():
        try:
            yield "retry: 3000\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            inq.unsubscribe(session_id, q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ------------------------------------------------------------------ seller side
def _check(shop_id: str, token: str):
    if not inq.valid_shop_token(shop_id, token):
        raise HTTPException(403, "لینک نامعتبر است")


class AnswerIn(BaseModel):
    available: bool | None = None
    price: int | None = Field(None, ge=0)
    message: str | None = Field(None, max_length=300)
    closes_at: str | None = None
    installment: bool | None = None


@app.get("/api/seller/{shop_id}/{token}/inquiries", tags=["seller"])
def seller_list(shop_id: str, token: str, con: Con):
    _check(shop_id, token)
    shop = catalog.get_shop(con, shop_id)
    return {"shop": {"shop_id": shop_id, "name": shop["name"], "mall": shop["mall"], "unit": shop["unit"]},
            "items": inq.seller_inbox(con, shop_id)}


@app.post("/api/seller/{shop_id}/{token}/inquiries/{inquiry_id}/answer", tags=["seller"])
def seller_answer(shop_id: str, token: str, inquiry_id: str, body: AnswerIn, con: Con):
    _check(shop_id, token)
    r = con.execute("SELECT shop_id FROM inquiries WHERE id=?", (inquiry_id,)).fetchone()
    if not r or r[0] != shop_id:
        raise HTTPException(404, "پرسش پیدا نشد")
    v = inq.answer(con, inquiry_id, body.available, body.price, body.message, body.closes_at, body.installment)
    if not v:
        raise HTTPException(409, "قبلاً پاسخ داده شده است")
    return v


@app.get("/api/demo/seller-link/{shop_id}", tags=["seller"])
def demo_seller_link(shop_id: str):
    """Demo helper: the web inbox link a team member opens on a second phone to play this shop's seller."""
    return {"path": f"/seller/{shop_id}/{inq.shop_token(shop_id)}"}


# ------------------------------------------------------------------ visit plan
class PlanIn(BaseModel):
    session_id: str
    product_id: str | None = None
    shop_ids: list[str] = Field(default_factory=list, max_length=6, description="extra shops without a seller answer")
    lat: float | None = None
    lon: float | None = None
    order: list[str] | None = Field(None, description="shop_ids in the order the user wants")


@app.post("/api/visit-plan", tags=["plan"])
def make_visit_plan(body: PlanIn, con: Con):
    """Plan built from sellers' confirmations ("available"), newest answer per shop; optional unconfirmed shop_ids."""
    stops, seen = [], set()
    for i in inq.list_for_session(con, body.session_id):
        sid = i["shop"]["shop_id"] if i["shop"] else None
        if (not sid or sid in seen or i["status"] != "answered" or (i["answer"] or {}).get("available") is False
                or (body.product_id and i["product"] and i["product"]["product_id"] != body.product_id)):
            continue
        seen.add(sid)
        a = i["answer"] or {}
        stops.append({"shop_id": sid, "confirmed": True, "price": a.get("price"), "closes_at": a.get("closes_at"), "inquiry_id": i["id"]})
    for sid in body.shop_ids:
        if sid not in seen:
            seen.add(sid)
            stops.append({"shop_id": sid, "confirmed": False})
    if not stops:
        raise HTTPException(409, "هنوز فروشگاهی «موجود است» نگفته است.")
    sess = inq.get_session(con, body.session_id) or {}
    loc = sess.get("location") or {}
    origin = (body.lat if body.lat is not None else loc.get("lat", catalog.DEFAULT_LOC[0]),
              body.lon if body.lon is not None else loc.get("lon", catalog.DEFAULT_LOC[1]))
    return visit_plan.build(con, origin, stops, body.order)


# ------------------------------------------------------------------ chat agent (SSE)
class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=600)


_chat_hits: dict[str, list[float]] = {}


def _rate_ok(key: str, limit: int = 20, per: float = 60.0) -> bool:
    import time
    now = time.time()
    hits = [t for t in _chat_hits.get(key, []) if now - t < per]
    ok = len(hits) < limit
    if ok:
        hits.append(now)
    _chat_hits[key] = hits
    return ok


@app.post("/api/chat/{session_id}", tags=["chat"])
async def chat(session_id: str, body: ChatIn, request: Request):
    """SSE stream of {type: text|tool_status|block|degraded|done}. Blocks: product_cards, comparison_table, shop_list,
    chips, inquiry_proposal, inquiry_status. Falls back to rule-based search when the LLM is unavailable."""
    if not _rate_ok(session_id):
        raise HTTPException(429, "پیام‌ها خیلی سریع است؛ کمی صبر کنید.")

    async def gen():
        try:
            async for ev in run_chat(session_id, body.message):
                yield f"data: {json.dumps(ev, ensure_ascii=False, default=str)}\n\n"
        except Exception as e:  # never leave the client hanging
            yield f"data: {json.dumps({'type': 'error', 'message': 'مشکلی پیش آمد. دوباره امتحان کنید.'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/chat-status", tags=["chat"])
def chat_status():
    l = OpenAICompatLLM()
    from .agent.llm import USAGE
    return {"llm_configured": l.configured, "model": l.s["model"], "base_url": l.s["base_url"], "usage_since_start": USAGE}
