"""Seller inquiries: create, converse, answer, time out, suggest alternatives, simulate sellers, live events.

An inquiry is one conversation with one shop about one product. Kinds:
  ask      the first question (stock, price, ... and product-specific custom questions)
  hold     "please keep one for me until 18:00" (child of an ask)
  recheck  "I'm on my way, still there?" (child of an ask)
Sellers answer with buttons (web inbox, Bale) or free text; free text is parsed (services.converse) and the agent asks a
follow-up when something important is missing. Every answer also feeds the shared confirmation layer (services.verify).
"""
from __future__ import annotations
import asyncio
import hashlib
import hmac
import json
import os
import random
import uuid
from datetime import datetime, timedelta, timezone

from . import catalog, converse, verify

SECRET = os.environ.get("TOROB_SECRET", "dev-secret-change-me")
TIMEOUT_S = int(os.environ.get("TOROB_INQUIRY_TIMEOUT_S", "300"))
SIMULATE = os.environ.get("TOROB_SIMULATE_SELLERS", "1") == "1"
SIM_USE_LLM = os.environ.get("TOROB_SIM_USE_LLM", "1") == "1"
LIVE_SHOPS = set(filter(None, os.environ.get("TOROB_LIVE_SHOPS", "").split(",")))  # shops answered by real people (Bale/web)
QUESTIONS = {
    "stock": "آیا الان موجود است؟",
    "price": "قیمت نهایی امروز چقدر است؟",
    "hours": "امروز تا چه ساعتی باز هستید؟",
    "installment": "امکان خرید قسطی دارید؟",
    "warranty": "گارانتی دارد؟ چند ماهه و از کدام شرکت؟",
    "color": "چه رنگ‌ها یا مدل‌هایی موجود است؟",
    "original": "اصل و آکبند است؟",
    "tomorrow": "فردا از چه ساعتی باز هستید و این کالا را دارید؟",
}
KINDS = ("ask", "hold", "recheck")
LABELS = {
    "ask": {"sent": "ارسال شد", "delivered": "دیده شد", "answered": "پاسخ داد", "unavailable": "ناموجود است", "no_reply": "پاسخی نداد"},
    "hold": {"sent": "درخواست نگه‌داشتن رفت", "delivered": "دیده شد", "answered": "پاسخ داد", "unavailable": "نگه نمی‌دارد",
             "no_reply": "پاسخی نداد"},
    "recheck": {"sent": "دوباره پرسیدیم", "delivered": "دیده شد", "answered": "هنوز موجود است", "unavailable": "دیگر موجود نیست",
                "no_reply": "پاسخی نداد"},
}


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(d: datetime) -> str:
    return d.isoformat()


def shop_token(shop_id: str) -> str:
    return hmac.new(SECRET.encode(), shop_id.encode(), hashlib.sha256).hexdigest()[:20]


def valid_shop_token(shop_id: str, token: str) -> bool:
    return hmac.compare_digest(shop_token(shop_id), token)


def buyer_token(session_id: str) -> str:
    """Lets a shopper link their own Bale chat to a session (to get answers as Bale messages)."""
    return hmac.new(SECRET.encode(), f"buyer:{session_id}".encode(), hashlib.sha256).hexdigest()[:12]


# ---- live event bus (in-process; single instance deploy)
_subs: dict[str, set[asyncio.Queue]] = {}
LOOP: asyncio.AbstractEventLoop | None = None  # main loop, set at startup; sync endpoints run in worker threads
LISTENERS: list = []  # callables(session_id, event): e.g. the Bale buyer notifier


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
    for fn in LISTENERS:
        try:
            fn(session_id, event)
        except Exception:
            pass


def _spawn(coro):
    """Run a coroutine on the main loop from anywhere (sync endpoint threads included)."""
    if LOOP is not None and LOOP.is_running():
        try:
            if asyncio.get_running_loop() is LOOP:
                return LOOP.create_task(coro)
        except RuntimeError:
            pass
        return asyncio.run_coroutine_threadsafe(coro, LOOP)
    coro.close()


