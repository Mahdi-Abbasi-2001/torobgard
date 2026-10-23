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
from .agent.intake import run_intake
from .agent.llm import OpenAICompatLLM
from .services import advisor, campaigns, catalog, converse, discover, inquiries as inq, mission as mission_svc, verify, visit_plan
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
    from .services import bale
    bale_task = asyncio.create_task(bale.poll_loop()) if bale.enabled() else None
    yield
    task.cancel()
    warm.cancel()
    if bale_task:
        bale_task.cancel()


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
def _constraints(raw: str | None) -> list[dict]:
    """need-preset constraints as JSON: [{key, op: >=|<=|has, value}]"""
    if not raw:
        return []
    try:
        cs = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "prefs نامعتبر است")
    out = []
    for c in cs if isinstance(cs, list) else []:
        if isinstance(c, dict) and c.get("key") and c.get("op") in (">=", "<=", "has") and c.get("value") is not None:
            out.append({"key": str(c["key"])[:60], "op": c["op"], "value": c["value"] if c["op"] == "has" else float(c["value"])})
    return out[:4]


@app.get("/api/search/products", tags=["products"])
def search(con: Con, q: str | None = None, category: str | None = None, brand: str | None = None,
           price_min: int | None = None, price_max: int | None = None, has_shops: bool = True,
           limit: int = Query(20, le=60), offset: int = 0, lat: float | None = None, lon: float | None = None,
           when: str | None = Query(None, description="now | 1h | evening | tomorrow | HH:MM: for 'open' availability"),
           prefs: str | None = Query(None, description="need-preset constraints (JSON list); soft: best fits first, with reasons"),
           spec: list[str] = Query([], description="hard spec filters 'key=value' (values from /api/spec-facets)"),
           near_only: bool = False, installment_only: bool = False, open_only: bool = False,
           sort: str | None = Query(None, pattern="^(price|near)$")):
    """Search products. If the query itself contains a budget ('زیر ۳ میلیون') it is parsed and applied.
    Each item carries `near` (shops listing it, within 15 min walk, open at `when`, with installments). Purchase conditions
    (near_only / installment_only / open_only), spec filters, need presets and sort are applied over the top candidates."""
    b, q = split_budget(q or "")
    pmax = price_max if price_max is not None else b.get("max")
    pmin = price_min if price_min is not None else b.get("min")
    cons = _constraints(prefs)
    specs_eq = [tuple(x.split("=", 1)) for x in spec if "=" in x][:4]
    cond = {"near": near_only, "installment": installment_only, "open": open_only}
    origin = _origin(lat, lon)
    at, at_label = discover.arrival_time(when)
    heavy = bool(cons or specs_eq or any(cond.values()) or sort)
    if heavy:
        res = catalog.search_products(con, q, category, brand, pmin, pmax, has_shops, catalog.RERANK_WINDOW, 0)
        ranked = discover.refine(con, res["items"], constraints=cons, specs_eq=specs_eq, cond=cond, origin=origin, at=at, sort=sort)
        res["capped"] = len(res["items"]) >= catalog.RERANK_WINDOW  # only the top candidates were filtered / re-ranked
        res["total"], res["items"] = len(ranked), ranked[offset:offset + limit]
    else:
        res = catalog.search_products(con, q, category, brand, pmin, pmax, has_shops, limit, offset)
        discover.refine(con, res["items"], origin=origin, at=at)  # adds `near` only
    res["facets"] = catalog.facets(con, q, category)
    res["applied"] = {"relaxed": res.get("relaxed", False), "price_min": pmin, "price_max": pmax, "budget_from_query": bool(b),
                      "prefs": cons, "spec": [list(x) for x in specs_eq], "conditions": cond, "sort": sort, "when": at_label}
    return res


class MissionParseIn(BaseModel):
    text: str = Field(max_length=300)


@app.post("/api/mission/parse", tags=["products"])
def mission_parse(b: MissionParseIn, con: Con):
    """One sentence -> mission slots (what, need, budget, place, when, travel mode, installment). Rule-based; unread slots are null."""
    return mission_svc.parse(con, b.text)


