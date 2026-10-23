"""«While you're here»: things that go with what you are buying and are sold in the SAME mall as your stop, so adding one costs a few steps.
The pairing is a small hand-written list of accessories (the data has no purchase history, so nothing here says «people also bought»);
the offers are real: this mall's cheapest listing of each suggestion, with the shop and its floor and unit."""
from __future__ import annotations

from .text import normalize_fa

# what goes with what: keywords in the product's title or category → (label shown, the catalogue category that holds the accessory)
PAIRS = [
    (("گوشی", "موبایل"), [("قاب و کاور", "کیف و کاور گوشی"), ("محافظ صفحه", "محافظ صفحه نمایش گوشی"), ("شارژر", "شارژر گوشی"), ("هندزفری", "هدفون، هدست و هندزفری"), ("پاوربانک", "پاوربانک و شارژر همراه")]),
    (("لپ تاپ", "لپتاپ", "لپ‌تاپ"), [("کیف لپ‌تاپ", "کیف و کاور لپ تاپ")]),
    (("تبلت",), [("محافظ صفحه", "محافظ صفحه نمایش تبلت")]),
    (("هندزفری", "هدفون", "ایرپاد"), [("کاور هندزفری", "کیف و کاور هدفون و هندزفری")]),
    (("دوربین عکاسی", "دوربین دیجیتال"), [("کارت حافظه", "کارت حافظه")]),
]
MIN_PRICE = 15_000  # below this a listing is a placeholder or a part, not the accessory


def suggest(con, mall_key: str, product_id: str, limit: int = 4) -> list[dict]:
    p = con.execute("SELECT title, category FROM products WHERE product_id=?", (product_id,)).fetchone()
    if not p or not mall_key:
        return []
    text = normalize_fa(f"{p['title']} {p['category'] or ''}")
    want: list[tuple[str, str]] = []
    for keys, acc in PAIRS:
        if any(normalize_fa(k) in text for k in keys):
            want += acc
    out, seen = [], set()
    for label, cat in dict.fromkeys(want):
        row = con.execute(
            "SELECT o.product_id, p.title, MIN(o.price) price, s.shop_id, s.name, s.floor_label, s.unit, s.plaque FROM offers o "
            "JOIN products p ON p.product_id=o.product_id JOIN shops s ON s.shop_id=o.shop_id "
            "WHERE s.mall_key=? AND p.category=? AND o.price>=? AND COALESCE(o.outlier,0)=0 AND o.product_id<>? GROUP BY o.product_id ORDER BY price LIMIT 1",
            (mall_key, cat, MIN_PRICE, product_id)).fetchone()
        if row and row["product_id"] not in seen:
            seen.add(row["product_id"])
            out.append({"product_id": row["product_id"], "title": row["title"], "price": row["price"], "shop_id": row["shop_id"], "shop": row["name"],
                        "floor_label": row["floor_label"], "unit": row["unit"], "plaque": row["plaque"], "why": label})
        if len(out) >= limit:
            break
    return out
