"""Visit plan: order stops, estimate arrival, warn about closing times. Pure function over DB data."""
from __future__ import annotations
from datetime import datetime

from . import catalog
from .geo import haversine_km
from .hours import now_tehran

WALK_KMH, DETOUR, STAY_MIN, START_BUFFER, TIGHT_MIN = 4.5, 1.3, 10, 5, 15


def _mins(t: str) -> int:
    h, m = t.split(":")[:2]
    return int(h) * 60 + int(m)


def _fmt(m: int) -> str:
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


def walk_min(km: float) -> int:
    return round(km * DETOUR / WALK_KMH * 60)


def build(con, origin: tuple[float, float], stops_in: list[dict], order: list[str] | None = None,
          now: datetime | None = None, origin_label: str = "موقعیت شما") -> dict:
    """stops_in: [{shop_id, confirmed: bool, price: int|None, closes_at: 'HH:MM'|None, inquiry_id?}]"""
    now = now or now_tehran()
    shops = {}
    for s in stops_in:
        d = catalog.get_shop(con, s["shop_id"], origin)
        if d:
            shops[s["shop_id"]] = (s, d)
    items = list(shops.values())

    def close_of(it):
        s, d = it
        return s.get("closes_at") or d["open"]["closes_at"] or "23:59"

    if order:
        pos = {k: i for i, k in enumerate(order)}
        items.sort(key=lambda it: pos.get(it[0]["shop_id"], 999))
    else:  # whoever closes first goes first; ties by distance
        items.sort(key=lambda it: (close_of(it), it[1]["distance_km"] or 9))

    t = now.hour * 60 + now.minute + START_BUFFER
    cur = origin
    out, total_walk = [], 0
    for i, (s, d) in enumerate(items):
        w = walk_min(haversine_km(cur[0], cur[1], d["lat"], d["lon"]))
        t += w
        total_walk += w
        closes = s.get("closes_at") or d["open"]["closes_at"]
        late = bool(closes) and t > _mins(closes)
        tight = bool(closes) and not late and _mins(closes) - t < TIGHT_MIN
        warnings = []
        if late:
            warnings.append({"level": "bad", "text": "قبل از رسیدن شما بسته می‌شود." + (" اول اینجا بروید؟" if i else "")})
        elif tight:
            warnings.append({"level": "warn", "text": "کمتر از ۱۵ دقیقه قبل از بسته شدن می‌رسید." + (" اول اینجا بروید؟" if i else "")})
        hold = s.get("hold")
        if hold and hold.get("until") and t > _mins(hold["until"]):
            warnings.append({"level": "warn", "text": f"فروشنده فقط تا {hold['until']} نگه می‌دارد؛ این توقف را جلوتر بیاورید."})
        if d["open"]["state"] == "closed" and not s.get("closes_at"):
            warnings.append({"level": "warn", "text": f"طبق ساعت ثبت‌شده، الان بسته است ({d['open']['label']})."})
        out.append({"order": i + 1, "shop_id": d["shop_id"], "name": d["name"], "mall": d["mall"], "floor_label": d["floor_label"],
                    "unit": d["unit"], "plaque": d["plaque"], "area": d["area"], "lat": d["lat"], "lon": d["lon"],
                    "arrive_at": _fmt(t), "closes_at": closes, "walk_min_from_previous": w,
                    "confirmed_by_seller": bool(s.get("confirmed")), "confirmed_price": s.get("price"),
                    "inquiry_id": s.get("inquiry_id"), "hold": s.get("hold"), "rechecked_at": s.get("rechecked_at"), "late": late, "tight": tight, "warnings": warnings,
                    "in_traffic_zone": d["in_traffic_zone"]})
        t += STAY_MIN
        cur = (d["lat"], d["lon"])
    malls = {o["mall"] for o in out if o["mall"]}
    traffic = any(o["in_traffic_zone"] for o in out)
    first = out[0] if out else None
    tips = ["گارانتی را روی بسته‌بندی چک کنید", "فاکتور رسمی بگیرید"]
    tips += [f"قیمت تأییدشده را نشان دهید: {o['name']}" for o in out if o["confirmed_price"]]
    tips += [f"کد نگه‌داری {o['hold']['code']} را در {o['name']} بگویید" for o in out if o.get("hold")]
    tips.append("سلامت و اصالت را قبل از پرداخت امتحان کنید")
    return {
        "start": {"label": origin_label, "lat": origin[0], "lon": origin[1], "time": _fmt(now.hour * 60 + now.minute)},
        "stops": out, "total_walk_min": total_walk,
        "same_mall": (next(iter(malls)) if len(malls) == 1 and len(out) > 1 else None),
        "transport": {"in_traffic_zone": traffic, "suggestion": (
            "این مسیر داخل محدودهٔ طرح ترافیک است. با مترو (ایستگاه‌های حافظ یا امام خمینی) بیایید؛ ورود خودرو بدون مجوز ممکن نیست."
            if traffic else None)},
        "deep_links": ({"neshan": f"https://nshn.ir/?lat={first['lat']}&lng={first['lon']}",
                        "balad": f"https://balad.ir/location?latitude={first['lat']}&longitude={first['lon']}",
                        "google": f"https://maps.google.com/?q={first['lat']},{first['lon']}"} if first else None),
        "checklist": tips,
    }
