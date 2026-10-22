"""The "what is actually true right now" layer on top of the week-old dataset.

- confirmations: every seller answer, visit report or phone report is saved per (shop, product) and shared with every
  user. It fades: fresh (< 2 h) → aging (< 6 h) → expired (shown as history, never as confirmed).
- listing updates: a seller can choose to update their listed price while answering, which replaces the dataset's price.
- reliability: how often a shop answers, how fast, and whether its prices hold up (answers and visit reports).
- drift: how a confirmed price compares with the listed one and with other shops.
"""
from __future__ import annotations
import sqlite3
import statistics
import uuid
from datetime import datetime, timedelta, timezone

FRESH_MIN = 120
AGING_MIN = 360
SHOW_HOURS = 48


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _age_min(ts: str, now: datetime) -> int:
    try:
        return max(0, int((now - datetime.fromisoformat(ts)).total_seconds() // 60))
    except ValueError:
        return 10 ** 6


def state_for(age_min: int) -> str:
    return "fresh" if age_min < FRESH_MIN else "aging" if age_min < AGING_MIN else "expired"


# ---------------------------------------------------------------- writes
def record(con, shop_id: str, product_id: str | None, available: bool | None, price: int | None, source: str,
           inquiry_id: str | None = None, simulated: bool = False, commit: bool = True):
    """source: seller | visit | call. Nothing to record without a product or an availability/price signal."""
    if not product_id or (available is None and not price):
        return
    con.execute("INSERT INTO confirmations(shop_id,product_id,available,price,source,inquiry_id,simulated,created_at) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (shop_id, product_id, None if available is None else int(available), price, source, inquiry_id,
                 int(simulated), _now().isoformat()))
    if commit:
        con.commit()


def update_listing(con, shop_id: str, product_id: str, price: int, inquiry_id: str | None = None):
    con.execute("INSERT INTO listing_updates(shop_id,product_id,price,inquiry_id,created_at) VALUES(?,?,?,?,?) "
                "ON CONFLICT(shop_id,product_id) DO UPDATE SET price=excluded.price, inquiry_id=excluded.inquiry_id, "
                "created_at=excluded.created_at", (shop_id, product_id, price, inquiry_id, _now().isoformat()))
    con.commit()


def add_report(con, session_id: str, shop_id: str, product_id: str, kind: str, available: bool | None,
               price: int | None = None, price_matched: bool | None = None, inquiry_id: str | None = None,
               note: str | None = None) -> dict:
    rid = "rep_" + uuid.uuid4().hex[:10]
    con.execute("INSERT INTO reports(id,session_id,shop_id,product_id,kind,available,price,price_matched,inquiry_id,note,created_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (rid, session_id, shop_id, product_id, kind, None if available is None else int(available), price,
                 None if price_matched is None else int(price_matched), inquiry_id, note, _now().isoformat()))
    # a visit that found the confirmed price "as told" re-confirms that price; otherwise the shopper's price wins
    if price is None and price_matched and inquiry_id:
        r = con.execute("SELECT answer FROM inquiries WHERE id=?", (inquiry_id,)).fetchone()
        if r and r[0]:
            import json
            price = (json.loads(r[0]) or {}).get("price")
    record(con, shop_id, product_id, available, price, kind, inquiry_id, commit=False)
    con.commit()
    return {"id": rid, "kind": kind, "available": available, "price": price, "price_matched": price_matched}


def session_reports(con, session_id: str) -> list[dict]:
    return [{"id": r["id"], "shop_id": r["shop_id"], "product_id": r["product_id"], "kind": r["kind"],
             "available": None if r["available"] is None else bool(r["available"]), "price": r["price"],
             "price_matched": None if r["price_matched"] is None else bool(r["price_matched"]),
             "inquiry_id": r["inquiry_id"], "created_at": r["created_at"]}
            for r in con.execute("SELECT * FROM reports WHERE session_id=? ORDER BY created_at DESC", (session_id,))]


