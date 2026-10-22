"""Product search, comparison, similar products and shop finding. All data-grounded; no LLM here."""
from __future__ import annotations
import json
import re
import sqlite3
from collections import Counter
from datetime import datetime, timezone

from .address import floor_display
from .geo import haversine_km
from .hours import open_state, parse_hours_json, now_tehran
from .text import normalize_fa

DEFAULT_LOC = (35.6955, 51.4130)  # Jomhouri / Hafez, the heart of the electronics bazaar
MAX_SANE_PRICE = 2_000_000_000  # 2 billion toman; above this a listed price is almost certainly an error


# ---------------------------------------------------------------- helpers
def price_info(price: int | None, changed_at: str | None, outlier: int = 0, now: datetime | None = None) -> dict:
    """Describe a *listed* price honestly: value, age bucket and trust flags."""
    now = now or datetime.now(timezone.utc)
    age = None
    if changed_at:
        try:
            age = max(0, (now - datetime.fromisoformat(changed_at)).days)
        except ValueError:
            pass
    if not price:
        bucket = "no_price"
    elif age is None:
        bucket = "unknown_age"
    elif age <= 7:
        bucket = "fresh"
    elif age <= 30:
        bucket = "recent"
    elif age <= 90:
        bucket = "stale"
    else:
        bucket = "very_stale"
    suspicious = bool(price and (price > MAX_SANE_PRICE or outlier))
    return {"price": price, "changed_at": changed_at, "age_days": age, "freshness": bucket,
            "suspicious": suspicious, "verified_by_seller": False}


def _product_row(r: sqlite3.Row) -> dict:
    imgs = json.loads(r["images"]) if r["images"] else []
    return {"product_id": r["product_id"], "title": r["title"], "brand": r["brand"], "category": r["category"],
            "image": imgs[0] if imgs else None, "price_min": r["price_min"], "price_median": r["price_median"],
            "price_max": r["price_max"], "shop_count": r["shop_count"], "offer_count": r["offer_count"]}


STOPWORDS = set("""یه یک این اون برای می خوام میخوام میخواهم خواهم دنبال هستم هست لطفا لطفاً و با از در به که را یا تا
مدل ارزان خوب بهترین چی چه یا بخرم خرید""".split())


def _tokens(q: str) -> list[str]:
    toks = [t for t in re.split(r"[^\w]+", normalize_fa(q)) if t]
    content = [t for t in toks if t not in STOPWORDS]
    return content or toks


def _fts_query(q: str, mode: str = "and") -> str | None:
    toks = _tokens(q)
    if not toks:
        return None
    return (" AND " if mode == "and" else " OR ").join(f'"{t}"*' for t in toks)


# ---------------------------------------------------------------- products
RERANK_WINDOW = 300