@app.get("/api/category-presets", tags=["products"])
async def category_presets(category: str):
    """Need presets for a category («باتری قوی», «حذف نویز» ...) as spec constraints; LLM-proposed from the category's real
    specs when configured (keys validated), rules otherwise. Cached per category."""
    con = db.connect()
    try:
        return await discover.need_presets(con, category, OpenAICompatLLM())
    finally:
        con.close()


@app.get("/api/spec-facets", tags=["products"])
def category_spec_facets(category: str, con: Con):
    return {"category": category, "items": discover.spec_facets(con, category)}


@app.get("/api/areas", tags=["shops"])
def areas(con: Con):
    """Shopping areas that actually exist in the dataset, with shop counts and a centre point."""
    return {"items": discover.areas(con)}


@app.get("/api/products/{product_id}", tags=["products"])
def product(product_id: str, con: Con):
    p = catalog.get_product(con, product_id)
    if not p:
        raise HTTPException(404, "محصول پیدا نشد")
    return p


class CompareIn(BaseModel):
    ids: list[str] = Field(min_length=2, max_length=4)


@app.get("/api/products/{product_id}/insights", tags=["products"])
def product_insights(product_id: str, con: Con, lat: float | None = None, lon: float | None = None, when: str | None = None):
    """Step 1 helpers for one product: other versions of the same model, a fair-price range from the shops' listings,
    and how available it is near the shopper."""
    if not catalog.get_product(con, product_id):
        raise HTTPException(404, "محصول پیدا نشد")
    at, label = discover.arrival_time(when)
    origin = _origin(lat, lon) or catalog.DEFAULT_LOC
    vs = discover.variants(con, product_id)
    av = discover.availability(con, [product_id] + [v["product_id"] for v in vs], origin, at)
    for v in vs:
        v["near"] = av.get(v["product_id"])
    return {"product_id": product_id, "variants": vs, "fair_price": discover.fair_price(con, product_id),
            "availability": av.get(product_id), "when": label}


class CompareBody(CompareIn):
    lat: float | None = None
    lon: float | None = None


@app.post("/api/products/compare", tags=["products"])
def compare(body: CompareBody, con: Con):
    """Spec rows (differences first) plus insights: the better value per comparable row, per-product strengths,
    cheapest and most available nearby."""
    res = catalog.compare_products(con, body.ids)
    av = discover.availability(con, [p["product_id"] for p in res["products"]], _origin(body.lat, body.lon) or catalog.DEFAULT_LOC)
    res["insights"] = discover.compare_insights(res["products"], res["rows"], av)
    res["availability"] = av
    return res


class AdviseIn(BaseModel):
    product_id: str
    lat: float | None = None
    lon: float | None = None
    when: str | None = None
    need: str | None = Field(None, max_length=120)
    priority: str = Field("balanced", pattern="^(balanced|price|near|trust|now)$")
    budget_max: int | None = None
    installment: bool = False


@app.post("/api/mission/advise", tags=["mission"])
async def mission_advise(body: AdviseIn):
    """Which shops to ask first and why (LLM over the real candidates; the catalogue's own ranking without it)."""
    con = db.connect()
    try:
        if not catalog.get_product(con, body.product_id):
            raise HTTPException(404, "محصول پیدا نشد")
        return await advisor.advise(con, body.product_id, _origin(body.lat, body.lon) or catalog.DEFAULT_LOC, when=body.when, need=body.need,
                                    priority=body.priority, budget_max=body.budget_max, installment=body.installment, llm=OpenAICompatLLM())
    finally:
        con.close()


class VerdictIn(CompareBody):
    need: str | None = Field(None, max_length=200)


@app.post("/api/products/compare/verdict", tags=["products"])
async def compare_verdict(body: VerdictIn):
    """Which one, for this shopper's need. Grounded in the compared specs, prices and nearby availability (LLM when
    configured, rules otherwise)."""
    con = db.connect()
    try:
        res = catalog.compare_products(con, body.ids)
        av = discover.availability(con, [p["product_id"] for p in res["products"]], _origin(body.lat, body.lon) or catalog.DEFAULT_LOC)
        ins = discover.compare_insights(res["products"], res["rows"], av)
    finally:
        con.close()
    if len(res["products"]) < 2:
        raise HTTPException(404, "کالاها پیدا نشد")
    return await discover.compare_verdict(res["products"], res["rows"], ins, av, (body.need or "").strip() or None, OpenAICompatLLM())


