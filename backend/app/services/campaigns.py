"""Ask in waves instead of all at once.

The agent ranks shops (price, distance, freshness, opening hours, past reliability, shared confirmations), asks the best
`wave` of them, and only asks the next ones when someone fails (out of stock / no answer) — until `target` shops have
confirmed or the queue is empty. Closed shops are never asked "is it in stock now"; if nothing is open, they are asked
about tomorrow instead.

Auto-alternatives (session setting `auto_alternatives`): when a single inquiry fails outside a campaign, the next best
shops for the same product are asked automatically (capped).
"""
from __future__ import annotations
import json
import uuid
from datetime import datetime, timedelta, timezone

from . import catalog, inquiries as inq

AUTO_ALT_CAP = 6


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load(con, cid: str):
    r = con.execute("SELECT * FROM campaigns WHERE id=?", (cid,)).fetchone()
    return (r, json.loads(r["data"])) if r else (None, None)


def _save(con, cid: str, data: dict, status: str):
    con.execute("UPDATE campaigns SET data=?, status=?, updated_at=? WHERE id=?",
                (json.dumps(data, ensure_ascii=False), status, _now(), cid))
    con.commit()


def _why(s: dict) -> str:
    parts = []
    c, rel, o = s.get("confirmation"), s.get("reliability"), s.get("offer") or {}
    if c and c["state"] != "expired" and c["available"]:
        parts.append("اخیراً موجودی‌اش تأیید شده")
    if rel and rel.get("known") and (rel.get("reply_rate") or 0) >= 0.6:
        parts.append("معمولاً جواب می‌دهد")
    if o.get("price") and not o.get("suspicious"):
        parts.append("قیمت ثبت‌شده دارد")
    if s["open"]["state"] in ("open", "closing_soon"):
        parts.append("الان باز است")
    if s.get("distance_km") is not None and s["distance_km"] < 1.5:
        parts.append("نزدیک است")
    if s.get("tier") == "category_only":
        parts.append("در همین دسته کار می‌کند")
    return "، ".join(parts[:3]) or "گزینهٔ بعدی در رتبه‌بندی"


def plan(con, session_id: str, product_id: str, max_shops: int = 8, shop_ids: list[str] | None = None) -> dict:
    """Ordered candidates: open + listed first, then a nearby category-only shop or two; closed shops kept aside."""
    state = inq.get_session(con, session_id) or {}
    loc, filters = state.get("location"), state.get("filters") or {}
    origin = (loc["lat"], loc["lon"]) if loc else None
    res = catalog.find_shops(con, [product_id], origin=origin, radius_km=filters.get("radius_km"),
                             installment=bool(filters.get("installment")), include_category_only=True, sort="best", limit=60)
    recent = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    asked = {r[0] for r in con.execute("SELECT shop_id FROM inquiries WHERE session_id=? AND product_id=? AND created_at>=?",
                                       (session_id, product_id, recent))}
    cards = {s["shop_id"]: s for s in res["listed"] + res["category_only"]}

    def ok(s):
        c = s.get("confirmation")
        return s["shop_id"] not in asked and not (c and c["available"] is False and c["state"] != "expired")

    if shop_ids:  # the user's own picks, in their order, then the ranking fills the rest
        pool = [cards[i] for i in shop_ids if i in cards] + [s for s in res["listed"] if s["shop_id"] not in shop_ids]
    else:
        pool = res["listed"] + res["category_only"][:2]
    pool = [s for s in pool if ok(s)]
    open_ = [s for s in pool if s["open"]["state"] != "closed"]
    closed = [s for s in pool if s["open"]["state"] == "closed"]
    return {"open": open_[:max_shops], "closed": closed[:max_shops]}


