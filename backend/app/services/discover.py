"""Steps 1–3 intelligence on top of the catalog: choosing a model, finding shops at the right place and time, comparing.

Step 1  need presets (category-aware spec constraints, LLM-proposed and validated, rules as fallback), spec facets and
        filters, "fits your need" explanations, product-level purchase conditions (sold near me / installments / open),
        variants of the same model, a fair-price range, compare insights (winner per spec row) and a grounded verdict.
Step 2  arrival-time aware opening state, travel time by mode, "best place to go" zones, real dataset areas, red flags in
        the seller's own listing text.
Step 3  shop comparison with priority weights, a score breakdown, winners per row and a verdict per priority.
"""
from __future__ import annotations
import json
import re
import statistics
from collections import Counter
from datetime import datetime, timedelta, timezone

from .geo import haversine_km
from .hours import TEHRAN, now_tehran, open_state, parse_hours_json
from .text import normalize_fa


def _fa(n) -> str:
    return str(n).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


def _mil(n: int) -> str:
    if n < 1_000_000:
        return f"{_fa(round(n / 1000))} هزار"
    m = n / 1e6
    s = (f"{m:.1f}" if m >= 10 else f"{m:.2f}").rstrip("0").rstrip(".").replace(".", "٫")
    return f"{_fa(s)} میلیون"


# ================================================================== step 2: listing red flags
# What the seller wrote in their own listing can contradict "new, genuine, this exact model". The dataset has thousands.
FLAGS = [  # (code, regex on normalized seller title + description, label, tone)
    ("used", r"کارکرده|دست ?دوم|استفاده ?شده", "کارکرده / دست‌دوم", "bad"),
    ("stock", r"استوک|اوپن ?باکس|open ?box|ریفربیش|refurb", "استوک یا اوپن‌باکس", "warn"),
    ("copy", r"های ?کپی|(?<!بدون )کپی|طرح ?اصلی|فیک|replica|master ?copy", "کپی / طرح اصلی", "bad"),
    ("not_registered", r"رجیستر ?نشده|بدون ?رجیستر|نات ?اکتیو|not ?active|غیر ?رجیستر", "رجیستر نشده / نات‌اکتیو", "bad"),
    ("region", r"اروپا|ویتنام|خاورمیانه|هند(?!زفری|سفری)|چین(?!ی)|آسیا|global|گلوبال|پارت ?نامبر", "نسخهٔ منطقه‌ای خاص (پارت‌نامبر را بپرسید)", "warn"),
    ("on_order", r"(?:فوق|با|پیش) ?سفارش|پیش ?فروش|موجودی ?ندار|تماس ?بگیرید ?برای ?موجودی", "سفارشی / پیش‌فروش؛ موجودی را بپرسید", "warn"),
    ("no_warranty", r"بدون ?گارانتی|گارانتی ?ندارد|فاقد ?گارانتی", "بدون گارانتی", "warn"),
]


def offer_flags(title: str | None, desc: str | None) -> list[dict]:
    t = normalize_fa(f"{title or ''} {desc or ''}")
    if not t:
        return []
    return [{"code": c, "label": lab, "tone": tone} for c, pat, lab, tone in FLAGS if re.search(pat, t)]


# ================================================================== step 2: time and travel
WHEN = {"now": "الان", "1h": "یک ساعت دیگر", "evening": "عصر امروز", "tomorrow": "فردا صبح"}


def arrival_time(when: str | None, now: datetime | None = None) -> tuple[datetime, str]:
    """'now' | '1h' | 'evening' | 'tomorrow' | 'HH:MM' -> (Tehran datetime, Persian label)."""
    now = now or now_tehran()
    w = (when or "now").strip()
    if w == "1h":
        return now + timedelta(hours=1), WHEN[w]
    if w == "evening":
        t = now.replace(hour=18, minute=0, second=0, microsecond=0)
        return (t if t > now else now), WHEN[w]
    if w == "tomorrow":
        return (now + timedelta(days=1)).replace(hour=11, minute=0, second=0, microsecond=0), WHEN[w]
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", w)
    if m:
        t = now.replace(hour=int(m.group(1)) % 24, minute=int(m.group(2)) % 60, second=0, microsecond=0)
        if t < now - timedelta(minutes=5):
            t += timedelta(days=1)
        return t, f"ساعت {_fa(m.group(1))}:{_fa(m.group(2))}" + (" فردا" if t.date() > now.date() else "")
    return now, WHEN["now"]