# ---------------------------------------------------------------- reads
def _chunks(xs: list, n: int = 400):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def confirmations(con, pairs: list[tuple[str, str]], now: datetime | None = None) -> dict[tuple[str, str], dict]:
    """Newest confirmation per (shop, product) within SHOW_HOURS, plus how many times it was confirmed today."""
    now = now or _now()
    if not pairs:
        return {}
    since = (now - timedelta(hours=SHOW_HOURS)).isoformat()
    products = sorted({p for _, p in pairs if p})
    wanted = set(pairs)
    rows = []
    for ch in _chunks(products):
        rows += con.execute(f"SELECT * FROM confirmations WHERE product_id IN ({','.join('?' * len(ch))}) AND created_at >= ? "
                            "ORDER BY created_at DESC", [*ch, since]).fetchall()
    out: dict[tuple[str, str], dict] = {}
    for r in rows:
        k = (r["shop_id"], r["product_id"])
        if k not in wanted:
            continue
        if k in out:
            out[k]["count"] += 1
            if out[k]["price"] is None and r["price"] and r["available"] != 0:
                out[k]["price"] = r["price"]  # "available" taps without a price keep the latest known price
            continue
        age = _age_min(r["created_at"], now)
        out[k] = {"available": None if r["available"] is None else bool(r["available"]), "price": r["price"],
                  "source": r["source"], "at": r["created_at"], "age_min": age, "state": state_for(age),
                  "simulated": bool(r["simulated"]), "inquiry_id": r["inquiry_id"], "count": 1}
    return out


def listing_updates(con, pairs: list[tuple[str, str]]) -> dict[tuple[str, str], dict]:
    if not pairs:
        return {}
    products = sorted({p for _, p in pairs if p})
    wanted, out = set(pairs), {}
    for ch in _chunks(products):
        for r in con.execute(f"SELECT * FROM listing_updates WHERE product_id IN ({','.join('?' * len(ch))})", ch):
            k = (r["shop_id"], r["product_id"])
            if k in wanted:
                out[k] = {"price": r["price"], "at": r["created_at"]}
    return out


def reliability(con, shop_ids: list[str]) -> dict[str, dict]:
    """Response record per shop from past inquiries, price accuracy from confirmations vs listings, and visit reports."""
    ids = sorted(set(shop_ids))
    if not ids:
        return {}
    acc: dict[str, dict] = {s: {"asked": 0, "replied": 0, "times": [], "checks": 0, "matches": 0, "visits": 0, "visit_ok": 0}
                            for s in ids}
    for ch in _chunks(ids):
        ph = ",".join("?" * len(ch))
        for r in con.execute(f"SELECT shop_id, status, created_at, answered_at FROM inquiries WHERE shop_id IN ({ph}) "
                             "AND status IN ('answered','unavailable','no_reply')", ch):
            a = acc[r["shop_id"]]
            a["asked"] += 1
            if r["status"] != "no_reply":
                a["replied"] += 1
                if r["answered_at"]:
                    try:
                        a["times"].append((datetime.fromisoformat(r["answered_at"]) - datetime.fromisoformat(r["created_at"])).total_seconds())
                    except ValueError:
                        pass
        # did the price a seller confirmed match what they had listed? (within 2 %)
        for r in con.execute(f"SELECT c.shop_id, c.price, (SELECT MIN(o.price) FROM offers o WHERE o.shop_id=c.shop_id AND "
                             f"o.product_id=c.product_id) lp FROM confirmations c WHERE c.shop_id IN ({ph}) AND c.source='seller' "
                             "AND c.price IS NOT NULL", ch):
            if r["lp"]:
                a = acc[r["shop_id"]]
                a["checks"] += 1
                a["matches"] += abs(r["price"] - r["lp"]) <= r["lp"] * 0.02
        for r in con.execute(f"SELECT shop_id, available, price_matched FROM reports WHERE shop_id IN ({ph}) AND kind='visit'", ch):
            a = acc[r["shop_id"]]
            a["visits"] += 1
            a["visit_ok"] += bool(r["available"]) and r["price_matched"] != 0
    out = {}
    for s, a in acc.items():
        med = statistics.median(a["times"]) if a["times"] else None
        rate = a["replied"] / a["asked"] if a["asked"] else None
        # Beta(2,1)-ish prior so one lucky answer doesn't make a shop look perfect
        score = (a["replied"] + 1.4 + a["visit_ok"]) / (a["asked"] + 2 + a["visits"])
        if med is not None:
            score -= min(med / 1800, 0.15)  # slow answers (half an hour+) cost a little
        out[s] = {"asked": a["asked"], "replied": a["replied"], "reply_rate": None if rate is None else round(rate, 2),
                  "median_reply_s": None if med is None else int(med), "price_checks": a["checks"],
                  "price_match_rate": round(a["matches"] / a["checks"], 2) if a["checks"] else None,
                  "visits": a["visits"], "visit_ok": a["visit_ok"], "score": round(max(0.0, min(score, 1.0)), 3),
                  "known": a["asked"] + a["visits"] >= 2, "label": _rel_label(a, rate, med)}
    return out


