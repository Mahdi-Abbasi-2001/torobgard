"""The seller's «Today» tab: how many shoppers asked, how fast this shop answered, and what people want from it. Plain counts over its own
inquiries; nothing about other shops."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from .hours import TEHRAN, now_tehran


def _t(s: str | None) -> datetime | None:
    try:
        d = datetime.fromisoformat(s) if s else None
        return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def today(con, shop_id: str) -> dict:
    mid = now_tehran().replace(hour=0, minute=0, second=0, microsecond=0)
    week = mid - timedelta(days=6)
    asked = answered = missed = 0
    secs: list[float] = []
    on_the_way = 0
    top: dict[str, int] = {}
    week_asked = 0
    for r in con.execute("SELECT product_id, questions, status, created_at, answered_at FROM inquiries WHERE shop_id=? ORDER BY created_at DESC LIMIT 1500", (shop_id,)):
        c = _t(r["created_at"])
        if not c or c < week:
            continue
        try:
            kind = json.loads(r["questions"]).get("kind", "ask")
        except (ValueError, TypeError):
            kind = "ask"
        if kind == "ask":
            week_asked += 1
            if r["product_id"]:
                top[r["product_id"]] = top.get(r["product_id"], 0) + 1
        if c < mid:
            continue
        if kind == "ask":
            asked += 1
            if r["status"] in ("answered", "unavailable"):
                answered += 1
                a = _t(r["answered_at"])
                if a:
                    secs.append(max(0.0, (a - c).total_seconds()))
            elif r["status"] == "no_reply":
                missed += 1
        elif kind in ("hold", "recheck", "arrive"):
            on_the_way += 1
    best = sorted(top.items(), key=lambda kv: -kv[1])[:5]
    titles = {r["product_id"]: r["title"] for r in con.execute(f"SELECT product_id, title FROM products WHERE product_id IN ({','.join('?' * len(best))})", [p for p, _ in best])} if best else {}
    avg = round(sum(secs) / len(secs)) if secs else None
    conf = con.execute("SELECT COUNT(*) FROM confirmations WHERE shop_id=? AND created_at>=? AND simulated=0", (shop_id, mid.astimezone(timezone.utc).isoformat())).fetchone()[0]
    tip = None
    if missed:
        tip = f"{missed} استعلام امروز بی‌جواب ماند؛ شاید یک مشتری از دست رفته. صفحه را باز نگه دارید یا بله را وصل کنید."
    elif avg is not None and avg > 600:
        tip = "میانگین پاسخ‌تان بیش از ۱۰ دقیقه است؛ فروشگاه‌هایی که تا ۲ دقیقه جواب می‌دهند بالاتر نشان داده می‌شوند."
    elif asked == 0:
        tip = "امروز هنوز کسی نپرسیده. بررسی روزانهٔ موجودی را بزنید تا فروشگاهتان بالاتر دیده شود."
    return {"asked": asked, "answered": answered, "missed": missed, "avg_response_s": avg, "on_the_way": on_the_way,
            "confirmations": conf, "week_asked": week_asked, "tip": tip,
            "top": [{"product_id": p, "title": titles.get(p, p), "count": n} for p, n in best]}