# ---- helpers
def _meta(row) -> dict:
    return json.loads(row["questions"])


def _save_meta(con, iid: str, meta: dict):
    con.execute("UPDATE inquiries SET questions=? WHERE id=?", (json.dumps(meta, ensure_ascii=False), iid))


def _listed(con, shop_id: str, product_id: str | None) -> int | None:
    if not product_id:
        return None
    r = con.execute("SELECT price FROM listing_updates WHERE shop_id=? AND product_id=?", (shop_id, product_id)).fetchone()
    if r:
        return r[0]
    return con.execute("SELECT MIN(price) FROM offers WHERE shop_id=? AND product_id=?", (shop_id, product_id)).fetchone()[0]


def question_texts(meta: dict) -> list[dict]:
    custom = meta.get("custom") or {}
    return [{"key": k, "text": QUESTIONS.get(k) or custom.get(k, k), "custom": k in custom} for k in meta.get("keys", [])]


def add_message(con, iid: str, role: str, text: str, channel: str = "web", simulated: bool = False, commit: bool = True):
    """role: buyer (what the seller received) | seller | agent (the assistant's follow-up to the seller) | system."""
    con.execute("INSERT INTO inquiry_messages(inquiry_id,role,text,channel,simulated,created_at) VALUES(?,?,?,?,?,?)",
                (iid, role, text[:1000], channel, int(simulated), iso(now())))
    if commit:
        con.commit()


def thread(con, iid: str) -> list[dict]:
    return [{"role": r["role"], "text": r["text"], "channel": r["channel"], "simulated": bool(r["simulated"]), "at": r["created_at"]}
            for r in con.execute("SELECT * FROM inquiry_messages WHERE inquiry_id=? ORDER BY id", (iid,))]


def _is_simulated(con, shop_id: str) -> bool:
    from . import bale
    if bale.enabled() and bale.is_linked(con, shop_id):
        return False  # a real person answers via Bale: never simulate this shop
    return SIMULATE and shop_id not in LIVE_SHOPS


# ---- core
def create(con, session_id: str, shop_ids: list[str], product_id: str | None, question_keys: list[str],
           timeout_s: int | None = None, note: str | None = None, *, kind: str = "ask", parent_id: str | None = None,
           custom: dict[str, str] | None = None, campaign_id: str | None = None, extra: dict | None = None) -> list[dict]:
    custom = {k: v.strip()[:120] for k, v in (custom or {}).items() if v and v.strip()}
    if kind == "ask":
        qs = [k for k in question_keys if k in QUESTIONS or k in custom] or ["stock", "price"]
    else:
        qs = []
    prod = catalog.get_product(con, product_id) if product_id else None
    out = []
    for sid in dict.fromkeys(shop_ids):
        iid = "inq_" + uuid.uuid4().hex[:12]
        t = now()
        sim = _is_simulated(con, sid)
        meta = {"keys": qs, "note": note, "kind": kind, "parent": parent_id, "custom": {k: custom[k] for k in qs if k in custom},
                "campaign": campaign_id, "sim": sim, "turns": 0, **(extra or {})}
        con.execute("INSERT INTO inquiries(id,session_id,shop_id,product_id,questions,status,token,created_at,deadline_at)"
                    " VALUES(?,?,?,?,?,?,?,?,?)",
                    (iid, session_id, sid, product_id, json.dumps(meta, ensure_ascii=False), "sent",
                     shop_token(sid), iso(t), iso(t + timedelta(seconds=timeout_s or TIMEOUT_S))))
        add_message(con, iid, "buyer", converse.compose(kind, prod and prod["title"], [q["text"] for q in question_texts(meta)],
                                                        note, meta), commit=False)
        out.append({"id": iid, "shop_id": sid, "sim": sim})
    con.commit()
    for o in out:
        publish(session_id, {"type": "inquiry", "inquiry": view(con, o["id"])})
        from . import bale
        if bale.enabled() and bale.is_linked(con, o["shop_id"]):
            _spawn(bale.notify_inquiry(o["id"]))
        elif o["sim"]:
            _spawn(_simulate(o["id"]))
    return out