@app.get("/api/products/{product_id}/review", tags=["products"])
async def product_review(product_id: str):
    """Short grounded review: pros/cons only from real specs; general reputation (if any) is labelled unverified. Cached."""
    from .services import review
    con = db.connect()
    try:
        r = await review.build(con, product_id, OpenAICompatLLM())
    finally:
        con.close()
    if not r:
        raise HTTPException(404, "محصول پیدا نشد")
    return r


class IdentifyIn(BaseModel):
    image: str = Field(max_length=4_000_000)  # data URL (JPEG/PNG/WebP); the client downsizes to ~1024 px first


@app.post("/api/identify", tags=["products"])
async def identify(body: IdentifyIn):
    """Snap-to-identify: read brand/model/price from a shopper's photo, then return candidate products to confirm.
    The photo is processed in memory and never stored."""
    from .services import identify as ident
    try:
        ident.decode_image(body.image)
    except ValueError as e:
        raise HTTPException(400, str(e))
    try:
        read = await ident.read_photo(OpenAICompatLLM(), body.image)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception:
        raise HTTPException(503, "تشخیص عکس الان ممکن نشد. دوباره امتحان کنید یا نام کالا را بنویسید.")
    con = db.connect()
    try:
        items, query, match = ident.candidates(con, read)
    finally:
        con.close()
    return {"read": read, "query": query, "match": match, "candidates": items}


@app.get("/api/products/{product_id}/similar", tags=["products"])
def similar(product_id: str, con: Con, limit: int = 8):
    return {"items": catalog.similar_products(con, product_id, limit)}


@app.get("/api/products/{product_id}/shops", tags=["shops"])
def product_shops(product_id: str, con: Con, lat: float | None = None, lon: float | None = None,
                  radius_km: float | None = None, installment: bool = False, provider: str | None = None,
                  open_now: bool = False, fast_delivery: bool = False, price_max: int | None = None,
                  include_category_only: bool = True, sort: str = "best", limit: int = Query(40, le=100),
                  when: str | None = Query(None, description="now | 1h | evening | tomorrow | HH:MM: opening state at arrival"),
                  priority: str = Query("balanced", pattern="^(balanced|price|near|trust|now)$")):
    """Shops for a product. `listed` have a registered offer; `category_only` merely work in the category (ask first).
    `zones`: malls/areas where several of these shops sit together (one trip covers them)."""
    if not catalog.get_product(con, product_id):
        raise HTTPException(404, "محصول پیدا نشد")
    at, label = discover.arrival_time(when)
    res = catalog.find_shops(con, [product_id], _origin(lat, lon), radius_km, installment, provider, open_now,
                             fast_delivery, price_max, include_category_only, sort, limit,
                             at=None if not when or when == "now" else at, weights=discover.PRIORITIES[priority])
    fp = discover.fair_price(con, product_id)
    for c in res["listed"]:
        c["offer"]["fair"] = discover.price_verdict(c["offer"]["price"], fp) if c["offer"]["price"] and not c["offer"]["suspicious"] else None
    res["fair_price"], res["when"] = fp, label
    return res


@app.get("/api/products/{product_id}/shops/compare", tags=["shops"])
def compare_shops(product_id: str, con: Con, ids: str = Query(..., description="comma-separated shop ids (2-6)"),
                  lat: float | None = None, lon: float | None = None, when: str | None = None,
                  priority: str = Query("balanced", pattern="^(balanced|price|near|trust|now)$")):
    """Step 3: side by side with winners per row (price, distance, freshness, latest closing, warranty, trust), a score
    breakdown under the chosen priority, and a verdict per priority."""
    shop_ids = [x for x in ids.split(",") if x][:6]
    if not catalog.get_product(con, product_id):
        raise HTTPException(404, "محصول پیدا نشد")
    at, label = discover.arrival_time(when)
    res = discover.compare_shops(con, product_id, shop_ids, _origin(lat, lon), None if not when or when == "now" else at, priority)
    fp = discover.fair_price(con, product_id)
    for c in res["shops"]:
        if c.get("offer") and c["offer"]["price"] and not c["offer"]["suspicious"]:
            c["offer"]["fair"] = discover.price_verdict(c["offer"]["price"], fp)
    res["when"], res["fair_price"] = label, fp
    return res


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


