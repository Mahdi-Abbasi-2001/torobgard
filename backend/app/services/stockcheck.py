"""The daily «do you still have these?» check — the proactive half of keeping availability honest.

Most small shops never update their listings, and a shop that is asked about one item at 6 pm by a stranger may not answer. So once a day
(or on demand) each shop gets a short list of its most-wanted items with one tap each: «I have it» / «I don't». Every answer becomes a fresh
confirmation (source «daily», good for a working day) that every shopper sees, and the stock-likelihood score trusts the shop more.
Items come from the shop's own offers, ranked by how much shoppers want them (how often shops were asked about them, how widely they
are sold), skipping what was confirmed in the last day. Answers arrive on the seller's web page or, for linked shops, as Bale buttons."""
from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone

from . import verify


def _now() -> datetime:
    return datetime.now(timezone.utc)


def items_for(con, shop_id: str, n: int = 6) -> list[dict]:
    since = (_now() - timedelta(hours=24)).isoformat()
    rows = con.execute(
        "SELECT o.product_id, p.title, p.shop_count, MIN(o.price) AS price, "
        "(SELECT COUNT(*) FROM inquiries i WHERE i.product_id=o.product_id) AS asked "
        "FROM offers o JOIN products p USING(product_id) WHERE o.shop_id=? "
        "AND o.product_id NOT IN (SELECT product_id FROM confirmations WHERE shop_id=? AND created_at>=?) "
        "AND o.product_id NOT IN (SELECT product_id FROM stock_checks WHERE shop_id=? AND status='pending') "
        "GROUP BY o.product_id ORDER BY asked DESC, p.shop_count DESC, o.changed_at DESC LIMIT ?",
        (shop_id, shop_id, since, shop_id, n)).fetchall()
    return [dict(r) for r in rows]


def open_round(con, shop_id: str, n: int = 6) -> list[dict]:
    """Create today's pending checks for one shop (nothing is created twice for the same item)."""
    made = []
    for it in items_for(con, shop_id, n):
        cid = "chk_" + uuid.uuid4().hex[:12]
        con.execute("INSERT INTO stock_checks(id,shop_id,product_id,status,created_at) VALUES(?,?,?,?,?)",
                    (cid, shop_id, it["product_id"], "pending", _now().isoformat()))
        made.append({"id": cid, **it})
    con.commit()
    return made


def pending(con, shop_id: str) -> list[dict]:
    rows = con.execute(
        "SELECT c.id, c.product_id, c.created_at, p.title, (SELECT MIN(o.price) FROM offers o WHERE o.shop_id=c.shop_id AND o.product_id=c.product_id) AS price "
        "FROM stock_checks c JOIN products p USING(product_id) WHERE c.shop_id=? AND c.status='pending' ORDER BY c.created_at, c.id", (shop_id,)).fetchall()
    return [dict(r) for r in rows]


def answer(con, check_id: str, shop_id: str, available: bool, price: int | None = None, channel: str = "web", simulated: bool = False) -> dict | None:
    r = con.execute("SELECT * FROM stock_checks WHERE id=? AND shop_id=?", (check_id, shop_id)).fetchone()
    if not r or r["status"] != "pending":
        return None
    con.execute("UPDATE stock_checks SET status='answered', answered_at=?, available=?, price=?, simulated=?, channel=? WHERE id=?",
                (_now().isoformat(), int(available), price, int(simulated), channel, check_id))
    verify.record(con, shop_id, r["product_id"], available, price if available else None, "daily", simulated=simulated, commit=False)
    con.commit()
    return {"id": check_id, "product_id": r["product_id"], "available": available}


def simulate(con, shop_ids: list[str], seed: int | None = None) -> dict:
    """Demo: shops that no real person answers for «reply» to their checks (about 3 in 4 say they still have the item)."""
    rnd = random.Random(seed)
    answered = yes = 0
    for sid in shop_ids:
        for it in pending(con, sid):
            ok = rnd.random() < 0.75
            if answer(con, it["id"], sid, ok, it["price"] if ok else None, channel="sim", simulated=True):
                answered += 1; yes += ok
    return {"answered": answered, "available": yes, "unavailable": answered - yes}


def run(con, shop_ids: list[str], n: int = 6, simulate_answers: bool = False) -> dict:
    from . import bale, inquiries as inq
    opened = {sid: open_round(con, sid, n) for sid in shop_ids}
    if bale.enabled():   # linked shops get their list on Bale; the others find it on their seller page
        for sid, items in opened.items():
            if items and bale.is_linked(con, sid):
                inq._spawn(bale.send_stockcheck(sid, items))
    out = {"shops": len(shop_ids), "items": sum(len(v) for v in opened.values())}
    if simulate_answers:
        live = [sid for sid in shop_ids if bale.enabled() and bale.is_linked(con, sid)]   # a real person answers those
        out.update(simulate(con, [sid for sid in shop_ids if sid not in live]))
    return out