def travel(km: float | None, in_traffic_zone: bool) -> dict | None:
    """Rough door-to-door minutes. Downtown Tehran: ~18 km/h by car, +parking; taxi without parking; walk 4.5 km/h."""
    if km is None:
        return None
    road = km * 1.4
    car = round(road / 18 * 60) + (12 if in_traffic_zone else 6)
    taxi = round(road / 18 * 60) + 4
    return {"walk": round(km * 1.3 / 4.5 * 60), "taxi": taxi, "car": car,
            "car_note": "داخل طرح ترافیک؛ بدون مجوز با خودرو نروید" if in_traffic_zone else None}


# ================================================================== step 2: where to go (zones)
def zones(cards: list[dict], limit: int = 3, later: bool = False) -> list[dict]:
    """Group the shops that list the product by mall (or area when not in a mall): a trip there covers several shops."""
    g: dict[str, dict] = {}
    for c in cards:
        key = c.get("mall_key") or f"~{c.get('area') or ''}"
        z = g.setdefault(key, {"key": key, "kind": "mall" if c.get("mall_key") else "area",
                               "name": c.get("mall") or f"محدودهٔ {c.get('area') or 'نامشخص'}", "area": c.get("area"),
                               "shops": [], "lat": [], "lon": []})
        z["shops"].append(c)
        if c.get("lat") is not None:
            z["lat"].append(c["lat"]); z["lon"].append(c["lon"])
    out = []
    for z in g.values():
        shops = z["shops"]
        if len(shops) < 2 and len(g) > 1:
            continue
        prices = [p for p in (_eff_price(s) for s in shops) if p]
        open_n = sum(1 for s in shops if s["open"]["state"] in ("open", "closing_soon"))
        dist = min((s["distance_km"] for s in shops if s.get("distance_km") is not None), default=None)
        conf = sum(1 for s in shops if (s.get("confirmation") or {}).get("state") in ("fresh", "aging")
                   and (s.get("confirmation") or {}).get("available") is not False)
        score = len(shops) * 1.0 + open_n * 0.8 + conf * 1.5 - (dist or 5) * 0.6
        out.append({"key": z["key"], "kind": z["kind"], "name": z["name"], "area": z["area"], "shop_count": len(shops),
                    "open_count": open_n, "confirmed_count": conf, "price_min": min(prices) if prices else None,
                    "distance_km": None if dist is None else round(dist, 2),
                    "walk_min": None if dist is None else round(dist * 1.3 / 4.5 * 60),
                    "lat": round(sum(z["lat"]) / len(z["lat"]), 5) if z["lat"] else None,
                    "lon": round(sum(z["lon"]) / len(z["lon"]), 5) if z["lon"] else None,
                    "shop_ids": [s["shop_id"] for s in shops][:12], "score": round(score, 2),
                    "why": _zone_why(len(shops), open_n, conf, prices, dist, later)})
    out.sort(key=lambda z: -z["score"])
    return out[:limit]


def _zone_why(n, open_n, conf, prices, dist, later=False) -> str:
    bits = [f"{_fa(n)} فروشگاه کنار هم"]
    if open_n:
        bits.append(f"{_fa(open_n)} تا {'وقت رسیدن' if later else 'الان'} باز")
    if conf:
        bits.append(f"{_fa(conf)} تأییدشده")
    if prices:
        bits.append(f"از {_mil(min(prices))}")
    if dist is not None:
        bits.append(f"{_fa(round(dist * 1.3 / 4.5 * 60))} دقیقه پیاده")
    return " · ".join(bits)


def _eff_price(c: dict) -> int | None:
    from .verify import effective_price
    return effective_price(c)


# ================================================================== step 2: real areas from the dataset
_AREAS: list | None = None


def areas(con) -> list[dict]:
    global _AREAS
    if _AREAS is None:
        rows = con.execute("SELECT location_label, COUNT(*) n, AVG(lat), AVG(lon), COUNT(DISTINCT mall_key), SUM(offer_count>0) "
                           "FROM shops WHERE location_label IS NOT NULL AND lat IS NOT NULL GROUP BY location_label "
                           "HAVING n >= 3 ORDER BY n DESC").fetchall()
        _AREAS = [{"label": r[0], "shop_count": r[1], "lat": round(r[2], 5), "lon": round(r[3], 5), "malls": r[4],
                   "shops_with_prices": r[5] or 0} for r in rows]
    return _AREAS