def request_hold(con, parent_id: str, until: str, timeout_s: int = 180) -> dict | None:
    p = con.execute("SELECT * FROM inquiries WHERE id=?", (parent_id,)).fetchone()
    if not p:
        return None
    made = create(con, p["session_id"], [p["shop_id"]], p["product_id"], [], timeout_s, kind="hold", parent_id=parent_id,
                  extra={"hold_until": until})
    return view(con, made[0]["id"])


def request_recheck(con, parent_id: str, eta_min: int | None = None, timeout_s: int = 180) -> dict | None:
    p = con.execute("SELECT * FROM inquiries WHERE id=?", (parent_id,)).fetchone()
    if not p:
        return None
    price = (json.loads(p["answer"]) or {}).get("price") if p["answer"] else None
    made = create(con, p["session_id"], [p["shop_id"]], p["product_id"], [], timeout_s, kind="recheck", parent_id=parent_id,
                  extra={"eta_min": eta_min, "price": price})
    return view(con, made[0]["id"])


def answer(con, inquiry_id: str, available: bool | None, price: int | None = None, message: str | None = None,
           closes_at: str | None = None, installment: bool | None = None, simulated: bool = False, *,
           extra: dict | None = None, channel: str = "web", update_listing: bool = False, log_message: bool = True) -> dict | None:
    """Final answer. For kind=hold, `available` means "accepted the hold" (extra.hold_accepted is set from it)."""
    r = con.execute("SELECT * FROM inquiries WHERE id=?", (inquiry_id,)).fetchone()
    if not r or r["status"] in ("answered", "unavailable"):
        return None
    meta = _meta(r)
    kind = meta.get("kind", "ask")
    extra = dict(extra or {})
    ans = {"available": available, "price": price, "message": message, "closes_at": closes_at,
           "installment": installment, "simulated": simulated, "channel": channel, **extra}
    if kind == "hold":
        acc = extra.get("hold_accepted", available)
        ans["hold_accepted"] = acc
        ans["available"] = True if acc else extra.get("available")
        if acc:
            ans["hold_code"] = str(int(hashlib.sha256(inquiry_id.encode()).hexdigest(), 16) % 9000 + 1000)
            ans["hold_until"] = meta.get("hold_until")
        status = "answered" if acc else "unavailable"
    else:
        status = "unavailable" if available is False else "answered"
    if price and r["product_id"]:
        try:
            sess = get_session(con, r["session_id"]) or {}
            loc = sess.get("location")
            ans["drift"] = verify.drift(con, r["shop_id"], r["product_id"], price, (loc["lat"], loc["lon"]) if loc else None)
        except Exception:
            ans["drift"] = None
    if update_listing and price and r["product_id"]:
        verify.update_listing(con, r["shop_id"], r["product_id"], price, inquiry_id)
        ans["listing_updated"] = True
    con.execute("UPDATE inquiries SET status=?, answer=?, answered_at=? WHERE id=?",
                (status, json.dumps(ans, ensure_ascii=False), iso(now()), inquiry_id))
    if kind != "hold" or ans.get("available"):
        verify.record(con, r["shop_id"], r["product_id"], ans.get("available"), price if ans.get("available") is not False else None,
                      "seller", inquiry_id, simulated, commit=False)
    if log_message:
        add_message(con, inquiry_id, "seller", message or converse.summary(ans, kind), channel, simulated, commit=False)
    con.commit()
    v = view(con, inquiry_id)
    publish(r["session_id"], {"type": "inquiry", "inquiry": v})
    _after_change(con, inquiry_id)
    return v