def start(con, session_id: str, product_id: str, questions: list[str], custom: dict | None = None, note: str | None = None,
          timeout_s: int | None = None, wave: int = 2, target: int = 1, max_shops: int = 8,
          shop_ids: list[str] | None = None) -> dict:
    p = plan(con, session_id, product_id, max_shops, shop_ids)
    tomorrow = not p["open"]
    cand = p["closed"] if tomorrow else p["open"]
    if not cand:
        raise ValueError("فروشگاه تازه‌ای برای پرسیدن پیدا نشد؛ همهٔ گزینه‌های نزدیک را قبلاً پرسیده‌اید.")
    qs = list(questions)
    if tomorrow and "tomorrow" not in qs:
        qs = [k for k in qs if k not in ("stock", "hours")] + ["tomorrow"]
    cid = "cmp_" + uuid.uuid4().hex[:10]
    data = {"queue": [s["shop_id"] for s in cand], "sent": [], "names": {s["shop_id"]: s["name"] for s in cand},
            "reasons": {s["shop_id"]: _why(s) for s in cand}, "wave": max(1, min(wave, 4)), "target": max(1, min(target, 3)),
            "questions": qs, "custom": custom or {}, "note": note, "timeout_s": timeout_s, "tomorrow": tomorrow,
            "skipped_closed": 0 if tomorrow else len(p["closed"])}
    t = _now()
    con.execute("INSERT INTO campaigns(id,session_id,product_id,data,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (cid, session_id, product_id, json.dumps(data, ensure_ascii=False), "running", t, t))
    con.commit()
    _advance(con, cid)
    return view(con, cid)


def _advance(con, cid: str):
    r, d = _load(con, cid)
    if not r or r["status"] != "running":
        return
    rows = con.execute("SELECT status, answer FROM inquiries WHERE questions LIKE ? AND questions LIKE '%\"kind\": \"ask\"%'",
                       (f'%"campaign": "{cid}"%',)).fetchall()
    confirmed = sum(1 for x in rows if x["status"] == "answered" and (json.loads(x["answer"] or "{}").get("available") is not False))
    waiting = sum(1 for x in rows if x["status"] in ("sent", "delivered"))
    if confirmed >= d["target"]:
        _save(con, cid, d, "done")
        return _publish(con, cid)
    n = d["wave"] - waiting
    if n > 0 and d["queue"]:
        nxt, d["queue"] = d["queue"][:n], d["queue"][n:]
        d["sent"] += nxt
        _save(con, cid, d, "running")
        inq.create(con, r["session_id"], nxt, r["product_id"], d["questions"], d["timeout_s"], d["note"],
                   custom=d["custom"], campaign_id=cid)
        return _publish(con, cid)
    if waiting == 0 and not d["queue"]:
        _save(con, cid, d, "exhausted")
    _publish(con, cid)


def _publish(con, cid: str):
    v = view(con, cid)
    if v:
        inq.publish(v["session_id"], {"type": "campaign", "campaign": v})


def view(con, cid: str) -> dict | None:
    r, d = _load(con, cid)
    if not r:
        return None
    rows = con.execute("SELECT status, answer FROM inquiries WHERE questions LIKE ? AND questions LIKE '%\"kind\": \"ask\"%'",
                       (f'%"campaign": "{cid}"%',)).fetchall()
    confirmed = sum(1 for x in rows if x["status"] == "answered" and (json.loads(x["answer"] or "{}").get("available") is not False))
    return {"id": cid, "session_id": r["session_id"], "product_id": r["product_id"], "status": r["status"],
            "wave": d["wave"], "target": d["target"], "asked": len(d["sent"]), "queued": len(d["queue"]),
            "confirmed": confirmed, "failed": sum(1 for x in rows if x["status"] in ("unavailable", "no_reply")),
            "waiting": sum(1 for x in rows if x["status"] in ("sent", "delivered")), "tomorrow": d.get("tomorrow", False),
            "skipped_closed": d.get("skipped_closed", 0),
            "next": [{"shop_id": s, "name": d["names"].get(s), "why": d["reasons"].get(s)} for s in d["queue"][:3]],
            "reasons": d["reasons"], "created_at": r["created_at"]}


def for_session(con, session_id: str) -> list[dict]:
    return [view(con, r[0]) for r in con.execute("SELECT id FROM campaigns WHERE session_id=? ORDER BY created_at DESC LIMIT 20",
                                                 (session_id,))]


def cancel(con, cid: str) -> dict | None:
    r, d = _load(con, cid)
    if not r:
        return None
    if r["status"] == "running":
        d["queue"] = []
        _save(con, cid, d, "stopped")
        _publish(con, cid)
    return view(con, cid)


def on_inquiry_change(con, inquiry_id: str):
    r = con.execute("SELECT * FROM inquiries WHERE id=?", (inquiry_id,)).fetchone()
    if not r:
        return
    meta = json.loads(r["questions"])
    if meta.get("kind", "ask") != "ask":
        return
    if meta.get("campaign"):
        return _advance(con, meta["campaign"])
    if r["status"] not in ("unavailable", "no_reply") or not r["product_id"]:
        return
    state = inq.get_session(con, r["session_id"]) or {}
    if not state.get("auto_alternatives"):
        return
    n_auto = con.execute("SELECT COUNT(*) FROM inquiries WHERE session_id=? AND product_id=? AND questions LIKE '%\"auto_from\": \"inq_%'",
                         (r["session_id"], r["product_id"])).fetchone()[0]
    if n_auto >= AUTO_ALT_CAP:
        return
    alt = inq.alternatives(con, r["session_id"], r["product_id"], k=2)
    if alt["kind"] != "same_product" or not alt["shops"]:
        return
    ids = [s["shop_id"] for s in alt["shops"]][:max(0, min(2, AUTO_ALT_CAP - n_auto))]
    if ids:
        inq.create(con, r["session_id"], ids, r["product_id"], meta.get("keys") or ["stock", "price"], None, meta.get("note"),
                   custom=meta.get("custom"), extra={"auto_from": inquiry_id})