def search_products(con, q: str | None = None, category: str | None = None, brand: str | None = None,
                    price_min: int | None = None, price_max: int | None = None, has_shops: bool = True,
                    limit: int = 20, offset: int = 0) -> dict:
    """Forgiving search: exact AND first; if empty, relax to ranked partial (OR) match. Products whose
    *category* starts with a query word are preferred (so «گوشی» ranks phones above phone batteries)."""
    where, args = [], []
    if category:
        where.append("p.category = ?"); args.append(category)
    if brand:
        where.append("p.brand = ?"); args.append(brand)
    if price_min is not None:
        # a lower bound means "I want something in this range": judge by the typical price, not the extremes,
        # otherwise a 1.5M feature phone with one 50M outlier offer passes a 10-15M phone search
        where.append("p.price_median IS NOT NULL AND p.price_median >= ?"); args.append(int(price_min * 0.9))
        if price_max is not None:
            where.append("p.price_median <= ?"); args.append(int(price_max * 1.1))
        else:
            where.append("1=1")
    elif price_max is not None:
        where.append("p.price_min IS NOT NULL AND p.price_min <= ?"); args.append(price_max)
    if has_shops:
        where.append("p.shop_count >= 1")
    extra = ("AND " + " AND ".join(where)) if where else ""
    toks = _tokens(q) if q else []
    if not toks:
        w = ("WHERE " + " AND ".join(where)) if where else ""
        rows = con.execute(f"SELECT p.* FROM products p {w} ORDER BY p.shop_count DESC, p.offer_count DESC LIMIT ? OFFSET ?",
                           [*args, limit, offset]).fetchall()
        cnt = con.execute(f"SELECT COUNT(*) FROM products p {w}", args).fetchone()[0]
        return {"total": cnt, "relaxed": False, "items": [_product_row(r) for r in rows]}

    def run(mode: str):
        fts = _fts_query(q, mode)
        cnt = con.execute("SELECT COUNT(*) FROM products_fts f JOIN products p ON p.rowid=f.rowid "
                          f"WHERE products_fts MATCH ? {extra}", [fts, *args]).fetchone()[0]
        return fts, cnt

    mode = "and"
    fts, cnt = run("and")
    if cnt == 0 and len(toks) > 1:
        mode = "or"
        fts, cnt = run("or")
    sql = ("SELECT p.* FROM products_fts f JOIN products p ON p.rowid=f.rowid WHERE products_fts MATCH ? " + extra +
           " ORDER BY bm25(products_fts, 10.0, 4.0, 3.0, 2.0) LIMIT ?")
    rows = con.execute(sql, [fts, *args, RERANK_WINDOW]).fetchall()
    heads = set(toks)

    def key(ir):
        i, r = ir
        cat = normalize_fa(r["category"] or "")
        first = cat.split()[0] if cat else ""
        cat_bonus = 60 if first in heads or any(first.startswith(t) for t in heads) else 0
        # several shops listing it = more trustworthy price/availability; also helps buyers who want to compare shops
        return i - cat_bonus - min(r["shop_count"], 6) * 10

    ranked = [r for _, r in sorted(enumerate(rows), key=key)]
    page = ranked[offset:offset + limit]
    return {"total": cnt, "relaxed": mode == "or", "items": [_product_row(r) for r in page]}


def facets(con, q: str | None, category: str | None = None) -> dict:
    """Top categories and brands among matches (capped sample for speed)."""
    fts = _fts_query(q) if q else None
    if not fts:
        return {"categories": [], "brands": []}
    if con.execute("SELECT 1 FROM products_fts WHERE products_fts MATCH ? LIMIT 1", [fts]).fetchone() is None:
        fts = _fts_query(q, "or")
    base = ("FROM (SELECT p.category, p.brand FROM products_fts f JOIN products p ON p.rowid=f.rowid "
            "WHERE products_fts MATCH ? AND p.shop_count>=1 {c} LIMIT 3000)")
    cats = con.execute("SELECT category, COUNT(*) n " + base.format(c="") + " WHERE category IS NOT NULL GROUP BY category ORDER BY n DESC LIMIT 8", [fts]).fetchall()
    args, c = [fts], ""
    if category:
        c = "AND p.category=?"; args.append(category)
    brands = con.execute("SELECT brand, COUNT(*) n " + base.format(c=c) + " WHERE brand IS NOT NULL GROUP BY brand ORDER BY n DESC LIMIT 10", args).fetchall()
    return {"categories": [{"name": r[0], "count": r[1]} for r in cats], "brands": [{"name": r[0], "count": r[1]} for r in brands]}


def get_product(con, product_id: str) -> dict | None:
    r = con.execute("SELECT * FROM products WHERE product_id=?", (product_id,)).fetchone()
    if not r:
        return None
    d = _product_row(r)
    d["images"] = json.loads(r["images"]) if r["images"] else []
    d["model"] = r["model"]
    sp = con.execute("SELECT specs FROM product_specs WHERE product_id=?", (product_id,)).fetchone()
    d["specs"] = _specs(sp[0] if sp else None)
    return d