def set_listing_update(con, inquiry_id: str) -> dict | None:
    """The seller agreed (after answering) that their Torob listing should take the price they just confirmed."""
    r = con.execute("SELECT * FROM inquiries WHERE id=?", (inquiry_id,)).fetchone()
    if not r or not r["answer"]:
        return None
    a = json.loads(r["answer"])
    if not a.get("price") or not r["product_id"]:
        return None
    verify.update_listing(con, r["shop_id"], r["product_id"], a["price"], inquiry_id)
    a["listing_updated"] = True
    con.execute("UPDATE inquiries SET answer=? WHERE id=?", (json.dumps(a, ensure_ascii=False), inquiry_id))
    con.commit()
    v = view(con, inquiry_id)
    publish(r["session_id"], {"type": "inquiry", "inquiry": v})
    return v


def _after_change(con, inquiry_id: str):
    """Waves move on, auto-alternatives kick in."""
    from . import campaigns
    try:
        campaigns.on_inquiry_change(con, inquiry_id)
    except Exception:
        pass


def expire_overdue(con) -> list[dict]:
    rows = con.execute("SELECT id, session_id FROM inquiries WHERE status IN ('sent','delivered') AND deadline_at < ?",
                       (iso(now()),)).fetchall()
    out = []
    for r in rows:
        con.execute("UPDATE inquiries SET status='no_reply' WHERE id=?", (r["id"],))
        con.commit()
        v = view(con, r["id"])
        publish(r["session_id"], {"type": "inquiry", "inquiry": v})
        _after_change(con, r["id"])
        out.append(v)
    return out


def mark_delivered(con, inquiry_id: str):
    con.execute("UPDATE inquiries SET status='delivered', delivered_at=? WHERE id=? AND status='sent'", (iso(now()), inquiry_id))
    con.commit()


def view(con, inquiry_id: str, with_alternatives: bool = False) -> dict | None:
    r = con.execute("SELECT * FROM inquiries WHERE id=?", (inquiry_id,)).fetchone()
    if not r:
        return None
    q = _meta(r)
    kind = q.get("kind", "ask")
    shop = catalog.get_shop(con, r["shop_id"])
    prod = catalog.get_product(con, r["product_id"]) if r["product_id"] else None
    th = thread(con, inquiry_id)
    awaiting = r["status"] in ("sent", "delivered") and bool(th) and th[-1]["role"] == "agent"
    d = {"id": r["id"], "session_id": r["session_id"], "status": r["status"], "kind": kind, "parent_id": q.get("parent"),
         "campaign_id": q.get("campaign"), "auto_from": q.get("auto_from"),
         "created_at": r["created_at"], "delivered_at": r["delivered_at"], "answered_at": r["answered_at"],
         "deadline_at": r["deadline_at"], "questions": question_texts(q), "note": q.get("note"),
         "hold_until": q.get("hold_until"), "eta_min": q.get("eta_min"),
         "answer": json.loads(r["answer"]) if r["answer"] else None, "partial": q.get("partial"),
         "thread": th, "awaiting_seller": awaiting, "simulated_seller": bool(q.get("sim")),
         "listed_price": _listed(con, r["shop_id"], r["product_id"]),
         "shop": {k: shop[k] for k in ("shop_id", "name", "mall", "floor_label", "unit", "area", "address", "lat", "lon")} if shop else None,
         "product": {"product_id": prod["product_id"], "title": prod["title"], "image": prod["image"]} if prod else None,
         "label": "در حال گفتگو" if awaiting else LABELS[kind][r["status"]]}
    if with_alternatives and r["status"] in ("unavailable", "no_reply") and r["product_id"] and kind != "hold":
        d["alternatives"] = alternatives(con, r["session_id"], r["product_id"])
    return d


def alternatives(con, session_id: str, product_id: str, k: int = 3) -> dict:
    """Next-best open shops for the same product (excluding shops already asked or freshly confirmed out of stock);
    else similar products' shops."""
    asked = {x[0] for x in con.execute("SELECT shop_id FROM inquiries WHERE session_id=?", (session_id,))}
    state = get_session(con, session_id) or {}
    loc = state.get("location")
    origin = (loc["lat"], loc["lon"]) if loc else None

    def usable(s):
        c = s.get("confirmation")
        return s["shop_id"] not in asked and not (c and c["available"] is False and c["state"] != "expired")

    res = catalog.find_shops(con, [product_id], origin=origin, include_category_only=False, sort="best", limit=30)
    fresh = [s for s in res["listed"] if usable(s)]
    # prefer shops that are open; if none are (e.g. at night) still offer the others, their cards say "closed"
    shops = ([s for s in fresh if s["open"]["state"] != "closed"] or fresh)[:k]
    if shops:
        return {"kind": "same_product", "shops": shops, "products": []}
    sims = catalog.similar_products(con, product_id, limit=4)
    out = []
    for p in sims:
        r2 = catalog.find_shops(con, [p["product_id"]], origin=origin, include_category_only=False, limit=10)
        fresh2 = [s for s in r2["listed"] if usable(s)]
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


