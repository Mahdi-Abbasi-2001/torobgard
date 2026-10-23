"""The bazaar's day at a glance: each shop near you with the opening shifts it declares for a chosen weekday, so a client can slide a clock
and watch the market open and close. Shops whose hours are not declared are reported as unknown, never as open or closed."""
from __future__ import annotations

import math

from .geo import haversine_km
from .groups import group_of, shop_groups
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
    grp = shop_groups(con)
    for r in rows:
        d = haversine_km(lat, lon, r["lat"], r["lon"])
        if d > radius_km and not product_id:
            continue
        status, shifts = day_hours(parse_hours_json(r["hours"]), wd)
        out.append({"shop_id": r["shop_id"], "name": r["name"], "lat": r["lat"], "lon": r["lon"], "mall": r["mall"], "km": round(d, 2),
                    "known": status == "declared", "closed_day": status == "closed", "shifts": [[a, b] for a, b in shifts], "g": grp.get(r["shop_id"], "other")})
    out.sort(key=lambda x: x["km"])
    step = max(1, math.ceil(len(out) / limit))  # an even sample across the whole radius, not just the nearest few blocks
    return {"weekday": wd, "shops": out[::step][:limit], "total": len(out)}


def _hotspot(points: list[tuple[float, float]]) -> dict | None:
    """The busiest ~400 m cell of a set of shop points: where the map should look."""
    if not points:
        return None
    cell = 0.004
    bins: dict[tuple[int, int], list[tuple[float, float]]] = {}
    for la, lo in points:
        bins.setdefault((int(la / cell), int(lo / cell)), []).append((la, lo))
    best = max(bins.values(), key=len)
    return {"lat": sum(p[0] for p in best) / len(best), "lon": sum(p[1] for p in best) / len(best), "count": len(best)}


def match(con, lat: float, lon: float, q: str | None = None, category: str | None = None, radius_km: float = 1.4) -> dict:
    """Which shops around a point carry what the shopper typed. `listed`: shops with an offer on a matching product (a real listing).
    `maybe`: shops that only declare the matching category (they may carry it; nobody has listed it). Nothing is guessed beyond that."""
    from . import catalog
    out = {"query": q, "listed": [], "maybe": [], "categories": [], "hotspot": None}
    cats: list[str] = [category] if category else []
    if not cats and q:
        found, conf = catalog.match_categories(con, q)
        if conf in ("high", "medium"):
            cats = [c["name"] for c in found]
    out["categories"] = cats
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * max(0.2, math.cos(math.radians(lat))))
    box = (lat - dlat, lat + dlat, lon - dlon, lon + dlon)
    listed: dict[str, dict] = {}
    fts = catalog._fts_query(q, "and", prefix=False) if q else None
    if not fts and category:       # a tapped category chip: shops that list any product of it
        rows = con.execute(
            "SELECT s.shop_id, s.name, s.lat, s.lon, MIN(CASE WHEN o.outlier=0 THEN o.price END) AS price FROM products p JOIN offers o ON o.product_id=p.product_id "
            "JOIN shops s ON s.shop_id=o.shop_id WHERE p.category=? AND s.lat BETWEEN ? AND ? AND s.lon BETWEEN ? AND ? GROUP BY s.shop_id", [category, *box]).fetchall()
        listed = {r["shop_id"]: dict(r) for r in rows if haversine_km(lat, lon, r["lat"], r["lon"]) <= radius_km}
    if fts:
        rows = con.execute(
            "SELECT s.shop_id, s.name, s.lat, s.lon, MIN(CASE WHEN o.outlier=0 THEN o.price END) AS price FROM products_fts f JOIN products p ON p.rowid=f.rowid "
            "JOIN offers o ON o.product_id=p.product_id JOIN shops s ON s.shop_id=o.shop_id "
            "WHERE products_fts MATCH ? AND s.lat BETWEEN ? AND ? AND s.lon BETWEEN ? AND ? GROUP BY s.shop_id" ,
            [fts, *box]).fetchall()   # a typed word is matched on titles; the parsed category is only a guess and must not hide real listings
        listed = {r["shop_id"]: dict(r) for r in rows if haversine_km(lat, lon, r["lat"], r["lon"]) <= radius_km}
    maybe: dict[str, dict] = {}
    if cats:
        ph = ",".join("?" * len(cats))
        rows = con.execute(
            f"SELECT DISTINCT s.shop_id, s.name, s.lat, s.lon FROM shop_categories c JOIN shops s USING(shop_id) WHERE c.category IN ({ph}) "
            "AND s.lat BETWEEN ? AND ? AND s.lon BETWEEN ? AND ?", [*cats, *box]).fetchall()
        maybe = {r["shop_id"]: dict(r) for r in rows if r["shop_id"] not in listed and haversine_km(lat, lon, r["lat"], r["lon"]) <= radius_km}
    grp = shop_groups(con)
    for x in [*listed.values(), *maybe.values()]:
        x["g"] = grp.get(x["shop_id"], "other")
    out["listed"], out["maybe"] = list(listed.values()), list(maybe.values())
    if not out["listed"] and not out["maybe"] and (fts or category):   # nothing in reach: where is the nearest shop that has it at all?
        out["nearest"] = _nearest(con, lat, lon, fts, category)
    pts = [(s["lat"], s["lon"]) for s in (out["listed"] or out["maybe"])]
    out["hotspot"] = _hotspot(pts)
    return out


def _nearest(con, lat: float, lon: float, fts: str | None, category: str | None) -> dict | None:
    if fts:
        rows = con.execute("SELECT s.shop_id, s.name, s.lat, s.lon FROM products_fts f JOIN products p ON p.rowid=f.rowid JOIN offers o ON o.product_id=p.product_id "
                           "JOIN shops s ON s.shop_id=o.shop_id WHERE products_fts MATCH ? AND s.lat IS NOT NULL GROUP BY s.shop_id", [fts]).fetchall()
    else:
        rows = con.execute("SELECT s.shop_id, s.name, s.lat, s.lon FROM products p JOIN offers o ON o.product_id=p.product_id JOIN shops s ON s.shop_id=o.shop_id "
                           "WHERE p.category=? AND s.lat IS NOT NULL GROUP BY s.shop_id", [category]).fetchall()
    best = min(rows, key=lambda r: haversine_km(lat, lon, r["lat"], r["lon"]), default=None)
    if not best:
        return None
    return {"shop_id": best["shop_id"], "name": best["name"], "lat": best["lat"], "lon": best["lon"], "km": round(haversine_km(lat, lon, best["lat"], best["lon"]), 1),
            "g": shop_groups(con).get(best["shop_id"], "other")}


def top_categories(con, lat: float, lon: float, radius_km: float = 1.4, limit: int = 8) -> list[dict]:
    """The categories most shops around a point declare: the market's own menu, for the start screen's chips.
    «سایر …» (other) buckets say nothing to a shopper, so they are skipped."""
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * max(0.2, math.cos(math.radians(lat))))
    rows = con.execute(
        "SELECT c.category, COUNT(DISTINCT s.shop_id) n FROM shop_categories c JOIN shops s USING(shop_id) "
        "WHERE s.lat BETWEEN ? AND ? AND s.lon BETWEEN ? AND ? AND c.category NOT LIKE 'سایر%' GROUP BY c.category ORDER BY n DESC LIMIT ?",
        (lat - dlat, lat + dlat, lon - dlon, lon + dlon, limit)).fetchall()
    return [{"name": r[0], "shops": r[1], "g": group_of(r[0])} for r in rows]
