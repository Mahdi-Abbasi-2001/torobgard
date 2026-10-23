"""Walking (or driving) route between two points, drawn on our own map. The geometry and turns come from the community OSM routing
servers (free, fair use; a self-hosted OSRM with an Iran extract replaces them in production); the minutes use the same walking model
as every card (4.5 km/h plus detours) so the numbers agree across the app. If the server cannot be reached the answer is a straight
line with one step and `source: "straight"`, never an invented street route."""
from __future__ import annotations

import math
import time

import httpx

from .geo import haversine_km
from .text import to_persian_digits

BASE = {"walk": "https://routing.openstreetmap.de/routed-foot/route/v1/foot", "car": "https://routing.openstreetmap.de/routed-car/route/v1/driving"}
WALK_M_PER_MIN = 75  # 4.5 km/h; routed distance already follows the streets, so the cards' +30% detour factor is not applied again
TTL = 3600
_cache: dict[tuple, tuple[float, dict]] = {}

_TURN = {"left": "به چپ بپیچید", "right": "به راست بپیچید", "slight left": "کمی به چپ بپیچید", "slight right": "کمی به راست بپیچید",
         "sharp left": "تند به چپ بپیچید", "sharp right": "تند به راست بپیچید", "straight": "مستقیم بروید", "uturn": "دور بزنید"}


def instruction(man: dict, name: str) -> str:
    """One Persian sentence for an OSRM maneuver, in the polite «شما» register; «name» is the street the maneuver leads onto."""
    t, mod = man.get("type", ""), (man.get("modifier") or "")
    onto = f" و وارد خیابان {name} شوید" if name else ""
    along = f" در خیابان {name}" if name else ""
    if t == "depart":
        return f"از همین‌جا شروع کنید و{(' در خیابان ' + name) if name else ''} جلو بروید"
    if t == "arrive":
        side = {"left": "؛ فروشگاه سمت چپ شماست", "right": "؛ فروشگاه سمت راست شماست"}.get(mod, "")
        return "به مقصد رسیدید" + side
    if t in ("roundabout", "rotary", "roundabout turn", "exit roundabout", "exit rotary"):
        ex = man.get("exit")
        return f"وارد میدان شوید و از خروجی {to_persian_digits(str(ex))} بیرون بروید" if ex else "از میدان بگذرید"
    if t == "end of road":
        return f"سر پایان این خیابان، {_TURN.get(mod, 'ادامه دهید')}{onto if mod not in ('straight',) else ''}"
    if t == "fork":
        return f"سر دوراهی {('سمت ' + ('چپ' if 'left' in mod else 'راست') + ' را بگیرید') if mod else 'ادامه دهید'}"
    if t in ("new name", "continue", "merge", "on ramp", "off ramp"):
        return f"ادامه دهید{along}" if name else "مستقیم بروید"
    if t == "turn":
        base = _TURN.get(mod, "ادامه دهید")
        return base + (onto if mod not in ("straight",) else along)
    return f"ادامه دهید{along}" if name else "ادامه دهید"


def _straight(a: tuple[float, float], b: tuple[float, float]) -> dict:
    km = haversine_km(a[0], a[1], b[0], b[1])
    d = km * 1000 * 1.3
    return {"source": "straight", "distance_m": round(d), "minutes": max(1, round(d / WALK_M_PER_MIN)), "points": [[a[0], a[1]], [b[0], b[1]]],
            "steps": [{"text": "به سمت مقصد حرکت کنید", "distance_m": round(d), "at_m": 0, "lat": a[0], "lon": a[1], "type": "depart", "modifier": "", "street": ""},
                      {"text": "به مقصد رسیدید", "distance_m": 0, "at_m": round(d), "lat": b[0], "lon": b[1], "type": "arrive", "modifier": "", "street": ""}]}


def shape(osrm: dict, mode: str) -> dict:
    r = osrm["routes"][0]
    pts = [[lat, lon] for lon, lat in r["geometry"]["coordinates"]]
    steps, at = [], 0.0
    for leg in r["legs"]:
        for s in leg["steps"]:
            man = s["maneuver"]
            lon, lat = man["location"]
            steps.append({"text": instruction(man, (s.get("name") or "").strip()), "distance_m": round(s["distance"]), "at_m": round(at), "lat": lat, "lon": lon,
                          "type": man.get("type", ""), "modifier": man.get("modifier", ""), "street": (s.get("name") or "").strip()})
            at += s["distance"]
    dist = r["distance"]
    minutes = round(dist / WALK_M_PER_MIN) if mode == "walk" else round(r["duration"] / 60)
    return {"source": "osrm", "distance_m": round(dist), "minutes": max(1, minutes), "points": pts, "steps": steps}


async def route(a: tuple[float, float], b: tuple[float, float], mode: str = "walk") -> dict:
    mode = mode if mode in BASE else "walk"
    key = (round(a[0], 5), round(a[1], 5), round(b[0], 5), round(b[1], 5), mode)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    url = f"{BASE[mode]}/{a[1]},{a[0]};{b[1]},{b[0]}"
    try:
        async with httpx.AsyncClient(timeout=6.0, headers={"User-Agent": "torobgard/1.0 (hackathon prototype)"}) as c:
            r = await c.get(url, params={"overview": "full", "geometries": "geojson", "steps": "true"})
        r.raise_for_status()
        data = r.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            raise ValueError(data.get("code"))
        out = shape(data, mode)
    except Exception:
        out = _straight(a, b)
        out["mode"] = mode
        return out  # a failure is not cached: the next request tries again
    out["mode"] = mode
    if len(_cache) > 500:
        _cache.clear()
    _cache[key] = (time.time(), out)
    return out