@app.get("/api/where-to-look", tags=["shops"])
def where_to_look(con: Con, q: str, category: str | None = None, lat: float | None = None, lon: float | None = None,
                  hint: str | None = Query(None, max_length=120, description="free-text place for a map search link")):
    """For a product nobody lists: the malls/areas where shops of that kind concentrate (from the dataset's shop locations)."""
    _, q = split_budget(q)  # «کفش زیر ۲ میلیون» -> «کفش»
    r = catalog.where_to_look(con, q, category, _origin(lat, lon))
    if hint:
        r["search_link"] = catalog.maps_search_link(hint)
    return r


@app.get("/api/categories/top", tags=["products"])
def top_categories(con: Con, limit: int = 24):
    rows = con.execute("SELECT category, COUNT(*) n FROM products WHERE shop_count>=2 AND category IS NOT NULL "
                       "GROUP BY category ORDER BY n DESC LIMIT ?", (limit,)).fetchall()
    return {"items": [{"name": r[0], "multi_shop_products": r[1]} for r in rows]}


# ------------------------------------------------------------------ sessions & inquiries
# ------------------------------------------------------------------ accounts (optional username + password)
from .services import auth  # noqa: E402


def _token(request: Request) -> str | None:
    h = request.headers.get("authorization") or ""
    return h[7:].strip() if h.lower().startswith("bearer ") else (request.query_params.get("token") or None)


def _guard(con, session_id: str, request: Request):
    try:
        auth.guard(con, session_id, _token(request))
    except auth.AuthError as e:
        raise HTTPException(e.status, e.message)


class AuthIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)
    session_id: str | None = Field(None, max_length=64, description="this device's anonymous session, adopted/merged into the account")


@app.post("/api/auth/signup", tags=["auth"])
def auth_signup(body: AuthIn, con: Con):
    try:
        user, token = auth.signup(con, body.username, body.password, body.session_id)
    except auth.AuthError as e:
        raise HTTPException(e.status, e.message)
    return {"user": user, "token": token}


@app.post("/api/auth/login", tags=["auth"])
def auth_login(body: AuthIn, request: Request, con: Con):
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "")
    try:
        user, token = auth.login(con, body.username, body.password, body.session_id, ip)
    except auth.AuthError as e:
        raise HTTPException(e.status, e.message)
    return {"user": user, "token": token}


@app.get("/api/auth/me", tags=["auth"])
def auth_me(request: Request, con: Con):
    u = auth.user_for_token(con, _token(request))
    if not u:
        raise HTTPException(401, "وارد نشده‌اید.")
    return {"user": u}


@app.post("/api/auth/logout", tags=["auth"])
def auth_logout(request: Request, con: Con):
    auth.logout(con, _token(request))
    return {"ok": True}


class SessionPatch(BaseModel):
    state: dict


@app.put("/api/sessions/{session_id}", tags=["sessions"])
def put_session(session_id: str, body: SessionPatch, request: Request, con: Con):
    _guard(con, session_id, request)
    cur = inq.get_session(con, session_id) or {}
    cur.update(body.state)
    inq.save_session(con, session_id, cur)
    return cur


@app.get("/api/sessions/{session_id}", tags=["sessions"])
def get_session(session_id: str, request: Request, con: Con):
    _guard(con, session_id, request)
    return inq.get_session(con, session_id) or {}


class InquiryIn(BaseModel):
    session_id: str
    shop_ids: list[str] = Field(min_length=1, max_length=5)
    product_id: str | None = None
    questions: list[str] = ["stock", "price"]
    custom: dict[str, str] | None = Field(None, description="product-specific questions {c1: text}; list their keys in `questions`")
    note: str | None = Field(None, max_length=200)
    timeout_s: int | None = Field(None, ge=10, le=3600)


def _custom(c: dict[str, str] | None) -> dict[str, str]:
    return {k: v[:120] for k, v in (c or {}).items() if k in ("c1", "c2", "c3", "c4") and v and v.strip()}