def _specs(raw: str | None) -> list[dict]:
    if not raw or raw == "null":
        return []
    try:
        return [{"section": s.get("section"), "key": s.get("key"), "value": s.get("value")} for s in json.loads(raw)]
    except Exception:
        return []


def compare_products(con, ids: list[str]) -> dict:
    prods = [p for p in (get_product(con, i) for i in ids) if p]
    keys: dict[str, list] = {}
    for idx, p in enumerate(prods):
        for s in p["specs"]:
            keys.setdefault(s["key"], [None] * len(prods))[idx] = s["value"]
    rows = []
    for k, vals in keys.items():
        present = [v for v in vals if v is not None]
        rows.append({"key": k, "values": vals, "differs": len(set(present)) > 1 or len(present) < len(prods)})
    rows.sort(key=lambda r: (not r["differs"], r["key"]))  # differences first
    return {"products": [{k: v for k, v in p.items() if k != "specs"} for p in prods], "rows": rows[:60]}


def similar_products(con, product_id: str, limit: int = 8) -> list[dict]:
    """Same category, price within a band, scored by title-token overlap + brand match. Only products with shops."""
    base = con.execute("SELECT * FROM products WHERE product_id=?", (product_id,)).fetchone()
    if not base:
        return []
    ref = base["price_median"]
    args: list = [base["category"], product_id]
    band = ""
    if ref:
        band = "AND price_median BETWEEN ? AND ?"
        args += [int(ref * 0.5), int(ref * 1.6)]
    rows = con.execute(f"SELECT * FROM products WHERE category=? AND product_id!=? AND shop_count>=1 {band} "
                       f"ORDER BY shop_count DESC LIMIT 600", args).fetchall()
    in_band = {r["product_id"] for r in rows}
    if band and len(rows) < limit:
        # small or sparsely priced category: fall back to the whole category, ranked after the price-band matches
        rows += [r for r in con.execute("SELECT * FROM products WHERE category=? AND product_id!=? AND shop_count>=1 "
                                        "ORDER BY shop_count DESC LIMIT 200", [base["category"], product_id]).fetchall()
                 if r["product_id"] not in in_band]
    bt = set(base["title_norm"].split())
    scored = []
    for r in rows:
        tt = set(r["title_norm"].split())
        j = len(bt & tt) / max(1, len(bt | tt))
        s = j + (0.25 if base["brand"] and r["brand"] == base["brand"] else 0) + min(r["shop_count"], 5) * 0.03
        s -= 0 if (not band or r["product_id"] in in_band) else 0.5
        scored.append((s, r))
    scored.sort(key=lambda x: -x[0])
    return [_product_row(r) for _, r in scored[:limit]]