# ================================================================== step 1: variants and fair price
def _base_title(title: str) -> str:
    t = normalize_fa(title.split("|")[0])
    t = re.sub(r"\b(?:حافظه|ظرفیت|رم)\s*\S+(?:\s*(?:گیگ|گیگابایت|ترابایت))?", " ", t)
    t = re.sub(r"\b\d+\s*(?:گیگ|گیگابایت|ترابایت|gb|tb)\b", " ", t)
    t = re.sub(r"\s*-\s*(?:مشکی|سفید|آبی|قرمز|سبز|طلایی|نقره ای|بنفش|صورتی|خاکستری|زرد)\b.*$", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def variants(con, product_id: str, limit: int = 8) -> list[dict]:
    """Other storage/RAM/colour versions of the same model (same base title before '|', same category)."""
    from .catalog import _product_row
    p = con.execute("SELECT * FROM products WHERE product_id=?", (product_id,)).fetchone()
    if not p or not p["category"]:
        return []
    base = _base_title(p["title"])
    if len(base) < 6:
        return []
    rows = con.execute("SELECT * FROM products WHERE category=? AND product_id!=? AND shop_count>=1 AND title_norm LIKE ? "
                       "ORDER BY shop_count DESC LIMIT 40", (p["category"], product_id, base + "%")).fetchall()
    out = []
    for r in rows:
        if _base_title(r["title"]) != base:
            continue
        d = _product_row(r)
        d["variant"] = (r["title"].split("|", 1)[1].strip() if "|" in r["title"] else r["title"][len(base):].strip()) or r["title"]
        if p["price_median"] and r["price_median"]:
            d["vs_price_pct"] = round((r["price_median"] - p["price_median"]) / p["price_median"] * 100)
        out.append(d)
    return out[:limit]


def fair_price(con, product_id: str) -> dict | None:
    """Typical price from the shops' listed prices: interquartile range of non-outlier offers, and how old they are."""
    rows = con.execute("SELECT price, changed_at, outlier FROM offers WHERE product_id=? AND price > 0", (product_id,)).fetchall()
    prices = sorted(r["price"] for r in rows if not r["outlier"])
    if not prices:
        return None
    now = datetime.now(timezone.utc)
    ages = []
    for r in rows:
        try:
            ages.append((now - datetime.fromisoformat(r["changed_at"])).days)
        except (TypeError, ValueError):
            pass
    if len(prices) >= 4:
        q = statistics.quantiles(prices, n=4)
        lo, hi = int(q[0]), int(q[2])
    else:
        lo, hi = prices[0], prices[-1]
    med = int(statistics.median(prices))
    fresh = sum(1 for a in ages if a <= 7)
    return {"low": lo, "high": hi, "median": med, "min": prices[0], "max": prices[-1], "offers": len(prices),
            "outliers": sum(1 for r in rows if r["outlier"]), "fresh_offers": fresh,
            "oldest_days": max(ages) if ages else None, "newest_days": min(ages) if ages else None,
            "confidence": "high" if len(prices) >= 6 and fresh >= 2 else "medium" if len(prices) >= 3 else "low",
            "note": (f"بیشتر فروشگاه‌ها بین {_mil(lo)} و {_mil(hi)} ثبت کرده‌اند" if len(prices) >= 3 else
                     "فروشگاه کمی قیمت ثبت کرده‌اند؛ بازه قابل اتکا نیست")}


def price_verdict(price: int, fp: dict | None) -> dict | None:
    if not fp or not price:
        return None
    if price < fp["low"] * 0.85:
        return {"level": "warn", "text": "خیلی ارزان‌تر از بقیه؛ شاید قیمت قدیمی، نسخهٔ دیگر یا کالای کارکرده باشد"}
    if price <= fp["median"]:
        return {"level": "ok", "text": "منصفانه؛ ارزان‌تر از میانهٔ فروشگاه‌ها"}
    if price <= fp["high"]:
        return {"level": "ok", "text": "در بازهٔ معمول بازار"}
    return {"level": "warn", "text": f"گران‌تر از بیشتر فروشگاه‌ها ({_fa(round((price - fp['median']) / fp['median'] * 100))}٪ بالاتر از میانه)"}


# ================================================================== step 1: availability near me, per product
def availability(con, product_ids: list[str], origin: tuple[float, float], at: datetime | None = None,
                 walk_limit: int = 15) -> dict[str, dict]:
    """Per product: shops that list it, how many are within `walk_limit` minutes, open at `at`, with installments."""
    if not product_ids:
        return {}
    at = at or now_tehran()
    out = {pid: {"shops": 0, "near": 0, "open": 0, "installment": 0, "nearest_min": None} for pid in product_ids}
    for i in range(0, len(product_ids), 300):
        ch = product_ids[i:i + 300]
        rows = con.execute(
            f"SELECT o.product_id, s.shop_id, s.lat, s.lon, s.hours, "
            f"(SELECT 1 FROM shop_payments sp WHERE sp.shop_id=s.shop_id LIMIT 1) inst "
            f"FROM offers o JOIN shops s USING(shop_id) WHERE o.product_id IN ({','.join('?' * len(ch))})", ch).fetchall()
        hours_cache: dict[str, str] = {}
        seen = set()
        for r in rows:
            k = (r["product_id"], r["shop_id"])
            if k in seen:
                continue
            seen.add(k)
            a = out[r["product_id"]]
            a["shops"] += 1
            if r["lat"] is not None:
                m = round(haversine_km(origin[0], origin[1], r["lat"], r["lon"]) * 1.3 / 4.5 * 60)
                a["near"] += m <= walk_limit
                a["nearest_min"] = m if a["nearest_min"] is None else min(a["nearest_min"], m)
            st = hours_cache.get(r["shop_id"])
            if st is None:
                st = hours_cache[r["shop_id"]] = open_state(parse_hours_json(r["hours"]), at).state
            a["open"] += st in ("open", "closing_soon")
            a["installment"] += bool(r["inst"])
    return out


# ================================================================== step 1: specs, facets, need presets
_UNIT = [(r"ترابایت|tb\b", 1024), (r"گیگ|gb\b", 1)]


def num(value: str | None) -> float | None:
    """First number in a spec value; Persian digits, '~', thousands separators handled; TB -> GB."""
    if not value:
        return None
    t = normalize_fa(value).replace("٫", ".").replace("٬", "").replace(",", "")
    m = re.search(r"(\d+(?:\.\d+)?)", t)
    if not m:
        return None
    v = float(m.group(1))
    for pat, mult in _UNIT:
        if re.search(pat, t[m.end():m.end() + 12]):
            return v * mult
    return v


def _specs_map(con, ids: list[str]) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for i in range(0, len(ids), 400):
        ch = ids[i:i + 400]
        for r in con.execute(f"SELECT product_id, specs FROM product_specs WHERE product_id IN ({','.join('?' * len(ch))})", ch):
            try:
                out[r[0]] = {normalize_fa(s.get("key") or ""): s.get("value") or "" for s in json.loads(r[1] or "[]") or []}
            except (ValueError, TypeError, AttributeError):
                pass
    return out


def _unit(value: str) -> str:
    t = normalize_fa(value).replace("٫", ".")
    m = re.search(r"\d+(?:[.,]\d+)?\s*([^\d\s,،(]*)", t)
    u = (m.group(1) if m else "").strip("~.")
    return {"گیگ": "گیگابایت", "gb": "گیگابایت", "tb": "گیگابایت", "ترابایت": "گیگابایت"}.get(u, u)


def spec_facets(con, category: str, limit_keys: int = 6) -> list[dict]:
    """Filterable specs for a category: frequent keys and their frequent (normalized) values."""
    ids = [r[0] for r in con.execute("SELECT product_id FROM products WHERE category=? AND shop_count>=1 ORDER BY shop_count DESC LIMIT 1500",
                                     (category,))]
    sm = _specs_map(con, ids)
    keys, vals = Counter(), {}
    for spec in sm.values():
        for k, v in spec.items():
            if not k or len(v) > 40 or k in ("ابعاد", "مدل", "برند", "سایر مشخصات", "اقلام همراه"):
                continue
            keys[k] += 1
            vals.setdefault(k, Counter())[_norm_val(v)] += 1
    out = []
    for k, n in keys.most_common(30):
        top = [(v, c) for v, c in vals[k].most_common(8) if c >= 2 and v]
        if n < max(8, len(sm) * 0.15) or len(top) < 2:
            continue
        out.append({"key": k, "products": n, "values": [{"value": v, "count": c} for v, c in top[:6]]})
        if len(out) >= limit_keys:
            break
    return out


def _norm_val(v: str) -> str:
    t = normalize_fa(v).strip(" ,،")
    t = re.sub(r"\s*,\s*,?\s*$", "", t)
    t = t.replace("بی سیم", "بیسیم").replace("میلی آمپر ساعت", "میلی آمپرساعت")
    return t[:30]


def spec_matches(spec: dict[str, str], key: str, value: str) -> bool:
    v = spec.get(normalize_fa(key))
    return v is not None and _norm_val(v) == _norm_val(value)


# need presets: constraints over specs. op: '>=' | '<=' | 'has' (substring) ; price presets use key '__price'
RULE_PRESETS = {
    "گوشی": [
        {"id": "battery", "label": "باتری قوی", "why": "یک روز کامل بدون شارژ", "constraints": [{"key": "ظرفیت باتری", "op": ">=", "value": 5000}]},
        {"id": "storage", "label": "حافظهٔ زیاد", "why": "عکس و فیلم زیاد", "constraints": [{"key": "حافظه داخلی", "op": ">=", "value": 256}]},
        {"id": "gaming", "label": "بازی و کار سنگین", "why": "رم بیشتر و پردازندهٔ هشت‌هسته‌ای", "constraints": [{"key": "حافظه داخلی", "op": ">=", "value": 128}, {"key": "تعداد هسته پردازنده", "op": ">=", "value": 8}, {"key": "ظرفیت باتری", "op": ">=", "value": 5000}]},
        {"id": "nfc", "label": "پرداخت با NFC", "why": "پرداخت موبایلی و کارت‌های هوشمند", "constraints": [{"key": "NFC", "op": "has", "value": "دارد"}]},
    ],
    "هدفون": [
        {"id": "anc", "label": "حذف نویز", "why": "برای مترو و محیط شلوغ", "constraints": [{"key": "قابلیت نویز کنسلینگ", "op": "has", "value": "ANC"}]},
        {"id": "sport", "label": "ورزش", "why": "بی‌سیم و سبک", "constraints": [{"key": "نوع اتصال", "op": "has", "value": "بیسیم"}, {"key": "وزن", "op": "<=", "value": 60}]},
        {"id": "gaming", "label": "گیمینگ", "why": "مناسب بازی، با میکروفون", "constraints": [{"key": "مناسب برای", "op": "has", "value": "گیمینگ"}]},
        {"id": "wireless", "label": "بی‌سیم", "why": "بدون سیم", "constraints": [{"key": "نوع اتصال", "op": "has", "value": "بیسیم"}]},
    ],
}
GENERIC = [
    {"id": "cheap", "label": "اقتصادی", "why": "ارزان‌ترین‌ها با فروشگاه نزدیک", "constraints": [], "sort": "price"},
    {"id": "available", "label": "در دسترس‌ترین", "why": "بیشترین فروشگاه نزدیک؛ اگر یکی نداشت، بعدی", "constraints": [], "sort": "near"},
]


def fit(spec: dict[str, str], constraints: list[dict]) -> list[dict]:
    """Per constraint: {key, wanted, value (product's), ok: True|False|None (unknown)}."""
    out = []
    for c in constraints:
        k = normalize_fa(c["key"])
        raw = spec.get(k)
        if raw is None:
            # tolerate key variants («بلوتوث» vs «نسخه بلوتوث»)
            raw = next((v for kk, v in spec.items() if k in kk or kk in k), None)
        ok = None
        if raw is not None:
            if c["op"] == "has":
                ok = normalize_fa(str(c["value"])).replace(" ", "") in normalize_fa(raw).replace(" ", "")
            else:
                n = num(raw)
                if n is not None:
                    ok = n >= float(c["value"]) if c["op"] == ">=" else n <= float(c["value"])
        wanted = {">=": "حداقل", "<=": "حداکثر", "has": ""}[c["op"]]
        out.append({"key": c["key"], "wanted": f"{wanted} {_fa(c['value'])}".strip(), "value": raw, "ok": ok})
    return out


def _cat_rules(category: str | None) -> list[dict]:
    c = normalize_fa(category or "")
    for k, v in RULE_PRESETS.items():
        if normalize_fa(k) in c:
            return v
    return []


PRESET_PROMPT = """You design shopping "need presets" for an in-person shopping assistant in Tehran (Persian UI).
Given a product category and the spec keys that its products actually have (with sample values), propose up to 4 presets a
normal shopper would think in (e.g. "for sport", "long battery", "for a big room"). Each preset maps to 1-3 constraints
using ONLY the given keys. op is ">=" or "<=" (numeric: the first number in the value, in the units shown) or "has"
(the value contains this text, copy a word from the samples). Labels: short colloquial Persian (max 18 chars).
Reply JSON: {"presets": [{"label": "...", "why": "short Persian", "constraints": [{"key": "...", "op": ">=", "value": 5000}]}]}"""


async def need_presets(con, category: str, llm=None) -> dict:
    """Presets for a category: cached LLM proposal (keys validated against real specs) or rules; plus generic ones."""
    key = f"presets:{category}"
    try:
        r = con.execute("SELECT v FROM bale_kv WHERE k=?", (key,)).fetchone()
    except Exception:
        r = None
    if r:
        cached = json.loads(r[0])
        return {"category": category, "presets": cached["presets"] + GENERIC, "source": cached["source"]}
    use_llm = bool(llm and getattr(llm, "configured", False))
    facets = spec_facets(con, category, limit_keys=14) if use_llm else []
    presets, source = [], "rules"
    if use_llm and facets:
        user = json.dumps({"category": category, "specs": [{"key": f["key"], "samples": [v["value"] for v in f["values"][:4]]}
                                                          for f in facets]}, ensure_ascii=False)
        try:
            raw = await llm.complete_json([{"role": "system", "content": PRESET_PROMPT}, {"role": "user", "content": user}])
            known = {normalize_fa(f["key"]): f["key"] for f in facets}
            for i, p in enumerate(raw.get("presets") or []):
                cons = []
                for c in p.get("constraints") or []:
                    k = known.get(normalize_fa(str(c.get("key", ""))))
                    op = c.get("op")
                    if not k or op not in (">=", "<=", "has"):
                        continue
                    v = c.get("value")
                    if op != "has":
                        try:
                            v = float(v)
                        except (TypeError, ValueError):
                            continue
                        v = int(v) if v == int(v) else v
                    cons.append({"key": k, "op": op, "value": v})
                if cons and str(p.get("label", "")).strip():
                    presets.append({"id": f"p{i}", "label": str(p["label"]).strip()[:24], "why": str(p.get("why", ""))[:80], "constraints": cons})
            presets = presets[:4]
            source = "llm" if presets else "rules"
        except Exception:
            presets = []
    if not presets:
        presets, source = _cat_rules(category), "rules"
        return {"category": category, "presets": presets + GENERIC, "source": source}  # cheap: not cached, LLM may come later
    try:
        con.execute("INSERT OR REPLACE INTO bale_kv(k,v) VALUES(?,?)", (key, json.dumps({"presets": presets, "source": source}, ensure_ascii=False)))
        con.commit()
    except Exception:
        pass
    return {"category": category, "presets": presets + GENERIC, "source": source}


# ================================================================== step 1: search with needs and conditions
def refine(con, items: list[dict], *, constraints: list[dict] | None = None, specs_eq: list[tuple[str, str]] | None = None,
           cond: dict | None = None, origin=None, at=None, sort: str | None = None) -> list[dict]:
    """Re-rank / filter a ranked candidate list. constraints: soft (more fits rank higher, shown as reasons);
    specs_eq: hard spec filters; cond: hard purchase conditions {near, installment, open}; sort: price | near."""
    from .catalog import DEFAULT_LOC
    origin = origin or DEFAULT_LOC
    ids = [p["product_id"] for p in items]
    sm = _specs_map(con, ids) if (constraints or specs_eq) else {}
    av = availability(con, ids, origin, at)
    out = []
    for i, p in enumerate(items):
        sp = sm.get(p["product_id"], {})
        if specs_eq and not all(spec_matches(sp, k, v) for k, v in specs_eq):
            continue
        a = av.get(p["product_id"]) or {}
        p["near"] = a
        if cond:
            if cond.get("near") and not a.get("near"):
                continue
            if cond.get("installment") and not a.get("installment"):
                continue
            if cond.get("open") and not a.get("open"):
                continue
        if constraints:
            f = fit(sp, constraints)
            p["fit"] = f
            good = sum(1 for x in f if x["ok"])
            bad = sum(1 for x in f if x["ok"] is False)
            p["fit_score"] = good - bad * 1.2 - (0.3 * sum(1 for x in f if x["ok"] is None))
        p["_i"] = i
        out.append(p)
    if constraints:
        out.sort(key=lambda p: (-p["fit_score"], p["_i"]))
    if sort == "price":
        out.sort(key=lambda p: (p["price_min"] is None, p["price_min"] or 0) if (p.get("near") or {}).get("shops") else (True, 0))
    elif sort == "near":
        out.sort(key=lambda p: (-(p.get("near") or {}).get("near", 0), -(p.get("near") or {}).get("shops", 0)))
    for p in out:
        p.pop("_i", None)
    return out


# ================================================================== step 1: compare insights and verdict
HIGHER = ["ظرفیت باتری", "عمر باتری", "حافظه داخلی", "مقدار ram", "رم", "تراکم پیکسلی", "نرخ نوسازی", "تعداد هسته", "نسخه بلوتوث",
          "مگاپیکسل", "دوربین", "محدوده عملکرد", "توان", "تعداد کانال", "گارانتی", "حساسیت", "قطر درایور"]
LOWER = ["وزن", "ضخامت", "زمان شارژ"]


def _direction(key: str) -> int:
    k = normalize_fa(key)
    if any(normalize_fa(x) in k for x in LOWER):
        return -1
    if any(normalize_fa(x) in k for x in HIGHER):
        return 1
    return 0


def compare_insights(products: list[dict], rows: list[dict], avail: dict[str, dict] | None = None) -> dict:
    """Winner per numeric spec row (with a known better direction), per-product wins, price/availability winners."""
    n = len(products)
    wins = [[] for _ in range(n)]
    for r in rows:
        d = _direction(r["key"])
        if not d or not r["differs"]:
            r["best"] = None
            continue
        nums = [num(v) for v in r["values"]]
        known = [(x, i) for i, x in enumerate(nums) if x is not None]
        if len({_unit(r["values"][i]) for _, i in known}) > 1:  # «4K» vs «1080p», «۵.۳» vs «دارد»: not comparable
            r["best"] = None
            continue
        if len(known) < 2 or len({x for x, _ in known}) < 2:
            r["best"] = None
            continue
        best = max(known)[0] if d > 0 else min(known)[0]
        r["best"] = [i for x, i in known if x == best]
        for i in r["best"]:
            wins[i].append(r["key"])
    prices = [(p["price_min"], i) for i, p in enumerate(products) if p.get("price_min")]
    cheapest = min(prices)[1] if prices else None
    near = None
    if avail:
        nn = [((avail.get(p["product_id"]) or {}).get("near", 0), i) for i, p in enumerate(products)]
        if any(x for x, _ in nn):
            near = max(nn)[1]
    summary = []
    for i, p in enumerate(products):
        bits = []
        if wins[i]:
            bits.append("بهتر در " + "، ".join(wins[i][:3]))
        if i == cheapest and len(prices) > 1:
            other = sorted(x for x, j in prices if j != i)[0]
            bits.append(f"{_fa(round((other - p['price_min']) / other * 100))}٪ ارزان‌تر")
        if near is not None and i == near:
            bits.append("بیشترین فروشگاه نزدیک")
        summary.append({"product_id": p["product_id"], "wins": wins[i], "text": "؛ ".join(bits) or "برتری مشخصی در مشخصات ثبت‌شده ندارد"})
    return {"cheapest": cheapest, "most_available": near, "per_product": summary}


VERDICT_PROMPT = """You help a shopper in Tehran choose between 2-4 products. Use ONLY the given data (specs, price range,
shops nearby). If the shopper wrote a need, decide for that need. Reply JSON:
{"pick": "<product_id>", "headline": "one short Persian sentence", "reasons": ["max 3 short Persian reasons, each citing a spec or a number"],
 "tradeoff": "one short Persian sentence on what the other option does better" | null,
 "per_need": [{"need": "short Persian", "product_id": "<id>"}]}  (per_need: 2-3 typical needs)"""


async def compare_verdict(products: list[dict], rows: list[dict], insights: dict, avail: dict, need: str | None, llm=None) -> dict:
    ids = [p["product_id"] for p in products]
    rule = _rule_verdict(products, insights, avail)
    if not (llm and getattr(llm, "configured", False)):
        return rule
    data = {"need": need, "products": [{"id": p["product_id"], "title": p["title"], "price_from": p.get("price_min"),
                                        "price_median": p.get("price_median"), "shops_total": p.get("shop_count"),
                                        "shops_near": (avail.get(p["product_id"]) or {}).get("near")} for p in products],
            "spec_rows": [{"key": r["key"], "values": r["values"]} for r in rows if r["differs"]][:30]}
    try:
        raw = await llm.complete_json([{"role": "system", "content": VERDICT_PROMPT},
                                       {"role": "user", "content": json.dumps(data, ensure_ascii=False)}])
    except Exception:
        return rule
    if raw.get("pick") not in ids:
        return rule
    return {"pick": raw["pick"], "headline": str(raw.get("headline", ""))[:160],
            "reasons": [str(x)[:140] for x in (raw.get("reasons") or [])[:3]],
            "tradeoff": (str(raw["tradeoff"])[:160] if raw.get("tradeoff") else None),
            "per_need": [{"need": str(x.get("need", ""))[:40], "product_id": x["product_id"]} for x in (raw.get("per_need") or [])
                         if isinstance(x, dict) and x.get("product_id") in ids][:3],
            "source": "llm", "need": need}


def _rule_verdict(products, insights, avail) -> dict:
    def score(i, p):
        a = avail.get(p["product_id"]) or {}
        return len(insights["per_product"][i]["wins"]) + min(a.get("near", 0), 6) * 0.5 + (1.5 if i == insights["cheapest"] else 0)
    best = max(range(len(products)), key=lambda i: score(i, products[i]))
    p = products[best]
    reasons = [insights["per_product"][best]["text"]]
    a = avail.get(p["product_id"]) or {}
    if a.get("near"):
        reasons.append(f"{_fa(a['near'])} فروشگاه تا ۱۵ دقیقه پیاده")
    per_need = []
    if insights["cheapest"] is not None:
        per_need.append({"need": "کمترین قیمت", "product_id": products[insights["cheapest"]]["product_id"]})
    if insights["most_available"] is not None:
        per_need.append({"need": "خرید همین امروز، نزدیک", "product_id": products[insights["most_available"]]["product_id"]})
    return {"pick": p["product_id"], "headline": f"«{p['title'][:50]}» در مجموع بهتر است", "reasons": reasons,
            "tradeoff": None, "per_need": per_need, "source": "rules", "need": None}


# ================================================================== step 3: compare shops
PRIORITIES = {  # weights for (price, distance, freshness/trust, open)
    "balanced": (0.35, 0.30, 0.20, 0.15),
    "price": (0.65, 0.15, 0.10, 0.10),
    "near": (0.15, 0.65, 0.10, 0.10),
    "trust": (0.20, 0.15, 0.55, 0.10),
    "now": (0.20, 0.30, 0.10, 0.40),
}
PRIORITY_FA = {"balanced": "متعادل", "price": "قیمت", "near": "نزدیکی", "trust": "اطلاعات مطمئن", "now": "همین الان بروم"}


def compare_shops(con, product_id: str, shop_ids: list[str], origin=None, at: datetime | None = None,
                  priority: str = "balanced") -> dict:
    from . import catalog
    res = catalog.find_shops(con, [product_id], origin=origin, include_category_only=True, sort="best", limit=200, at=at,
                             weights=PRIORITIES.get(priority))
    allc = {s["shop_id"]: s for s in res["listed"] + res["category_only"]}
    cols = [allc[i] for i in shop_ids if i in allc]
    if not cols:
        return {"shops": [], "winners": {}, "verdict": [], "priority": priority}
    for s in cols:
        if s["tier"] != "listed":
            s["score"] = 9.0
    cols.sort(key=lambda s: s.get("score", 9))

    def best(fn, low=True):
        vals = [(fn(s), s["shop_id"]) for s in cols]
        vals = [(v, i) for v, i in vals if v is not None]
        if len(vals) < 2 or len({v for v, _ in vals}) < 2:
            return []
        b = min(vals)[0] if low else max(vals)[0]
        return [i for v, i in vals if v == b]

    def close_min(s):
        c = s["open"].get("closes_at")
        return int(c[:2]) * 60 + int(c[3:5]) if c and s["open"]["state"] in ("open", "closing_soon") else None

    def trust(s):
        c, o, r = s.get("confirmation"), s.get("offer") or {}, s.get("reliability") or {}
        t = 0.0
        if c and c["state"] != "expired" and c["available"] is not False:
            t += 2 if c["state"] == "fresh" else 1
        if o.get("age_days") is not None:
            t += 1 if o["age_days"] <= 7 else 0.5 if o["age_days"] <= 30 else 0
        if r.get("known"):
            t += r["score"]
        t -= 0.7 * len(o.get("flags") or [])
        return round(t, 2)

    winners = {
        "price": best(_eff_price), "distance": best(lambda s: s.get("distance_km")),
        "freshness": best(lambda s: (s.get("offer") or {}).get("age_days")), "closes": best(close_min, low=False),
        "warranty": best(lambda s: (s.get("offer") or {}).get("warranty_months"), low=False),
        "trust": best(trust, low=False),
    }
    for s in cols:
        s["trust_score"] = trust(s)
    verdict = []
    names = {s["shop_id"]: s["name"] for s in cols}

    def add(label, ids, why):
        if ids:
            verdict.append({"for": label, "shop_id": ids[0], "name": names[ids[0]], "why": why(next(s for s in cols if s["shop_id"] == ids[0]))})

    add("ارزان‌ترین", winners["price"], lambda s: f"{_mil(_eff_price(s))} تومان" + (
        "، تأییدشده" if (s.get("confirmation") or {}).get("price") == _eff_price(s) else
        f"، ولی قیمت {_fa((s.get('offer') or {}).get('age_days') or 0)} روز پیش ثبت شده" if ((s.get("offer") or {}).get("age_days") or 0) > 7 else ""))
    add("نزدیک‌ترین", winners["distance"], lambda s: f"{_fa(s.get('walk_min'))} دقیقه پیاده")
    now_ok = [s["shop_id"] for s in cols if s["open"]["state"] in ("open", "closing_soon")]
    now_ok.sort(key=lambda i: allc[i].get("distance_km") or 9)
    add("برای رفتن همین حالا" if at is None else "باز وقتی می‌رسید", now_ok,
        lambda s: f"{s['open']['label']}، {_fa(s.get('walk_min'))} دقیقه پیاده")
    add("مطمئن‌ترین اطلاعات", winners["trust"], lambda s: "قیمت/موجودی تأییدشده" if (s.get("confirmation") or {}).get("state") in ("fresh", "aging")
        else (s.get("reliability") or {}).get("label") or "قیمت تازه‌تر و بدون نشانهٔ هشدار در آگهی")
    malls = Counter(s.get("mall") for s in cols if s.get("mall"))
    one_trip = malls.most_common(1)[0] if malls and malls.most_common(1)[0][1] >= 2 else None
    return {"shops": cols, "winners": winners, "verdict": verdict, "priority": priority, "priority_label": PRIORITY_FA.get(priority),
            "one_trip": {"mall": one_trip[0], "count": one_trip[1]} if one_trip else None,
            "at": at.isoformat() if at else None}