@app.get("/api/inquiry-questions", tags=["inquiries"])
def inquiry_questions():
    return {"items": [{"key": k, "text": t} for k, t in inq.QUESTIONS.items() if k != "tomorrow"]}


@app.get("/api/products/{product_id}/inquiry-questions", tags=["inquiries"])
async def product_questions(product_id: str):
    """Product-aware questions (variant, original vs copy, registered...) from the product's specs. LLM when configured."""
    con = db.connect()
    try:
        p = catalog.get_product(con, product_id)
    finally:
        con.close()
    if not p:
        raise HTTPException(404, "محصول پیدا نشد")
    return {"base": [{"key": k, "text": t} for k, t in inq.QUESTIONS.items() if k != "tomorrow"],
            "custom": await converse.suggest_questions(p, OpenAICompatLLM())}


@app.post("/api/inquiries", tags=["inquiries"])
def create_inquiries(body: InquiryIn, request: Request, con: Con):
    _guard(con, body.session_id, request)
    created = inq.create(con, body.session_id, body.shop_ids, body.product_id, body.questions, body.timeout_s, body.note,
                         custom=_custom(body.custom))
    return {"items": [inq.view(con, c["id"]) for c in created]}


class SmartIn(BaseModel):
    session_id: str
    product_id: str
    questions: list[str] = ["stock", "price"]
    custom: dict[str, str] | None = None
    note: str | None = Field(None, max_length=200)
    timeout_s: int | None = Field(None, ge=10, le=3600)
    wave: int = Field(2, ge=1, le=4, description="shops asked at the same time")
    target: int = Field(1, ge=1, le=3, description="stop when this many shops confirmed")
    max_shops: int = Field(8, ge=1, le=12)
    shop_ids: list[str] | None = Field(None, max_length=12, description="the user's own picks go first, in order")


@app.post("/api/inquiries/smart", tags=["inquiries"])
def smart_inquiries(body: SmartIn, request: Request, con: Con):
    """Ask in waves: the best `wave` shops first, the next ones only when someone says no or stays silent."""
    _guard(con, body.session_id, request)
    if not catalog.get_product(con, body.product_id):
        raise HTTPException(404, "محصول پیدا نشد")
    try:
        return campaigns.start(con, body.session_id, body.product_id, body.questions, _custom(body.custom), body.note,
                               body.timeout_s, body.wave, body.target, body.max_shops, body.shop_ids)
    except ValueError as e:
        raise HTTPException(409, str(e))


@app.get("/api/sessions/{session_id}/campaigns", tags=["inquiries"])
def session_campaigns(session_id: str, request: Request, con: Con):
    _guard(con, session_id, request)
    return {"items": campaigns.for_session(con, session_id)}


class SessionOnly(BaseModel):
    session_id: str


@app.post("/api/campaigns/{campaign_id}/stop", tags=["inquiries"])
def stop_campaign(campaign_id: str, body: SessionOnly, request: Request, con: Con):
    _guard(con, body.session_id, request)
    v = campaigns.view(con, campaign_id)
    if not v or v["session_id"] != body.session_id:
        raise HTTPException(404, "پیدا نشد")
    return campaigns.cancel(con, campaign_id)


def _own_inquiry(con, inquiry_id: str, session_id: str):
    r = con.execute("SELECT session_id, status, answer, questions FROM inquiries WHERE id=?", (inquiry_id,)).fetchone()
    if not r or r["session_id"] != session_id:
        raise HTTPException(404, "استعلام پیدا نشد")
    return r


class HoldIn(BaseModel):
    session_id: str
    until: str = Field(pattern=r"^\d{2}:\d{2}$")


@app.post("/api/inquiries/{inquiry_id}/hold", tags=["inquiries"])
def hold(inquiry_id: str, body: HoldIn, request: Request, con: Con):
    """Ask the shop to keep one aside until `until` (Tehran time). Only after the shop said it has the item."""
    _guard(con, body.session_id, request)
    r = _own_inquiry(con, inquiry_id, body.session_id)
    if r["status"] != "answered":
        raise HTTPException(409, "اول باید فروشگاه بگوید موجود است.")
    return inq.request_hold(con, inquiry_id, body.until)