# ---- free-text conversation (any channel)
def _ctx(con, r, meta: dict) -> dict:
    prod = catalog.get_product(con, r["product_id"]) if r["product_id"] else None
    qt = question_texts(meta)
    return {"kind": meta.get("kind", "ask"), "title": prod and prod["title"], "keys": [q["key"] for q in qt],
            "questions": [q["text"] for q in qt], "note": meta.get("note"), "listed": _listed(con, r["shop_id"], r["product_id"]),
            "hold_until": meta.get("hold_until"), "thread": [(m["role"], m["text"]) for m in thread(con, r["id"])]}


async def seller_says(inquiry_id: str, text: str, channel: str = "web", simulated: bool = False, llm=None) -> dict:
    """A seller's free-text message. Returns {ok, follow_up?, inquiry}. Final answers go through answer()."""
    from .. import db
    text = (text or "").strip()[:600]
    if not text:
        return {"ok": False, "reason": "empty"}
    if llm is None and (not simulated or SIM_USE_LLM):
        from ..agent.llm import OpenAICompatLLM
        llm = OpenAICompatLLM()
    con = db.connect()
    try:
        r = con.execute("SELECT * FROM inquiries WHERE id=?", (inquiry_id,)).fetchone()
        if not r:
            return {"ok": False, "reason": "not_found"}
        meta = _meta(r)
        kind = meta.get("kind", "ask")
        add_message(con, inquiry_id, "seller", text, channel, simulated)
        ctx = _ctx(con, r, meta)
        parsed = await converse.parse_reply(text, ctx, llm)
        if r["status"] in ("answered", "unavailable"):
            # a late message: we only take an alternative suggestion or a listing correction from it
            a = json.loads(r["answer"]) if r["answer"] else {}
            if parsed.get("alt_suggestion"):
                a["alt_suggestion"] = parsed["alt_suggestion"]
                con.execute("UPDATE inquiries SET answer=? WHERE id=?", (json.dumps(a, ensure_ascii=False), inquiry_id))
                con.commit()
            v = view(con, inquiry_id)
            publish(r["session_id"], {"type": "inquiry", "inquiry": v})
            return {"ok": True, "late": True, "inquiry": v}
        if r["status"] == "no_reply":
            # answered after the deadline: still worth showing; reopen for this answer
            con.execute("UPDATE inquiries SET status='delivered' WHERE id=?", (inquiry_id,))
            con.commit()
        merged = converse.merge(meta.get("partial"), parsed)
        fu = converse.follow_up(merged, ctx, int(meta.get("turns", 0)))
        asked = [m["text"] for m in thread(con, inquiry_id) if m["role"] == "agent"]
        if fu and fu in asked:
            fu = None  # never repeat a question; take what we have
        if fu:
            meta.update(partial=merged, turns=int(meta.get("turns", 0)) + 1)
            _save_meta(con, inquiry_id, meta)
            dl = max(datetime.fromisoformat(r["deadline_at"]), now() + timedelta(seconds=150))
            con.execute("UPDATE inquiries SET deadline_at=?, status='delivered', delivered_at=COALESCE(delivered_at, ?) WHERE id=?",
                        (iso(dl), iso(now()), inquiry_id))
            add_message(con, inquiry_id, "agent", fu, channel)
            v = view(con, inquiry_id)
            publish(r["session_id"], {"type": "inquiry", "inquiry": v})
            await _push_to_seller(con, r["shop_id"], inquiry_id, fu)
            if meta.get("sim"):
                _spawn(_simulate_follow_up(inquiry_id, fu))
            return {"ok": True, "follow_up": fu, "parsed": merged, "inquiry": v}
        extra = {k: merged.get(k) for k in ("restock", "opens_at", "warranty", "original", "variants_available",
                                            "variants_unavailable", "alt_suggestion", "answers") if merged.get(k)}
        extra["summary"] = merged.get("summary") or converse.summary(merged, kind)
        extra["parsed_by"] = merged.get("engine")
        if kind == "hold":
            extra["hold_accepted"] = merged.get("hold_accepted")
            extra["available"] = merged.get("available")
            avail = merged.get("hold_accepted")
        else:
            avail = merged.get("available")
        v = answer(con, inquiry_id, avail, merged.get("price") if avail is not False or kind == "hold" else None,
                   text, merged.get("closes_at"), merged.get("installment"), simulated, extra=extra, channel=channel,
                   log_message=False)
        # out of stock with no suggestion: ask the seller for a similar item (the answer is already final for the buyer)
        if kind == "ask" and avail is False and not merged.get("alt_suggestion") and not meta.get("alt_asked"):
            meta["alt_asked"] = True
            _save_meta(con, inquiry_id, meta)
            con.commit()
            q = "ممنون. مشابهش چیزی دارید که پیشنهاد بدهید؟"
            add_message(con, inquiry_id, "agent", q, channel)
            await _push_to_seller(con, r["shop_id"], inquiry_id, q)
            if meta.get("sim"):
                _spawn(_simulate_follow_up(inquiry_id, q))
            v = view(con, inquiry_id)
            publish(r["session_id"], {"type": "inquiry", "inquiry": v})
        return {"ok": True, "inquiry": v, "parsed": merged}
    finally:
        con.close()