def _ago(m: int) -> str:
    return "همین الان" if m < 1 else f"{_fa(m)} دقیقه پیش" if m < 60 else f"{_fa(round(m / 60))} ساعت پیش"


def _fa(n) -> str:
    return str(n).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


def _rel_label(a: dict, rate: float | None, med: float | None) -> str | None:
    if a["asked"] + a["visits"] < 2:
        return None
    parts = []
    if a["asked"] >= 2:
        if rate is not None and rate >= 0.6 and med is not None:
            m = max(1, round(med / 60))
            parts.append(f"معمولاً ظرف {_fa(m)} دقیقه جواب می‌دهد")
        parts.append(f"به {_fa(a['replied'])} از {_fa(a['asked'])} استعلام پاسخ داده")
    if a["checks"] >= 2:
        r = a["matches"] / a["checks"]
        parts.append("قیمت ثبت‌شده‌اش معمولاً درست است" if r >= 0.7 else "قیمت ثبت‌شده‌اش اغلب عوض شده")
    if a["visits"]:
        parts.append(f"{_fa(a['visit_ok'])} از {_fa(a['visits'])} مراجعه: همان‌طور که گفته بود")
    return " · ".join(parts)


# ---------------------------------------------------------------- applying the layer to shop cards
def annotate(con, cards: list[dict], product_ids: list[str], now: datetime | None = None):
    """Adds `confirmation` and `reliability` to shop cards (from catalog.find_shops) and applies seller listing updates."""
    if not cards:
        return
    try:
        _annotate(con, cards, product_ids, now)
    except sqlite3.OperationalError:  # catalog-only connection (no state tables): the plain dataset view still works
        for c in cards:
            c.setdefault("confirmation", None); c.setdefault("reliability", None)


def _annotate(con, cards, product_ids, now):
    from .catalog import price_info
    now = now or _now()
    pid0 = product_ids[0] if product_ids else None

    def pid(c):
        return (c.get("offer") or {}).get("product_id") or pid0

    pairs = [(c["shop_id"], pid(c)) for c in cards if pid(c)]
    conf, upd, rel = confirmations(con, pairs, now), listing_updates(con, pairs), reliability(con, [c["shop_id"] for c in cards])
    for c in cards:
        k = (c["shop_id"], pid(c))
        c["confirmation"] = conf.get(k)
        c["reliability"] = rel.get(c["shop_id"])
        cf = c["confirmation"]
        if cf and cf["state"] != "expired" and c.get("why"):
            who = {"seller": "فروشنده", "visit": "خریداری که رفت", "call": "خریداری که زنگ زد"}[cf["source"]]
            said = "موجودی‌اش را تأیید کرد" if cf["available"] is not False else "گفت ندارد"
            c["why"] = f"{who} {_ago(cf['age_min'])} {said} · " + c["why"]
        u = upd.get(k)
        if u and c.get("offer"):
            o = c["offer"]
            before = o.get("price")
            o.update(price_info(u["price"], u["at"], 0, now))
            o["updated_by_seller"], o["listed_before_update"] = True, before


