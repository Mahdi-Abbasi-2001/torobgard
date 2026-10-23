"""Which shops to ask, and why. The model reads the real candidate shops (distance, opening hours at arrival, listed price against the fair
range, how reliably each answers) and picks the few worth a message, with one reason each. Anything it returns that is not a candidate is
dropped; without a model the same shape comes from the ranking the catalogue already computed."""
from __future__ import annotations

import json

from . import catalog, discover

MAX_PICKS = 4

PROMPT = """You are the planner of an in-person shopping errand in Tehran. The shopper wants ONE product and will message a few shops, then walk
to the best one. From the candidate shops choose 2-4 to ask first. Use ONLY the given data. Prefer shops that are open when the shopper arrives, whose stock_likelihood is high (never fill the list with «کم» shops while better ones exist),
close together (one trip), reliably answering, and not overpriced against fair_price; a confirmed answer is worth more than a listing. Respect the
shopper's need, budget_max and priority. Reply JSON:
{"picks": [{"shop_id": "<id from candidates>", "reason": "one short natural Persian clause citing a real number or fact (distance, closing time, price, reply rate)"}],
 "headline": "one short Persian sentence: the plan in plain words",
 "tip": "one short Persian sentence: what to watch for on this trip (closing time, a price far off, an unconfirmed shop)" | null}
Write each reason so a shopper understands it at a glance: plain words, no ratios like «۵۲ از ۵۳»; say «کم جواب می‌دهد» or «معمولاً جواب می‌دهد» instead, and mention a distance or price only as a short fact. Write prices the way people say them: «حدود ۱۱ میلیون تومان» or «۹۸۰ هزار تومان», never raw digits with separators. Order picks as they should be asked. Never invent shops, prices or hours."""


def _compact(c: dict) -> dict:
    o = c.get("offer") or {}
    conf = c.get("confirmation") or {}
    rel = c.get("reliability") or {}
    return {"shop_id": c["shop_id"], "name": c["name"], "place": c.get("mall") or c.get("area"), "walk_min": c.get("walk_min"),
            "open_at_arrival": (c.get("open") or {}).get("label"), "closes_at": (c.get("open") or {}).get("closes_at"),
            "price": o.get("price"), "price_check": (o.get("fair") or {}).get("text"), "price_age_days": o.get("age_days"),
            "confirmed": ({"price": conf.get("price"), "state": conf.get("state")} if conf else None),
            "replies": rel.get("label") if rel.get("known") else None, "stock_likelihood": (c.get("stock") or {}).get("label"), "stock_score": (c.get("stock") or {}).get("score"), "trip_risk": (c.get("trip_risk") or {}).get("label"), "installment": c.get("installment"), "why": c.get("why")}


def rule_picks(listed: list[dict]) -> list[dict]:
    ok = [c for c in listed if (c.get("open") or {}).get("state") != "closed"]
    return [{"shop_id": c["shop_id"], "reason": c.get("why") or ""} for c in (ok if len(ok) >= 2 else listed)[:MAX_PICKS]]


async def advise(con, product_id: str, origin, *, when: str | None, need: str | None, priority: str, budget_max: int | None,
                 installment: bool, llm=None) -> dict:
    at, label = discover.arrival_time(when)
    res = catalog.find_shops(con, [product_id], origin, None, installment, None, False, False, None, False, "best", 12,
                             at=None if not when or when == "now" else at, weights=discover.PRIORITIES.get(priority, discover.PRIORITIES["balanced"]))
    fp = discover.fair_price(con, product_id)
    listed = res["listed"]
    for c in listed:
        o = c["offer"]
        o["fair"] = discover.price_verdict(o["price"], fp) if o["price"] and not o["suspicious"] else None
    # a shop that just said "we don't have it" is not worth another message
    listed = [c for c in listed if (c.get("confirmation") or {}).get("available") is not False] or listed
    # shops that almost certainly have nothing are not worth a message while enough likelier ones exist
    likely = [c for c in listed if (c.get("stock") or {}).get("score", 50) >= 30]
    listed = likely if len(likely) >= 3 else listed
    close = [c for c in listed if c.get("walk_min") is None or c["walk_min"] <= 45]
    listed = close or listed  # a shop two hours' walk away is not worth a message while a nearby one has it
    open_ = [c for c in listed if (c.get("open") or {}).get("state") != "closed"]
    listed = open_ if len(open_) >= 3 else listed  # a shop that is shut when you arrive is only worth a message if there is little else
    out = {"picks": rule_picks(listed), "headline": None, "tip": None, "source": "rules", "when": label}
    if not listed or not (llm and getattr(llm, "configured", False)):
        return out
    data = {"need": need, "budget_max": budget_max, "priority": priority, "arrival": label,
            "fair_price": ({k: fp[k] for k in fp if k in ("low", "high", "median", "offers")} if fp else None), "candidates": [_compact(c) for c in listed]}
    try:
        raw = await llm.complete_json([{"role": "system", "content": PROMPT}, {"role": "user", "content": json.dumps(data, ensure_ascii=False)}])
    except Exception:
        return out
    ids = {c["shop_id"] for c in listed}
    seen, picks = set(), []
    for p in raw.get("picks") or []:
        if isinstance(p, dict) and p.get("shop_id") in ids and p["shop_id"] not in seen:
            seen.add(p["shop_id"])
            picks.append({"shop_id": p["shop_id"], "reason": str(p.get("reason") or "")[:120]})
    if not picks or (len(picks) < 2 and len(listed) >= 2):
        return out
    return {"picks": picks[:MAX_PICKS], "headline": (str(raw["headline"])[:160] if raw.get("headline") else None),
            "tip": (str(raw["tip"])[:160] if raw.get("tip") else None), "source": "llm", "when": label}