# ---------------------------------------------------------------- shops
def _shop_payments(con, shop_ids: list[str]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    if not shop_ids:
        return out
    q = ",".join("?" * len(shop_ids))
    for r in con.execute(f"SELECT shop_id, provider, channel FROM shop_payments WHERE shop_id IN ({q})", shop_ids):
        out.setdefault(r[0], []).append({"provider": r[1], "channel": r[2],
                                         "confirmed_in_store": r[2] == "in_person"})
    return out


def _instagram(raw: str | None) -> dict | None:
    """The dataset stores Instagram as a JSON string {"handle","profile_url"}; hand clients a real object."""
    if not raw:
        return None
    try:
        d = json.loads(raw)
        if isinstance(d, dict) and d.get("profile_url"):
            return {"handle": d.get("handle"), "profile_url": d["profile_url"]}
    except (ValueError, TypeError):
        pass
    if raw.startswith("http"):
        return {"handle": raw.rstrip("/").rsplit("/", 1)[-1], "profile_url": raw}
    return None


def shop_card(r: sqlite3.Row, pay: list[dict], origin: tuple[float, float], at: datetime | None = None) -> dict:
    hrs = parse_hours_json(r["hours"])
    st = open_state(hrs, at)
    dist = haversine_km(origin[0], origin[1], r["lat"], r["lon"]) if r["lat"] is not None else None
    phone = None
    try:
        c = json.loads(r["contacts"]) if r["contacts"] not in (None, "null") else []
        phone = c[0]["display_number"] if c else None
    except Exception:
        pass
    return {
        "shop_id": r["shop_id"], "name": r["name"], "name_is_verified": bool(r["is_real_name"]),
        "address": r["address"], "area": r["location_label"], "lat": r["lat"], "lon": r["lon"],
        "mall": r["mall"], "mall_key": r["mall_key"], "floor": r["floor"],
        "floor_label": floor_display(r["floor"], r["floor_label"]), "unit": r["unit"], "plaque": r["plaque"],
        "distance_km": round(dist, 2) if dist is not None else None,
        "walk_min": round(dist / 4.5 * 60) if dist is not None else None,
        "open": {"state": st.state, "label": st.label, "closes_at": st.closes_at, "opens_at": st.opens_at, "quality": st.quality},
        "payments": pay, "installment": bool(pay),
        "fast_delivery": None if r["fast_delivery"] is None else bool(r["fast_delivery"]),
        "in_traffic_zone": bool(r["in_traffic_zone"]), "instagram": _instagram(r["instagram"]), "website": r["website"],
        "phone_is_placeholder": True, "phone": phone,
    }


def find_shops(con, product_ids: list[str], origin: tuple[float, float] | None = None, radius_km: float | None = None,
               installment: bool = False, provider: str | None = None, open_now: bool = False,
               fast_delivery: bool = False, price_max: int | None = None, include_category_only: bool = True,
               sort: str = "best", limit: int = 40) -> dict:
    origin = origin or DEFAULT_LOC
    now_utc, now_t = datetime.now(timezone.utc), now_tehran()
    q = ",".join("?" * len(product_ids))
    offers = con.execute(
        f"SELECT o.*, p.title AS ptitle, p.price_median FROM offers o JOIN products p USING(product_id) "
        f"WHERE o.product_id IN ({q})", product_ids).fetchall()
    cats = [r[0] for r in con.execute(f"SELECT DISTINCT category FROM products WHERE product_id IN ({q})", product_ids) if r[0]]
    by_shop: dict[str, list] = {}
    for o in offers:
        by_shop.setdefault(o["shop_id"], []).append(o)
    listed_ids = list(by_shop)
    cat_ids: list[str] = []
    if include_category_only and cats:
        cq = ",".join("?" * len(cats))
        cat_ids = [r[0] for r in con.execute(f"SELECT DISTINCT shop_id FROM shop_categories WHERE category IN ({cq})", cats)
                   if r[0] not in by_shop]
    all_ids = listed_ids + cat_ids
    if not all_ids:
        return {"origin": origin, "listed": [], "category_only": [], "counts": {"listed": 0, "category_only": 0}}
    shops = {}
    for i in range(0, len(all_ids), 500):
        chunk = all_ids[i:i + 500]
        for r in con.execute(f"SELECT * FROM shops WHERE shop_id IN ({','.join('?' * len(chunk))})", chunk):
            shops[r["shop_id"]] = r
    pay = _shop_payments(con, all_ids)

    def build(sid: str, tier: str) -> dict | None:
        r = shops.get(sid)
        if not r:
            return None
        c = shop_card(r, pay.get(sid, []), origin, now_t)
        if radius_km is not None and c["distance_km"] is not None and c["distance_km"] > radius_km:
            return None
        if installment and not c["installment"]:
            return None
        if provider and not any(p["provider"] == provider for p in c["payments"]):
            return None
        if open_now and c["open"]["state"] not in ("open", "closing_soon"):
            return None
        if fast_delivery and c["fast_delivery"] is not True:
            return None
        c["tier"] = tier
        if tier == "listed":
            best = None
            for o in by_shop[sid]:
                pi = price_info(o["price"], o["changed_at"], o["outlier"], now_utc)
                key = (o["price"] is None, o["price"] or 0)
                if best is None or key < best[0]:
                    best = (key, o, pi)
            _, o, pi = best
            if price_max and o["price"] and o["price"] > price_max:
                return None
            w = json.loads(o["warranty"]) if o["warranty"] else None
            c["offer"] = {"offer_id": o["offer_id"], "product_id": o["product_id"], "seller_title": o["seller_title"],
                          "description": o["description"], "warranty": w and w.get("description"),
                          "warranty_months": o["warranty_months"], **pi}
            c["why"] = _why(c)
        else:
            c["offer"] = None
            c["why"] = "در دسته‌ی این محصول فعالیت دارد؛ موجودی و قیمت را باید بپرسید."
        return c

    listed = [x for x in (build(s, "listed") for s in listed_ids) if x]
    cat_only = [x for x in (build(s, "category_only") for s in cat_ids) if x]
    _rank(listed, sort)
    cat_only.sort(key=lambda c: (c["distance_km"] is None, c["distance_km"] or 0))
    return {"origin": origin, "listed": listed[:limit], "category_only": cat_only[:limit],
            "counts": {"listed": len(listed), "category_only": len(cat_only)}}


def _why(c: dict) -> str:
    o, parts = c["offer"], []
    if o["price"] and not o["suspicious"]:
        parts.append("قیمت ثبت‌شده")
    elif o["suspicious"]:
        parts.append("قیمت مشکوک؛ حتماً استعلام بگیرید")
    if o["freshness"] in ("stale", "very_stale"):
        parts.append(f"ولی {o['age_days']} روز پیش به‌روز شده")
    if c["open"]["state"] in ("open", "closing_soon"):
        parts.append("الان باز است")
    if c["distance_km"] is not None and c["distance_km"] < 1:
        parts.append("نزدیک شماست")
    return " · ".join(parts) or "این محصول را ثبت کرده است"


def _rank(items: list[dict], sort: str):
    prices = [i["offer"]["price"] for i in items if i["offer"]["price"] and not i["offer"]["suspicious"]]
    lo, hi = (min(prices), max(prices)) if prices else (0, 0)

    def score(i):
        o = i["offer"]
        p = ((o["price"] - lo) / (hi - lo)) if (o["price"] and not o["suspicious"] and hi > lo) else (0.5 if o["price"] else 1.0)
        d = min((i["distance_km"] or 5) / 5, 1)
        f = {"fresh": 0, "recent": 0.2, "stale": 0.6, "very_stale": 0.9}.get(o["freshness"], 1.0)
        op = {"open": 0, "closing_soon": 0.3, "unknown": 0.5, "closed": 1.0}[i["open"]["state"]]
        i["score"] = round(0.35 * p + 0.30 * d + 0.20 * f + 0.15 * op, 4)
        return i["score"]

    for i in items:
        score(i)
    keys = {"best": lambda i: i["score"],
            "price": lambda i: (i["offer"]["price"] is None or i["offer"]["suspicious"], i["offer"]["price"] or 0),
            "distance": lambda i: (i["distance_km"] is None, i["distance_km"] or 0),
            "freshness": lambda i: (i["offer"]["age_days"] is None, i["offer"]["age_days"] or 0)}
    items.sort(key=keys.get(sort, keys["best"]))


def get_shop(con, shop_id: str, origin=None) -> dict | None:
    r = con.execute("SELECT * FROM shops WHERE shop_id=?", (shop_id,)).fetchone()
    if not r:
        return None
    c = shop_card(r, _shop_payments(con, [shop_id]).get(shop_id, []), origin or DEFAULT_LOC)
    c["categories"] = json.loads(r["categories"]) if r["categories"] else []
    c["weekly_hours"] = parse_hours_json(r["hours"])
    c["offer_count"] = r["offer_count"]
    now = datetime.now(timezone.utc)
    c["offers"] = [{"offer_id": o["offer_id"], "product_id": o["product_id"], "seller_title": o["seller_title"],
                    "title": o["title"], **price_info(o["price"], o["changed_at"], o["outlier"], now)}
                   for o in con.execute("SELECT o.*, p.title FROM offers o JOIN products p USING(product_id) "
                                        "WHERE o.shop_id=? ORDER BY o.changed_at DESC LIMIT 30", (shop_id,))]
    return c


def mall_directory(con, key: str) -> dict | None:
    rows = con.execute("SELECT * FROM shops WHERE mall_key=?", (key,)).fetchall()
    if not rows:
        return None
    floors: dict = {}
    for r in rows:
        fl = r["floor"] if r["floor"] is not None else 99
        floors.setdefault(fl, []).append({"shop_id": r["shop_id"], "name": r["name"], "unit": r["unit"],
                                          "plaque": r["plaque"], "offer_count": r["offer_count"],
                                          "categories": (json.loads(r["categories"]) if r["categories"] else [])[:3]})
    order = sorted(floors, key=lambda f: (f == 99, f))
    from collections import Counter
    name = Counter(r["mall"] for r in rows).most_common(1)[0][0]
    return {"mall_key": key, "mall": name, "area": rows[0]["location_label"], "lat": rows[0]["lat"],
            "lon": rows[0]["lon"], "shop_count": len(rows),
            "floors": [{"floor": None if f == 99 else f, "label": "طبقه نامشخص" if f == 99 else floor_display(f, None),
                        "shops": floors[f]} for f in order]}


def list_malls(con, limit: int = 30) -> list[dict]:
    from collections import Counter
    agg: dict = {}
    for k, m, area in con.execute("SELECT mall_key, mall, location_label FROM shops WHERE mall_key IS NOT NULL"):
        a = agg.setdefault(k, {"n": 0, "names": Counter(), "area": Counter()})
        a["n"] += 1; a["names"][m] += 1; a["area"][area] += 1
    top = sorted(agg.items(), key=lambda kv: -kv[1]["n"])[:limit]
    return [{"mall_key": k, "mall": v["names"].most_common(1)[0][0], "area": v["area"].most_common(1)[0][0],
             "shop_count": v["n"]} for k, v in top]


# ---------------------------------------------------------------- where to look (product not found / "where do I buy X")
_CAT_INDEX: dict | None = None


def _category_index(con) -> list[tuple[str, str, int]]:
    """[(name, normalized-no-space, shop_count)] for every category any shop declares. Built once per process."""
    global _CAT_INDEX
    if _CAT_INDEX is None:
        rows = con.execute("SELECT category, COUNT(DISTINCT shop_id) FROM shop_categories GROUP BY category").fetchall()
        _CAT_INDEX = {"rows": [(r[0], normalize_fa(r[0]).replace(" ", ""), normalize_fa(r[0]), r[1]) for r in rows]}
    return _CAT_INDEX["rows"]


def match_categories(con, query: str, limit: int = 3) -> tuple[list[dict], str]:
    """Match a free-text product phrase to shop categories. Whole-phrase matches beat partial token overlap
    (so «کفش کتونی» never silently becomes «کفی و زیره کفش»). Returns (categories, confidence)."""
    q = normalize_fa(query)
    toks = [t for t in q.split() if t not in STOPWORDS and len(t) > 1]
    if not toks:
        return [], "none"
    qns = "".join(toks)
    scored = []
    for name, ns, norm, n in _category_index(con):
        starts, pos = set(), 0                           # offsets where each word of the category begins (no-space string)
        for w in norm.split():
            starts.add(pos); pos += len(w)
        i = ns.find(qns)
        while i != -1 and i not in starts:               # «لباس» must not match inside «کالباس»
            i = ns.find(qns, i + 1)
        if i != -1:                                      # whole phrase at a word boundary of the category name
            s = 3.0 + len(qns) / max(len(ns), 1)
        else:
            hit = sum(1 for t in toks if t in norm.split() or t in ns)
            cov = hit / len(toks)
            if len(toks) > 1 and cov < 1:                # multi-word query: partial overlap is weak evidence
                s = cov * 0.9
            elif cov == 1:
                s = 2.0 + len(qns) / max(len(ns), 1)
            else:
                s = 0.0
        if s > 0:
            scored.append((s + min(n, 300) / 3000, name, n, s))
    scored.sort(reverse=True)
    top = scored[:limit]
    if not top:
        return [], "none"
    best = top[0][3]
    conf = "high" if best >= 3 else "medium" if best >= 2 else "low"
    cats = [{"name": nm, "shops": n} for _, nm, n, sc in top if sc >= (best - 1.0 if conf != "low" else 0)]
    return cats, conf


def _map_links(lat: float, lon: float) -> dict:
    return {"neshan": f"https://nshn.ir/?lat={lat}&lng={lon}",
            "balad": f"https://balad.ir/location?latitude={lat}&longitude={lon}",
            "google": f"https://maps.google.com/?q={lat},{lon}"}


def where_to_look(con, query: str, category: str | None = None, origin: tuple[float, float] | None = None,
                  limit: int = 3) -> dict:
    """Malls/areas where shops of the matching category concentrate, from the dataset's own shop locations."""
    origin = origin or DEFAULT_LOC
    if category:
        cats, conf = [{"name": category, "shops": 0}], "high"
    else:
        cats, conf = match_categories(con, query)
    out = {"query": query, "confidence": conf, "matched_categories": cats, "places": [], "dataset_shops": 0}
    if not cats:
        return out
    ph = ",".join("?" * len(cats))
    rows = con.execute(
        f"SELECT COALESCE(s.mall_key, '~' || s.location_label) k, s.shop_id, s.mall, s.location_label, s.lat, s.lon, "
        f"s.floor, s.offer_count FROM shop_categories c JOIN shops s USING(shop_id) WHERE c.category IN ({ph}) "
        f"AND s.lat IS NOT NULL", [c["name"] for c in cats]).fetchall()
    groups: dict[str, dict] = {}
    for r in rows:
        g = groups.setdefault(r["k"], {"kind": "mall" if not r["k"].startswith("~") else "area", "names": Counter(),
                                       "area": Counter(), "lat": [], "lon": [], "floors": Counter(), "ids": set(), "listed": 0})
        if r["shop_id"] in g["ids"]:
            continue
        g["ids"].add(r["shop_id"]); g["lat"].append(r["lat"]); g["lon"].append(r["lon"]); g["area"][r["location_label"]] += 1
        if r["mall"]:
            g["names"][r["mall"]] += 1
        if r["floor"] is not None:
            g["floors"][r["floor"]] += 1
        g["listed"] += 1 if r["offer_count"] else 0
    out["dataset_shops"] = len({i for g in groups.values() for i in g["ids"]})
    # malls first when they hold a meaningful cluster; areas fill the rest
    ranked = sorted(groups.values(), key=lambda g: (-(len(g["ids"]) >= 3 and g["kind"] == "mall"), -len(g["ids"])))
    for g in ranked[:limit]:
        lat, lon = sum(g["lat"]) / len(g["lat"]), sum(g["lon"]) / len(g["lon"])
        area = g["area"].most_common(1)[0][0]
        d = haversine_km(origin[0], origin[1], lat, lon)
        out["places"].append({
            "kind": g["kind"], "name": g["names"].most_common(1)[0][0] if g["names"] else f"محدودهٔ {area}", "area": area,
            "shop_count": len(g["ids"]), "shops_with_listed_prices": g["listed"],
            "common_floors": [floor_display(f, None) for f, _ in sorted(g["floors"].items(), key=lambda x: -x[1])[:3]],
            "lat": round(lat, 5), "lon": round(lon, 5), "distance_km": round(d, 2), "walk_min": round(d * 1.3 / 4.5 * 60),
            "links": _map_links(round(lat, 5), round(lon, 5))})
    return out


def maps_search_link(text: str) -> str:
    """Google Maps text search (works for anything, e.g. a market area the model knows about but our data doesn't)."""
    from urllib.parse import quote
    return "https://www.google.com/maps/search/?api=1&query=" + quote(text)