def apply_listing_updates(con, shop_id: str, offers: list[dict], now: datetime | None = None):
    """Same for a shop page's offer list (keys: product_id, price, changed_at, ...)."""
    from .catalog import price_info
    now = now or _now()
    pairs = [(shop_id, o["product_id"]) for o in offers]
    upd, conf = listing_updates(con, pairs), confirmations(con, pairs, now)
    for o in offers:
        k = (shop_id, o["product_id"])
        if k in upd:
            before = o.get("price")
            o.update(price_info(upd[k]["price"], upd[k]["at"], 0, now))
            o["updated_by_seller"], o["listed_before_update"] = True, before
        o["confirmation"] = conf.get(k)


def rank_adjust(card: dict) -> float:
    """Added to catalog._rank's score (lower is better): fresh 'available' helps, fresh 'not available' hurts, reliable
    shops edge ahead."""
    adj = 0.0
    c = card.get("confirmation")
    if c and c["state"] != "expired":
        w = 1.0 if c["state"] == "fresh" else 0.5
        adj += -0.18 * w if c["available"] is not False else 0.6 * w
    r = card.get("reliability")
    if r and r["known"]:
        adj += (0.5 - r["score"]) * 0.12
    return adj


def effective_price(card: dict) -> int | None:
    """The price a shopper should expect: a fresh/aging confirmed price beats the listed one."""
    c = card.get("confirmation")
    if c and c["state"] != "expired" and c["available"] is not False and c["price"]:
        return c["price"]
    o = card.get("offer") or {}
    return None if o.get("suspicious") else o.get("price")


# ---------------------------------------------------------------- price drift for a confirmed answer
def drift(con, shop_id: str, product_id: str, price: int, origin=None) -> dict | None:
    from . import catalog
    from .geo import haversine_km
    listed = con.execute("SELECT MIN(price) FROM offers WHERE shop_id=? AND product_id=?", (shop_id, product_id)).fetchone()[0]
    res = catalog.find_shops(con, [product_id], origin=origin, include_category_only=False, sort="price", limit=200)
    me = con.execute("SELECT lat, lon FROM shops WHERE shop_id=?", (shop_id,)).fetchone()
    others = []
    for s in res["listed"]:
        if s["shop_id"] == shop_id:
            continue
        p = effective_price(s)
        if not p:
            continue
        near = None
        if me and me["lat"] is not None and s["lat"] is not None:
            near = haversine_km(me["lat"], me["lon"], s["lat"], s["lon"])
        conf = s.get("confirmation")
        others.append({"shop_id": s["shop_id"], "name": s["name"], "price": p, "km_from_shop": None if near is None else round(near, 2),
                       "confirmed": bool(conf and conf["state"] != "expired" and conf["price"] == p),
                       "distance_km": s["distance_km"], "mall": s["mall"]})
    market = statistics.median([o["price"] for o in others]) if len(others) >= 2 else None
    cheaper = sorted([o for o in others if o["price"] < price * 0.98 and (o["km_from_shop"] is None or o["km_from_shop"] <= 3)],
                     key=lambda o: o["price"])[:2]
    out = {"price": price, "listed": listed,
           "vs_listed_pct": round((price - listed) / listed * 100) if listed else None,
           "market_median": int(market) if market else None,
           "vs_market_pct": round((price - market) / market * 100) if market else None,
           "cheaper_nearby": cheaper, "shops_compared": len(others)}
    msgs = []
    if out["vs_listed_pct"]:
        msgs.append(f"قیمت تأییدشده {_fa(abs(out['vs_listed_pct']))}٪ {'بالاتر' if out['vs_listed_pct'] > 0 else 'پایین‌تر'} از قیمت ثبت‌شده است")
    if cheaper:
        msgs.append(f"{_fa(len(cheaper))} فروشگاه نزدیک ارزان‌تر است")
    elif out["vs_market_pct"] is not None and out["vs_market_pct"] <= -3:
        msgs.append("از میانهٔ قیمت بازار ارزان‌تر است")
    out["alert"] = bool(cheaper) or (out["vs_listed_pct"] or 0) >= 5
    out["summary"] = "؛ ".join(msgs) or None
    return out