class RecheckIn(BaseModel):
    session_id: str
    eta_min: int | None = Field(None, ge=1, le=600)
    demo_gone: bool = Field(False, description="demo only: a simulated seller answers «sold out just now» (ignored for live sellers)")


@app.post("/api/inquiries/{inquiry_id}/recheck", tags=["inquiries"])
def recheck(inquiry_id: str, body: RecheckIn, request: Request, con: Con):
    """"I'm leaving now — still there?" One more short question to the same shop."""
    _guard(con, body.session_id, request)
    _own_inquiry(con, inquiry_id, body.session_id)
    return inq.request_recheck(con, inquiry_id, body.eta_min, demo_gone=body.demo_gone and os.environ.get("TOROB_DEMO_SOLDOUT", "1") != "0")


class ArriveIn(BaseModel):
    session_id: str


@app.post("/api/inquiries/{inquiry_id}/arrive", tags=["inquiries"])
def arrive(inquiry_id: str, body: ArriveIn, request: Request, con: Con):
    """«I'm here»: the shopper taps the button (nothing is tracked); the seller is told, with the hold code if there is one."""
    _guard(con, body.session_id, request)
    _own_inquiry(con, inquiry_id, body.session_id)
    return inq.request_arrival(con, inquiry_id)


class ReportIn(BaseModel):
    session_id: str
    shop_id: str
    product_id: str
    kind: str = Field(pattern="^(visit|call)$")
    available: bool | None = None
    price: int | None = Field(None, ge=0)
    price_matched: bool | None = None
    inquiry_id: str | None = None
    note: str | None = Field(None, max_length=200)


@app.post("/api/reports", tags=["inquiries"])
def add_report(body: ReportIn, request: Request, con: Con):
    """A shopper's own report: after visiting the shop, or after phoning it. Feeds the shared confirmations and the shop's
    reliability."""
    _guard(con, body.session_id, request)
    if not con.execute("SELECT 1 FROM shops WHERE shop_id=?", (body.shop_id,)).fetchone():
        raise HTTPException(404, "فروشگاه پیدا نشد")
    if body.inquiry_id:
        _own_inquiry(con, body.inquiry_id, body.session_id)
    return verify.add_report(con, body.session_id, body.shop_id, body.product_id, body.kind, body.available, body.price,
                             body.price_matched, body.inquiry_id, body.note)


class RatingIn(BaseModel):
    session_id: str
    rating: int = Field(ge=1, le=5)


@app.post("/api/reports/{report_id}/rating", tags=["inquiries"])
def rate_report(report_id: str, body: RatingIn, request: Request, con: Con):
    """1-5 stars for the shop, from the shopper who just visited it (attached to their own visit report)."""
    _guard(con, body.session_id, request)
    res = verify.rate_report(con, body.session_id, report_id, body.rating)
    if not res:
        raise HTTPException(404, "گزارش پیدا نشد")
    return res


@app.get("/api/sessions/{session_id}/reports", tags=["inquiries"])
def session_reports(session_id: str, request: Request, con: Con):
    _guard(con, session_id, request)
    return {"items": verify.session_reports(con, session_id)}


@app.get("/api/sessions/{session_id}/bale", tags=["inquiries"])
def session_bale(session_id: str, request: Request, con: Con):
    """How a shopper gets answers in Bale: the /follow command for this session (only when the bot is configured)."""
    _guard(con, session_id, request)
    from .services import bale
    if not bale.enabled():
        return {"enabled": False}
    linked = con.execute("SELECT 1 FROM bale_kv WHERE k=?", (f"buyer:{session_id}",)).fetchone() is not None
    return {"enabled": True, "bot_username": bale.BOT_USERNAME or None, "command": bale.follow_command(session_id), "linked": linked}


@app.get("/api/sessions/{session_id}/inquiries", tags=["inquiries"])
def session_inquiries(session_id: str, request: Request, con: Con):
    _guard(con, session_id, request)
    inq.expire_overdue(con)
    return {"items": inq.list_for_session(con, session_id)}


