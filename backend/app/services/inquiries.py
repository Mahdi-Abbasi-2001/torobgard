"""Seller inquiries: create, answer, time out, suggest alternatives, simulate sellers, live events."""
from __future__ import annotations
import asyncio
import hashlib
import hmac
import json
import os
import random
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from . import catalog

SECRET = os.environ.get("TOROB_SECRET", "dev-secret-change-me")
TIMEOUT_S = int(os.environ.get("TOROB_INQUIRY_TIMEOUT_S", "300"))
SIMULATE = os.environ.get("TOROB_SIMULATE_SELLERS", "1") == "1"
LIVE_SHOPS = set(filter(None, os.environ.get("TOROB_LIVE_SHOPS", "").split(",")))  # shops answered by real people (Bale/web)
QUESTIONS = {
    "stock": "آیا الان موجود است؟",
    "price": "قیمت نهایی امروز چقدر است؟",
    "hours": "امروز تا چه ساعتی باز هستید؟",
    "installment": "امکان خرید قسطی دارید؟",
    "warranty": "گارانتی دارد؟ چند ماهه و از کدام شرکت؟",
    "color": "چه رنگ‌ها یا مدل‌هایی موجود است؟",
}


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(d: datetime) -> str:
    return d.isoformat()


def shop_token(shop_id: str) -> str:
    return hmac.new(SECRET.encode(), shop_id.encode(), hashlib.sha256).hexdigest()[:20]


def valid_shop_token(shop_id: str, token: str) -> bool:
    return hmac.compare_digest(shop_token(shop_id), token)


# ---- live event bus (in-process; single instance deploy)
_subs: dict[str, set[asyncio.Queue]] = {}
LOOP: asyncio.AbstractEventLoop | None = None  # main loop, set at startup; sync endpoints run in worker threads


