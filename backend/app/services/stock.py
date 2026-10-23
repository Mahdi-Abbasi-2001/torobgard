"""«How likely is it that this shop has it right now?» — the answer before anybody has been asked.

The dataset's price dates are a week old and many shops never update. Big marketplaces do not trust a stale feed either: they predict
availability from the signals they have (Instacart), grade weak sources by stronger ones (DoorDash) and show *less certainty* when data is
stale (Google). This does the same with what we hold:
  - how old the listed price is, and how often this shop updates its prices at all (some shops refresh weekly, most never do)
  - what shoppers and sellers said lately (a fresh «yes»/«no» outweighs everything else)
  - how reliably the shop answers and how often its prices held up
  - warning signs on the listing (suspicious price, «on order» wording)
The result is a score 3–97 with a level and the reasons in plain Persian; it is a likelihood, never a promise."""
from __future__ import annotations

from datetime import datetime, timezone

_ACTIVITY: dict[int, dict[str, dict]] = {}


def _days(a: str, b: datetime) -> int | None:
    try:
        return max(0, (b - datetime.fromisoformat(a)).days)
    except ValueError:
        return None


def shop_activity(con) -> dict[str, dict]:
    """shop_id -> {share: fraction of its offers changed within 14 days of the newest change in the dataset, last_days: days since its
    newest change}. The dataset is a snapshot, so «recent» is measured against the snapshot's own newest date. Built once per process."""
    if 0 in _ACTIVITY:
        return _ACTIVITY[0]
    ref_s = con.execute("SELECT MAX(changed_at) FROM offers").fetchone()[0]
    out: dict[str, dict] = {}
    if ref_s:
        ref = datetime.fromisoformat(ref_s)
        agg: dict[str, list[int]] = {}
        for sid, ca in con.execute("SELECT shop_id, changed_at FROM offers WHERE changed_at IS NOT NULL"):
            d = _days(ca, ref)
            if d is not None:
                agg.setdefault(sid, []).append(d)
        for sid, ds in agg.items():
            out[sid] = {"share": sum(1 for d in ds if d <= 14) / len(ds), "last_days": min(ds), "n": len(ds)}
    _ACTIVITY[0] = out
    return out


def level_of(score: int) -> tuple[str, str]:
    return ("high", "زیاد") if score >= 75 else ("medium", "متوسط") if score >= 50 else ("low", "کم")


def likelihood(card: dict, activity: dict[str, dict]) -> dict:
    """card: a shop card from catalog.find_shops after verify.annotate (needs offer, confirmation, reliability)."""
    if card.get("tier") != "listed" or not card.get("offer"):
        # only the shop's category is known: it may or may not carry this model, nothing to estimate from
        return {"score": 18, "level": "unknown", "label": "نامشخص", "reasons": ["فقط دستهٔ این کالا را اعلام کرده؛ باید بپرسید"]}
    o, reasons = card["offer"], []
    score = 50
    age = o.get("age_days")
    if age is None:
        score -= 10; reasons.append("تاریخ ثبت قیمتش معلوم نیست")
    elif age <= 3:
        score += 22; reasons.append("قیمتش همین چند روز پیش ثبت شده")
    elif age <= 10:
        score += 14; reasons.append(f"قیمتش {age} روز پیش ثبت شده")
    elif age <= 30:
        score += 5
    elif age <= 90:
        score -= 8; reasons.append("قیمتش بیش از یک ماه پیش ثبت شده")
    else:
        score -= 20; reasons.append("قیمتش خیلی وقت پیش ثبت شده")
    act = activity.get(card["shop_id"])
    if act:
        score += round((act["share"] - 0.3) * 30)
        if act["share"] >= 0.6:
            reasons.append("این فروشگاه معمولاً قیمت‌هایش را به‌روز می‌کند")
        elif act["share"] < 0.1:
            score -= 3; reasons.append("این فروشگاه کم قیمتش را به‌روز می‌کند")
        if act["last_days"] <= 7:
            score += 6
        elif act["last_days"] > 180:
            score -= 8
    rel = card.get("reliability")
    if rel and rel.get("known"):
        score += round((rel["score"] - 0.5) * 20)
        if rel.get("price_match_rate") is not None and rel["price_match_rate"] >= 0.8:
            reasons.append("قیمت ثبت‌شده‌اش معمولاً درست بوده")
        if rel.get("reply_rate") is not None and rel["reply_rate"] < 0.3:
            reasons.append("کم جواب می‌دهد")
    if o.get("suspicious"):
        score -= 25; reasons.append("قیمتش مشکوک است")
    bad = sum(1 for f in (o.get("flags") or []) if f.get("tone") == "bad")
    if bad:
        score -= min(16, 8 * bad); reasons.append("در توضیح آگهی هشدار دارد")
    cf = card.get("confirmation")
    if cf and cf.get("state") != "expired":
        fresh = cf["state"] == "fresh"
        if cf.get("available") is False:
            score = 4 if fresh else 12
            reasons.insert(0, "به‌تازگی گفته «ندارم»")
        elif cf.get("available"):
            score = max(score, 96 if fresh else 88)
            reasons.insert(0, "به‌تازگی موجود بودنش تأیید شده")
    score = max(3, min(97, score))
    level, label = level_of(score)
    return {"score": score, "level": level, "label": label, "reasons": reasons[:3]}


def risk_of_wasted_trip(card: dict, stock: dict) -> dict:
    """Chance the trip ends with nothing: not open when you arrive, or not in stock. Closed means a certain wasted trip."""
    st = (card.get("open") or {}).get("state", "unknown")
    p_open = {"open": 0.97, "closing_soon": 0.8, "unknown": 0.7, "closed": 0.0}.get(st, 0.7)
    p_stock = stock["score"] / 100
    risk = round((1 - p_open * p_stock) * 100)
    level = "low" if risk <= 30 else "medium" if risk <= 55 else "high"
    return {"percent": risk, "level": level, "label": {"low": "کم", "medium": "متوسط", "high": "زیاد"}[level]}
