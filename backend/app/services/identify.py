"""Snap-to-identify: a shopper photographs a product (box, label or price tag) inside a shop.

A vision model reads only what is visible (brand, model, any price on a tag); the catalogue search then finds candidate
products and the shopper confirms which one it is. Photos are processed in memory and never stored. The model is told
not to invent model numbers; whatever it read is returned so the UI can show it as «از عکس خوانده شد» and let the user edit it.
"""
from __future__ import annotations
import base64
import json
import math
import os
import re
from datetime import datetime, timezone

from . import catalog
from .text import normalize_fa

DAILY_CAP = int(os.environ.get("IDENTIFY_DAILY_CAP", "600"))
MAX_BYTES = 2_500_000  # after base64 decoding; the client sends a ~1024 px JPEG (~150 KB)
_spent = {"day": "", "n": 0}

PROMPT = (
    "You identify a retail product from a shopper's photo taken inside a shop in Tehran. Read only what is visible. "
    "Return JSON with keys: brand, brand_fa, model, product_type_fa, search_query_fa, price_text, visible_text, confidence. "
    "brand/model: Latin, exactly as printed on the product or box; null when not visible. Never invent or complete a model number. "
    "brand_fa: the common Persian name of the brand (e.g. Anker → انکر) or null. product_type_fa: a short Persian noun phrase "
    "(e.g. «هندزفری گردنی»). search_query_fa: what to type into a Persian product search (type + brand + model). "
    "price_text: only if a price tag or label is visible, copy it character by character exactly as printed: every digit and every "
    "separator, plus the unit word if one is printed (تومان, ریال, هزار). Do not convert, round, drop zeros or change the unit; "
    "count the digit groups carefully. null when no price is visible. visible_text: up to 200 characters of the important printed text. "
    "confidence: high (brand and model clearly visible), medium (brand or type clear, model partial), low (only the kind of product)."
)


_FA = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _price_from_text(t: str | None) -> int | None:
    """«۳٬۲۰۰٬۰۰۰ تومان» → 3200000; rial tags are divided by 10. Thousand separators of any script are ignored."""
    if not t:
        return None
    digits = re.sub(r"[^0-9]", "", t.translate(_FA))
    if not digits or len(digits) > 12:
        return None
    n = int(digits)
    if "ریال" in t or "rial" in t.lower():
        n //= 10
    elif re.search(r"هزار|k\b", t, re.I) and n < 100_000:
        n *= 1000  # «۸۵۰ هزار»
    return n or None


def _budget_ok() -> bool:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if _spent["day"] != day:
        _spent.update(day=day, n=0)
    return _spent["n"] < DAILY_CAP


def decode_image(data_url: str) -> tuple[str, bytes]:
    m = re.match(r"^data:(image/(?:jpeg|png|webp));base64,(.+)$", data_url or "", re.S)
    if not m:
        raise ValueError("عکس باید JPEG، PNG یا WebP باشد.")
    raw = base64.b64decode(m.group(2), validate=False)
    if len(raw) > MAX_BYTES:
        raise ValueError("عکس خیلی بزرگ است؛ دوباره امتحان کنید.")
    return m.group(1), raw


async def read_photo(llm, data_url: str) -> dict:
    """One vision call. Raises RuntimeError when the model is unavailable or over the daily cap."""
    if not (llm and getattr(llm, "configured", False)):
        raise RuntimeError("تشخیص از روی عکس الان در دسترس نیست. نام یا مدل کالا را بنویسید.")
    if not _budget_ok():
        raise RuntimeError("سقف روزانهٔ تشخیص عکس پر شده است. نام یا مدل کالا را بنویسید.")
    _spent["n"] += 1
    out = ""
    async for kind, val in llm.stream([
        {"role": "system", "content": PROMPT},
        {"role": "user", "content": [
            {"type": "text", "text": "این کالا چیست؟ فقط آنچه در عکس دیده می‌شود."},
            {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},  # low detail misreads small Persian digits (۲/۳)
        ]},
    ], None, json_mode=True):
        if kind == "text":
            out += val
    try:
        raw = json.loads(out)
    except json.JSONDecodeError:
        raw = {}
    s = lambda k: (str(raw.get(k)).strip() or None) if raw.get(k) not in (None, "", "null") else None
    # the model only transcribes the tag; unit conversion happens here (it once turned a ۳٬۲۰۰٬۰۰۰ تومان tag into ۳۲۰٬۰۰۰).
    # The shopper still confirms the price before any verdict (SnapView).
    price = _price_from_text(s("price_text"))
    conf = raw.get("confidence") if raw.get("confidence") in ("high", "medium", "low") else "low"
    return {"brand": s("brand"), "brand_fa": s("brand_fa"), "model": s("model"), "product_type": s("product_type_fa"),
            "search_query": s("search_query_fa"), "price_seen": price if price and price > 0 else None,
            "price_text": s("price_text"), "visible_text": (s("visible_text") or "")[:200] or None, "confidence": conf}