@app.get("/api/sessions/{session_id}/events", tags=["inquiries"])
async def session_events(session_id: str, request: Request):
    """Server-sent events: inquiry status changes in real time. Accounts pass their token as ?token= (EventSource has no headers)."""
    _c = db.connect()
    try:
        _guard(_c, session_id, request)
    finally:
        _c.close()
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
    update_listing: bool = Field(False, description="also replace this shop's listed price with `price`")
    same_as_listed: bool = False
    restock: str | None = Field(None, max_length=40, description="e.g. «فردا» when out of stock for now")
    alt_suggestion: str | None = Field(None, max_length=100, description="a similar item the shop has instead")
    hold_accepted: bool | None = None


@app.get("/api/seller/{shop_id}/{token}/inquiries", tags=["seller"])
def seller_list(shop_id: str, token: str, con: Con):
    _check(shop_id, token)
    shop = catalog.get_shop(con, shop_id)
    from .services import bale
    n_upd = con.execute("SELECT COUNT(*) FROM listing_updates WHERE shop_id=?", (shop_id,)).fetchone()[0]
    return {"shop": {"shop_id": shop_id, "name": shop["name"], "mall": shop["mall"], "unit": shop["unit"]},
            "bale": {"enabled": bale.enabled(), "bot_username": bale.BOT_USERNAME or None,
                     "linked": bale.is_linked(con, shop_id), "command": bale.link_command(shop_id)} if bale.enabled() else {"enabled": False},
            "stats": {**(shop.get("reliability") or {}), "listing_updates": n_upd},
            "items": inq.seller_inbox(con, shop_id)}


def _seller_inquiry(con, shop_id: str, inquiry_id: str):
    r = con.execute("SELECT shop_id FROM inquiries WHERE id=?", (inquiry_id,)).fetchone()
    if not r or r[0] != shop_id:
        raise HTTPException(404, "پرسش پیدا نشد")


@app.post("/api/seller/{shop_id}/{token}/inquiries/{inquiry_id}/answer", tags=["seller"])
def seller_answer(shop_id: str, token: str, inquiry_id: str, body: AnswerIn, con: Con):
    _check(shop_id, token)
    _seller_inquiry(con, shop_id, inquiry_id)
    price = body.price
    if body.same_as_listed and not price:
        price = inq.view(con, inquiry_id)["listed_price"]
    extra = {k: v for k, v in {"restock": body.restock, "alt_suggestion": body.alt_suggestion,
                               "same_as_listed": body.same_as_listed or None}.items() if v}
    if body.hold_accepted is not None:
        extra["hold_accepted"] = body.hold_accepted
    v = inq.answer(con, inquiry_id, body.available if body.hold_accepted is None else body.hold_accepted, price, body.message,
                   body.closes_at, body.installment, extra=extra, update_listing=body.update_listing)
    if not v:
        raise HTTPException(409, "قبلاً پاسخ داده شده است")
    return v


class ReplyIn(BaseModel):
    text: str = Field(min_length=1, max_length=600)


@app.post("/api/seller/{shop_id}/{token}/inquiries/{inquiry_id}/reply", tags=["seller"])
async def seller_reply(shop_id: str, token: str, inquiry_id: str, body: ReplyIn):
    """Free-text answer («داریم، ۲ و ۸۵۰، تا ۸ شب هستیم»). Parsed into fields; the assistant may ask a follow-up."""
    _check(shop_id, token)
    con = db.connect()
    try:
        _seller_inquiry(con, shop_id, inquiry_id)
    finally:
        con.close()
    res = await inq.seller_says(inquiry_id, body.text, "web")
    if not res.get("ok"):
        raise HTTPException(409, "این پیام ثبت نشد")
    return {"follow_up": res.get("follow_up"), "inquiry": res["inquiry"]}


