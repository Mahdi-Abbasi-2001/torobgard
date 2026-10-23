"""A basket becomes one trip: from the shops that list each product, choose the fewest stops that cover as many items as possible, then the
shortest walk through them, then the lowest total. Products nobody lists are reported as such, never faked into a stop. Distances are
straight lines with the same detour factor as every walking time in the app; the street route for each leg comes from /api/route."""
from __future__ import annotations

from itertools import combinations

from . import catalog, discover
from .geo import haversine_km
from .visit_plan import walk_min

MAX_CANDIDATES = 14
MAX_STOPS = 3


def _tour(origin: tuple[float, float], shops: list[dict]) -> tuple[list[dict], float]:
    """Nearest-neighbour order from the start, and the km walked."""
    left, cur, order, total = list(shops), origin, [], 0.0
    while left:
        nxt = min(left, key=lambda s: haversine_km(cur[0], cur[1], s["lat"], s["lon"]))
        total += haversine_km(cur[0], cur[1], nxt["lat"], nxt["lon"])
        cur = (nxt["lat"], nxt["lon"])
        order.append(nxt)
        left.remove(nxt)
    return order, total


def plan(con, product_ids: list[str], origin: tuple[float, float], when: str | None = None) -> dict:
    at, label = discover.arrival_time(when)
    ids = list(dict.fromkeys(product_ids))[:6]
    products, offers, cards = {}, {}, {}
    for pid in ids:
        p = catalog.get_product(con, pid)
        if not p:
            continue
        products[pid] = p
        res = catalog.find_shops(con, [pid], origin, None, False, None, False, False, None, False, "best", 60, at=None if not when or when == "now" else at)
        for c in res["listed"]:
            price = (c.get("offer") or {}).get("price")
            if price and not c["offer"].get("suspicious"):
                offers.setdefault(c["shop_id"], {})[pid] = price
                cards[c["shop_id"]] = c
    # a shop that is shut when you arrive is only used for a product nobody open lists
    for pid in ids:
        openers = {s for s, per in offers.items() if pid in per and (cards[s].get("open") or {}).get("state") != "closed"}
        if openers:
            for s in offers:
                if pid in offers[s] and s not in openers:
                    del offers[s][pid]
    offers = {s: per for s, per in offers.items() if per}
    found = {pid for per in offers.values() for pid in per}
    items = [{"product_id": pid, "title": products[pid]["title"], "image": products[pid].get("image"), "listed": pid in found} for pid in ids if pid in products]
    uncovered = [i for i in items if not i["listed"]]
    if not found:
        return {"items": items, "stops": [], "uncovered": uncovered, "total_walk_min": 0, "total_price": 0, "when": label}

    cand = sorted(offers, key=lambda s: (-len(offers[s]), haversine_km(origin[0], origin[1], cards[s]["lat"], cards[s]["lon"])))[:MAX_CANDIDATES]
    best = None
    for k in range(1, min(MAX_STOPS, len(found)) + 1):
        for combo in combinations(cand, k):
            covered = set().union(*(offers[s].keys() for s in combo))
            order, km = _tour(origin, [cards[s] for s in combo])
            cost = sum(min(offers[s][pid] for s in combo if pid in offers[s]) for pid in covered)
            key = (-len(covered), k, round(km, 2), cost)
            if best is None or key < best[0]:
                best = (key, order, covered)
    _, order, covered = best
    stops, cur, total_km, total_price = [], origin, 0.0, 0
    taken: set[str] = set()
    for s in order:
        # each product is bought where it is cheapest among the chosen stops
        mine = [pid for pid in covered if pid not in taken and offers[s["shop_id"]].get(pid) == min(offers[x["shop_id"]][pid] for x in order if pid in offers[x["shop_id"]])]
        taken |= set(mine)
        km = haversine_km(cur[0], cur[1], s["lat"], s["lon"]); total_km += km; cur = (s["lat"], s["lon"])
        total_price += sum(offers[s["shop_id"]][pid] for pid in mine)
        stops.append({"shop_id": s["shop_id"], "name": s["name"], "mall": s.get("mall"), "area": s.get("area"), "floor_label": s.get("floor_label"), "unit": s.get("unit"),
                      "plaque": s.get("plaque"), "lat": s["lat"], "lon": s["lon"], "open": (s.get("open") or {}).get("label"), "open_state": (s.get("open") or {}).get("state"),
                      "walk_min_from_prev": walk_min(km), "items": [{"product_id": pid, "title": products[pid]["title"], "price": offers[s["shop_id"]][pid]} for pid in mine]})
    stops = [x for x in stops if x["items"]]
    return {"items": items, "stops": stops, "uncovered": uncovered, "total_walk_min": walk_min(total_km), "total_price": total_price, "when": label}