async def _push_to_seller(con, shop_id: str, inquiry_id: str, text: str):
    from . import bale
    if bale.enabled() and bale.is_linked(con, shop_id):
        try:
            await bale.send_follow_up(con, shop_id, inquiry_id, text)
        except Exception:
            pass


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


# ---- simulated sellers: deterministic per inquiry so demos/tests are reproducible. They type like people do, so the
# same parser (LLM or rules) and the same follow-up logic run as for a real seller.
COLOURS = ["مشکی", "سفید", "آبی", "نقره‌ای"]


def _rnd(inquiry_id: str, salt: str = "") -> random.Random:
    return random.Random(int(hashlib.sha256((inquiry_id + salt).encode()).hexdigest(), 16))


def _fa(n) -> str:
    return converse.fa(str(n))


def _sim_price(con, r, rnd: random.Random, changed: bool) -> int | None:
    base = _listed(con, r["shop_id"], r["product_id"])
    if not base and r["product_id"]:
        base = con.execute("SELECT price_median FROM products WHERE product_id=?", (r["product_id"],)).fetchone()[0]
    if not base:
        return None
    return int(round(base * (rnd.uniform(1.04, 1.12) if changed else 1), -3))


def _sim_text(con, r, meta: dict, rnd: random.Random, first: bool) -> str | None:
    kind, keys = meta.get("kind", "ask"), meta.get("keys", [])
    if kind == "hold":
        return (f"باشه، تا ساعت {_fa(meta.get('hold_until') or '')} براتون کنار می‌ذارم. به اسم ترب‌گرد." if rnd.random() < 0.8
                else "شرمنده، نگه نمی‌داریم؛ ولی هنوز داریم، زود تشریف بیارید.")
    if kind == "recheck":
        return "آره هنوز هست، تشریف بیارید." if rnd.random() < 0.85 else "همین الان آخریش فروخته شد، شرمنده."
    weights = {"full": 30, "changed": 15, "vague": 15, "variant": 10 if (meta.get("note") or "color" in keys) else 0,
               "alt": 10, "restock": 5, "silent": 15}
    outcome = rnd.choices(list(weights), list(weights.values()))[0]
    if first and outcome in ("alt", "restock", "silent"):
        outcome = rnd.choice(["full", "changed", "vague"])  # the first shop asked always has it, so a demo never dead-ends
    closes = rnd.choice([8, 9, 9, 10])
    if outcome == "silent":
        return None
    if outcome == "alt":
        sims = catalog.similar_products(con, r["product_id"], limit=1) if r["product_id"] else []
        alt = " ".join(sims[0]["title"].split()[:4]) if sims else "یه مدل مشابه"
        return f"نه متاسفانه تموم کردیم. مشابهش {alt} رو داریم"
    if outcome == "restock":
        return "فعلاً نداریم، فردا بار میاد. از ساعت ۱۰ صبح هستیم"
    if outcome == "vague":
        return "بله داریم، تشریف بیارید"
    if outcome == "variant":
        a, b = rnd.sample(COLOURS, 2)
        return f"{a}ش تموم شده، {b} داریم"
    p = _sim_price(con, r, rnd, outcome == "changed")
    if outcome == "changed" and p:
        text = f"داریم ولی قیمت رفته بالا، {_fa(p // 1000)} میشه"
    else:
        text = f"سلام، بله موجوده. قیمتش {converse.money(p)} تومنه. تا {_fa(closes)} شب هستیم." if p else "بله موجوده، تشریف بیارید."
    if "installment" in keys:
        text += " قسطی هم با اسنپ‌پی داریم." if rnd.random() < 0.5 else " قسطی نداریم."
    if "warranty" in keys:
        text += " ۱۸ ماه گارانتی شرکتی داره."
    if meta.get("custom"):
        text += " همون مدلی که گفتید هست، اصل و آکبند."
    return text