def subscribe(session_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subs.setdefault(session_id, set()).add(q)
    return q


def unsubscribe(session_id: str, q: asyncio.Queue):
    _subs.get(session_id, set()).discard(q)


def _put(q: asyncio.Queue, event: dict):
    try:
        q.put_nowait(event)
    except asyncio.QueueFull:
        pass


def publish(session_id: str, event: dict):
    """Thread-safe: callable from sync endpoints (worker threads) and from the event loop."""
    for q in list(_subs.get(session_id, ())):
        if LOOP is not None and LOOP.is_running():
            LOOP.call_soon_threadsafe(_put, q, event)
        else:
            _put(q, event)


# ---- core
def create(con, session_id: str, shop_ids: list[str], product_id: str | None, question_keys: list[str],
           timeout_s: int | None = None, note: str | None = None) -> list[dict]:
    out = []
    qs = [k for k in question_keys if k in QUESTIONS] or ["stock", "price"]
    for sid in dict.fromkeys(shop_ids):
        iid = "inq_" + uuid.uuid4().hex[:12]
        t = now()
        con.execute("INSERT INTO inquiries(id,session_id,shop_id,product_id,questions,status,token,created_at,deadline_at)"
                    " VALUES(?,?,?,?,?,?,?,?,?)",
                    (iid, session_id, sid, product_id, json.dumps({"keys": qs, "note": note}, ensure_ascii=False), "sent",
                     shop_token(sid), iso(t), iso(t + timedelta(seconds=timeout_s or TIMEOUT_S))))
        out.append({"id": iid, "shop_id": sid})
    con.commit()
    for o in out:
        publish(session_id, {"type": "inquiry", "inquiry": view(con, o["id"])})
        if SIMULATE and o["shop_id"] not in LIVE_SHOPS:
            if LOOP is not None and LOOP.is_running():
                asyncio.run_coroutine_threadsafe(_simulate(o["id"]), LOOP)
    return out


def answer(con, inquiry_id: str, available: bool | None, price: int | None = None, message: str | None = None,
           closes_at: str | None = None, installment: bool | None = None, simulated: bool = False) -> dict | None:
    r = con.execute("SELECT * FROM inquiries WHERE id=?", (inquiry_id,)).fetchone()
    if not r or r["status"] in ("answered", "unavailable"):
        return None
    ans = {"available": available, "price": price, "message": message, "closes_at": closes_at,
           "installment": installment, "simulated": simulated}
    status = "unavailable" if available is False else "answered"
    con.execute("UPDATE inquiries SET status=?, answer=?, answered_at=? WHERE id=?",
                (status, json.dumps(ans, ensure_ascii=False), iso(now()), inquiry_id))
    con.commit()
    v = view(con, inquiry_id)
    publish(r["session_id"], {"type": "inquiry", "inquiry": v})
    return v


def expire_overdue(con) -> list[dict]:
    rows = con.execute("SELECT id, session_id FROM inquiries WHERE status IN ('sent','delivered') AND deadline_at < ?",
                       (iso(now()),)).fetchall()
    out = []
    for r in rows:
        con.execute("UPDATE inquiries SET status='no_reply' WHERE id=?", (r["id"],))
        con.commit()
        v = view(con, r["id"])
        publish(r["session_id"], {"type": "inquiry", "inquiry": v})
        out.append(v)
    return out


def mark_delivered(con, inquiry_id: str):
    con.execute("UPDATE inquiries SET status='delivered', delivered_at=? WHERE id=? AND status='sent'", (iso(now()), inquiry_id))
    con.commit()


def view(con, inquiry_id: str, with_alternatives: bool = False) -> dict | None:
    r = con.execute("SELECT * FROM inquiries WHERE id=?", (inquiry_id,)).fetchone()
    if not r:
        return None
    q = json.loads(r["questions"])
    shop = catalog.get_shop(con, r["shop_id"])
    prod = catalog.get_product(con, r["product_id"]) if r["product_id"] else None
    d = {"id": r["id"], "session_id": r["session_id"], "status": r["status"],
         "created_at": r["created_at"], "delivered_at": r["delivered_at"], "answered_at": r["answered_at"],
         "deadline_at": r["deadline_at"], "questions": [{"key": k, "text": QUESTIONS[k]} for k in q["keys"]],
         "note": q.get("note"), "answer": json.loads(r["answer"]) if r["answer"] else None,
         "shop": {k: shop[k] for k in ("shop_id", "name", "mall", "floor_label", "unit", "area", "address", "lat", "lon")} if shop else None,
         "product": {"product_id": prod["product_id"], "title": prod["title"], "image": prod["image"]} if prod else None,
         "label": {"sent": "ارسال شد", "delivered": "دیده شد", "answered": "پاسخ داد", "unavailable": "ناموجود است",
                   "no_reply": "پاسخی نداد"}[r["status"]]}
    if with_alternatives and r["status"] in ("unavailable", "no_reply") and r["product_id"]:
        d["alternatives"] = alternatives(con, r["session_id"], r["product_id"])
    return d


def alternatives(con, session_id: str, product_id: str, k: int = 3) -> dict:
    """Next-best open shops for the same product (excluding shops already asked); else similar products' shops."""
    asked = {x[0] for x in con.execute("SELECT shop_id FROM inquiries WHERE session_id=?", (session_id,))}
    state = get_session(con, session_id) or {}
    loc = state.get("location")
    origin = (loc["lat"], loc["lon"]) if loc else None
    res = catalog.find_shops(con, [product_id], origin=origin, include_category_only=False, sort="best", limit=30)
    fresh = [s for s in res["listed"] if s["shop_id"] not in asked]
    # prefer shops that are open; if none are (e.g. at night) still offer the others, their cards say "closed"
    shops = ([s for s in fresh if s["open"]["state"] != "closed"] or fresh)[:k]
    if shops:
        return {"kind": "same_product", "shops": shops, "products": []}
    sims = catalog.similar_products(con, product_id, limit=4)
    out = []
    for p in sims:
        r2 = catalog.find_shops(con, [p["product_id"]], origin=origin, include_category_only=False, limit=10)
        fresh2 = [s for s in r2["listed"] if s["shop_id"] not in asked]
        cand = [s for s in fresh2 if s["open"]["state"] != "closed"] or fresh2
        if cand:
            out.append((p, cand[0]))
        if len(out) >= k:
            break
    return {"kind": "similar_product", "shops": [s for _, s in out], "products": [p for p, _ in out]}


def seller_inbox(con, shop_id: str) -> list[dict]:
    ids = [r[0] for r in con.execute("SELECT id FROM inquiries WHERE shop_id=? ORDER BY created_at DESC LIMIT 50", (shop_id,))]
    for i in ids:
        mark_delivered(con, i)
    return [view(con, i) for i in ids]


# ---- sessions
def get_session(con, sid: str) -> dict | None:
    r = con.execute("SELECT state FROM sessions WHERE id=?", (sid,)).fetchone()
    return json.loads(r[0]) if r else None


def save_session(con, sid: str, state: dict):
    t = iso(now())
    con.execute("INSERT INTO sessions(id,state,created_at,updated_at) VALUES(?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at",
                (sid, json.dumps(state, ensure_ascii=False), t, t))
    con.commit()


def list_for_session(con, sid: str) -> list[dict]:
    ids = [r[0] for r in con.execute("SELECT id FROM inquiries WHERE session_id=? ORDER BY created_at DESC", (sid,))]
    return [view(con, i, with_alternatives=True) for i in ids]


# ---- simulated sellers: deterministic per inquiry so demos/tests are reproducible
async def _simulate(inquiry_id: str):
    from .. import db
    h = int(hashlib.sha256(inquiry_id.encode()).hexdigest(), 16)
    rnd = random.Random(h)
    outcome = rnd.choices(["available", "price_changed", "unavailable", "silent"], [45, 20, 20, 15])[0]
    await asyncio.sleep(rnd.uniform(3, 6))
    con = db.connect()
    try:
        # demo-friendliness: the first shop asked in a batch always has the product, so the flow never dead-ends
        first = con.execute("SELECT id FROM inquiries WHERE session_id=(SELECT session_id FROM inquiries WHERE id=?) "
                            "AND product_id=(SELECT product_id FROM inquiries WHERE id=?) ORDER BY created_at, rowid LIMIT 1",
                            (inquiry_id, inquiry_id)).fetchone()
        if first and first[0] == inquiry_id and outcome in ("unavailable", "silent"):
            outcome = rnd.choice(["available", "price_changed"])
        mark_delivered(con, inquiry_id)
        publish(con.execute("SELECT session_id FROM inquiries WHERE id=?", (inquiry_id,)).fetchone()[0],
                {"type": "inquiry", "inquiry": view(con, inquiry_id)})
        if outcome == "silent":
            return
        await asyncio.sleep(rnd.uniform(4, 14))
        r = con.execute("SELECT i.product_id, i.shop_id, (SELECT MIN(price) FROM offers o WHERE o.shop_id=i.shop_id AND o.product_id=i.product_id) lp "
                        "FROM inquiries i WHERE id=?", (inquiry_id,)).fetchone()
        listed = r["lp"]
        if outcome == "unavailable":
            answer(con, inquiry_id, False, message="متأسفانه تموم شده، هفته‌ی بعد میاد.", simulated=True)
        else:
            price = listed
            if listed and outcome == "price_changed":
                price = int(round(listed * rnd.uniform(1.04, 1.12), -3))
            answer(con, inquiry_id, True, price=price, closes_at="19:00", installment=rnd.random() < 0.4,
                   message="موجوده، تشریف بیارید." if outcome == "available" else "موجوده ولی قیمت عوض شده.", simulated=True)
    finally:
        con.close()


async def timeout_loop():
    from .. import db
    while True:
        await asyncio.sleep(5)
        try:
            con = db.connect()
            expire_overdue(con)
            con.close()
        except Exception:
            pass