@app.post("/api/seller/{shop_id}/{token}/inquiries/{inquiry_id}/update-listing", tags=["seller"])
def seller_update_listing(shop_id: str, token: str, inquiry_id: str, con: Con):
    _check(shop_id, token)
    _seller_inquiry(con, shop_id, inquiry_id)
    v = inq.set_listing_update(con, inquiry_id)
    if not v:
        raise HTTPException(409, "این پاسخ قیمتی ندارد")
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
def make_visit_plan(body: PlanIn, request: Request, con: Con):
    """Plan built from sellers' confirmations ("available"), newest answer per shop; optional unconfirmed shop_ids."""
    _guard(con, body.session_id, request)
    stops, seen = [], set()
    allq = inq.list_for_session(con, body.session_id)
    by_id = {i["id"]: i for i in allq}
    kids: dict[tuple, list] = {}  # by (shop, product): asking a shop again keeps an earlier hold
    for i in allq:
        p = by_id.get(i["parent_id"]) if i["parent_id"] else None
        if p and p["shop"]:
            kids.setdefault((p["shop"]["shop_id"], (p["product"] or {}).get("product_id")), []).append(i)
    for i in allq:
        sid = i["shop"]["shop_id"] if i["shop"] else None
        mine = kids.get((sid, (i["product"] or {}).get("product_id")), [])
        recheck = next((k for k in mine if k["kind"] == "recheck" and k["status"] in ("answered", "unavailable")
                        and k["created_at"] >= (i["answered_at"] or i["created_at"])), None)
        if (not sid or sid in seen or i["kind"] != "ask" or i["status"] != "answered" or (i["answer"] or {}).get("available") is False
                or (recheck and recheck["status"] == "unavailable")
                or (body.product_id and i["product"] and i["product"]["product_id"] != body.product_id)):
            continue
        seen.add(sid)
        a = i["answer"] or {}
        held = next((k for k in mine if k["kind"] == "hold" and (k["answer"] or {}).get("hold_accepted")), None)
        stops.append({"shop_id": sid, "confirmed": True, "price": a.get("price"), "closes_at": a.get("closes_at"), "inquiry_id": i["id"],
                      "hold": {"code": held["answer"]["hold_code"], "until": held["answer"].get("hold_until")} if held else None,
                      "rechecked_at": recheck and recheck["answered_at"]})
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
    context: str | None = Field(None, max_length=700, description="what the shopper is doing right now (the mission), so short answers like «پسره» are read in that light")


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
    _c = db.connect()
    try:
        _guard(_c, session_id, request)
    finally:
        _c.close()

    async def gen():
        try:
            async for ev in run_chat(session_id, body.message, context=body.context):
                yield f"data: {json.dumps(ev, ensure_ascii=False, default=str)}\n\n"
        except Exception as e:  # never leave the client hanging
            yield f"data: {json.dumps({'type': 'error', 'message': 'مشکلی پیش آمد. دوباره امتحان کنید.'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class IntakeIn(BaseModel):
    session_id: str = Field(max_length=80)
    messages: list[dict] = Field(min_length=1, max_length=12)
    slots: dict = Field(default_factory=dict)
    pinned: list[str] = Field(default_factory=list, max_length=10)


@app.post("/api/mission/intake", tags=["chat"])
async def mission_intake(body: IntakeIn):
    """Intake agent (SSE: status* then result): reads the shopper's text, checks it against the real catalogue with tools, fills the
    mission's slots and asks at most two questions with tap-able options. Rule-based when the LLM is down (result.engine tells)."""
    if not _rate_ok("intake:" + body.session_id, 16, 60.0):
        raise HTTPException(429, "درخواست‌ها خیلی سریع است؛ کمی صبر کنید.")
    msgs = [{"role": "agent" if m.get("role") == "agent" else "user", "text": str(m.get("text") or "")[:400]} for m in body.messages if str(m.get("text") or "").strip()]
    if not msgs:
        raise HTTPException(422, "متنی نیست.")

    async def gen():
        con = db.connect()
        try:
            async for ev in run_intake(con, msgs, body.slots, body.pinned):
                yield f"data: {json.dumps(ev, ensure_ascii=False, default=str)}\n\n"
        except Exception:
            yield f"data: {json.dumps({'type': 'error', 'message': 'مشکلی پیش آمد. دوباره امتحان کنید.'}, ensure_ascii=False)}\n\n"
        finally:
            con.close()

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/chat-status", tags=["chat"])
def chat_status():
    l = OpenAICompatLLM()
    from .agent.llm import USAGE
    return {"llm_configured": l.configured, "model": l.s["model"], "base_url": l.s["base_url"], "usage_since_start": USAGE}