async def _simulate(inquiry_id: str):
    from .. import db
    rnd = _rnd(inquiry_id)
    await asyncio.sleep(rnd.uniform(3, 6))
    con = db.connect()
    try:
        r = con.execute("SELECT * FROM inquiries WHERE id=?", (inquiry_id,)).fetchone()
        if not r or r["status"] not in ("sent", "delivered"):
            return
        meta = _meta(r)
        first = con.execute("SELECT id FROM inquiries WHERE session_id=? AND product_id IS ? AND questions LIKE '%\"kind\": \"ask\"%' "
                            "ORDER BY created_at, rowid LIMIT 1", (r["session_id"], r["product_id"])).fetchone()
        mark_delivered(con, inquiry_id)
        publish(r["session_id"], {"type": "inquiry", "inquiry": view(con, inquiry_id)})
        text = _sim_text(con, r, meta, rnd, bool(first and first[0] == inquiry_id))
    finally:
        con.close()
    if text is None:
        return
    await asyncio.sleep(rnd.uniform(4, 12))
    await seller_says(inquiry_id, text, "sim", simulated=True)


async def _simulate_follow_up(inquiry_id: str, question: str):
    from .. import db
    rnd = _rnd(inquiry_id, question)
    await asyncio.sleep(rnd.uniform(3, 7))
    con = db.connect()
    try:
        r = con.execute("SELECT * FROM inquiries WHERE id=?", (inquiry_id,)).fetchone()
        if not r:
            return
        meta = _meta(r)
        if "مشابه" in question:
            sims = catalog.similar_products(con, r["product_id"], limit=1) if r["product_id"] else []
            text = f"مشابهش {' '.join(sims[0]['title'].split()[:4])} رو داریم" if sims else "فعلاً مشابهش هم نداریم."
        elif "قیمت" in question:
            p = _sim_price(con, r, rnd, rnd.random() < 0.3)
            text = f"{converse.money(p)} تومان. تا {_fa(rnd.choice([8, 9]))} شب هستیم." if p else "قیمت رو حضوری می‌گیم."
        elif "نگه" in question:
            text = "بله، نگه می‌دارم."
        elif meta.get("kind") == "recheck" or "موجود" in question:
            text = "بله هست."
        else:
            text = "بله، همونه."
    finally:
        con.close()
    await seller_says(inquiry_id, text, "sim", simulated=True)


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