# words that mark an accessory listing (case, screen guard, charger...) rather than the product itself
ACCESSORY = [normalize_fa(w) for w in ("کیف", "قاب", "کاور", "محافظ", "گلس", "شارژر", "کابل", "باتری", "لوازم جانبی", "هولدر", "پایه", "دوربین پشت", "ال سی دی", "تاچ", "درب پشت", "بند",
    "دوربین گوشی", "آنتن", "فلت", "برد گوشی", "قطعات", "اسپیکر گوشی", "میکروفون گوشی", "سوکت", "دکمه", "تعمیر")]


def _model_tokens(model: str | None) -> list[str]:
    """«Life U2i (Upgraded)» → ['life', 'u2i']: bracketed qualifiers and edition words are not part of catalogue titles."""
    m = re.sub(r"[\(\[].*?[\)\]]", " ", model or "")
    m = re.sub(r"\b(upgraded|edition|version|new|original|global|gen)\b", " ", m, flags=re.I)
    return [t for t in re.split(r"[\s\-_/]+", normalize_fa(m)) if len(t) > 1]


def _queries(r: dict) -> list[str]:
    """Most specific first: the printed model number finds the exact listing; descriptive text is the fallback."""
    toks, brand, brand_fa = _model_tokens(r.get("model")), r.get("brand"), r.get("brand_fa")
    qs = []
    if toks:
        model = " ".join(toks)
        qs += [model, f"{brand_fa or brand or ''} {model}".strip()]
        if len(toks) > 1:
            qs.append(" ".join(toks[1:]) if len(toks[-1]) <= 2 else " ".join(toks[:-1]))  # drop one word and retry
    if brand_fa and r.get("product_type"):
        qs.append(f"{r['product_type']} {brand_fa}")
    if r.get("search_query"):
        qs.append(r["search_query"])
    if r.get("product_type"):
        qs.append(r["product_type"])
    seen, out = set(), []
    for q in qs:
        k = normalize_fa(q)
        if k and k not in seen:
            seen.add(k); out.append(q)
    return out


def candidates(con, r: dict, k: int = 4) -> tuple[list[dict], str | None, str]:
    """Candidate products for what was read, the query that produced them, and how good the match is:
    exact (this model, right kind of product) · related (only accessories/parts of this model) · type_only (no model read) · none."""
    toks = _model_tokens(r.get("model"))
    qs = _queries(r)
    brands = [normalize_fa(b) for b in (r.get("brand"), r.get("brand_fa")) if b]
    ptype = normalize_fa(r.get("product_type") or "")
    type_words = [w for w in ptype.split() if len(w) > 2]
    accessory_photo = any(w in ptype for w in ACCESSORY)
    hits = lambda p: sum(t in normalize_fa(p["title"]) for t in toks)

    def same_kind(p) -> bool:
        c, t = normalize_fa(p.get("category") or ""), normalize_fa(p["title"])
        if not accessory_photo and (any(w in c for w in ACCESSORY) or any(t.startswith(w) for w in ACCESSORY)):
            return False  # a case or a spare part, while the photo shows the product itself
        return any(w in c or w in t for w in type_words) if type_words else True

    def rank(p):
        t = normalize_fa(p["title"])
        weight = 3 * any(b in t for b in brands) + math.log2((p.get("shop_count") or 0) + 1)  # brand and availability together
        return (-hits(p), -same_kind(p), -weight)  # model match, then «is it the product itself», then brand/availability

    for i, q in enumerate(qs):
        items = catalog.search_products(con, q, None, None, None, None, True, 24, 0)["items"]
        if not items:
            continue
        items = sorted(items, key=rank)
        # a model was read: accept only results that contain most of it; otherwise try the next, broader query
        if toks and hits(items[0]) < max(1, round(len(toks) * 0.6)) and i < len(qs) - 1:
            continue
        if toks and hits(items[0]):
            items = [p for p in items if hits(p)] or items  # keep listings of this model only
            match = "exact" if same_kind(items[0]) else "related"
        else:
            match = "type_only"
        return items[:k], q, match
    return [], None, "none"
