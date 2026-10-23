"""The bazaar's day at a glance: each shop near you with the opening shifts it declares for a chosen weekday, so a client can slide a clock
and watch the market open and close. Shops whose hours are not declared are reported as unknown, never as open or closed."""
from __future__ import annotations

import math

from .geo import haversine_km
from .hours import _DAYS, day_hours, now_tehran, parse_hours_json


def pulse(con, lat: float, lon: float, radius_km: float = 1.6, product_id: str | None = None, weekday: str | None = None, limit: int = 600) -> dict:
    wd = weekday if weekday in _DAYS else _DAYS[now_tehran().weekday()]
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * max(0.2, math.cos(math.radians(lat))))
    if product_id:
        rows = con.execute("SELECT DISTINCT s.shop_id, s.name, s.lat, s.lon, s.mall, s.hours FROM shops s JOIN offers o ON o.shop_id=s.shop_id WHERE o.product_id=? AND s.lat IS NOT NULL", (product_id,)).fetchall()
    else:
        rows = con.execute("SELECT shop_id, name, lat, lon, mall, hours FROM shops WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", (lat - dlat, lat + dlat, lon - dlon, lon + dlon)).fetchall()
    out = []
    for r in rows:
        d = haversine_km(lat, lon, r["lat"], r["lon"])
        if d > radius_km and not product_id:
            continue
        status, shifts = day_hours(parse_hours_json(r["hours"]), wd)
        out.append({"shop_id": r["shop_id"], "name": r["name"], "lat": r["lat"], "lon": r["lon"], "mall": r["mall"], "km": round(d, 2),
                    "known": status == "declared", "closed_day": status == "closed", "shifts": [[a, b] for a, b in shifts]})
    out.sort(key=lambda x: x["km"])
    step = max(1, math.ceil(len(out) / limit))  # an even sample across the whole radius, not just the nearest few blocks
    return {"weekday": wd, "shops": out[::step][:limit], "total": len(out)}
