"""Export REAL records covering the data edge cases, for Claude Design mocks.  python -m app.ingest.fixtures"""
import json
from pathlib import Path

from app import db
from app.main import app
from app.services import catalog as c

OUT = Path(__file__).resolve().parents[3] / "docs" / "fixtures"


def dump(name, obj):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print("wrote", name)


def main():
    con = db.connect()
    s = c.search_products(con, "هندزفری", limit=60)
    prods = [p for p in s["items"] if p["shop_count"] >= 5] or [p for p in s["items"] if p["shop_count"] >= 3]
    assert len(prods) >= 2, "need two multi-shop products for the compare fixture"
    dump("search_results", {**s, "facets": c.facets(con, "هندزفری"), "items": s["items"][:12]})
    dump("product_detail", c.get_product(con, prods[0]["product_id"]))
    dump("product_compare", c.compare_products(con, [prods[0]["product_id"], prods[1]["product_id"]]))
    dump("similar_products", {"items": c.similar_products(con, prods[0]["product_id"], 5)})
    res = c.find_shops(con, [prods[0]["product_id"]], limit=6)
    dump("shops_for_product", res)
    dump("shops_for_product_installment_only", c.find_shops(con, [prods[0]["product_id"]], installment=True, limit=4))

    def first(sql, *a):
        r = con.execute(sql, a).fetchone()
        return c.get_shop(con, r[0]) if r else None
    dump("shop_full_hours_in_mall", first("SELECT shop_id FROM shops WHERE hours_quality='ok' AND mall IS NOT NULL AND floor>=3 AND unit IS NOT NULL AND offer_count>5 LIMIT 1"))
    dump("shop_no_hours", first("SELECT shop_id FROM shops WHERE hours_quality='missing' AND offer_count>0 LIMIT 1"))
    dump("shop_suspicious_hours", first("SELECT shop_id FROM shops WHERE hours_quality='suspicious' LIMIT 1"))
    dump("shop_no_mall_street_only", first("SELECT shop_id FROM shops WHERE mall IS NULL AND offer_count>0 LIMIT 1"))
    dump("shop_installment_in_person", first("SELECT shop_id FROM shop_payments WHERE channel='in_person' LIMIT 1"))
    dump("shop_installment_channel_unknown", first("SELECT shop_id FROM shop_payments WHERE channel='unknown' LIMIT 1"))
    dump("shop_real_name_with_website", first("SELECT shop_id FROM shops WHERE is_real_name=1 AND website IS NOT NULL LIMIT 1"))
    dump("shop_category_only_no_offers", first("SELECT shop_id FROM shops WHERE offer_count=0 AND hours_quality='ok' LIMIT 1"))
    dump("shop_fast_delivery_false", first("SELECT shop_id FROM shops WHERE fast_delivery=0 LIMIT 1"))
    # price edge cases
    edge = {}
    for label, cond in {"stale_over_90_days": "o.changed_at < '2026-07-01'", "no_price": "o.price IS NULL",
                        "suspicious_price": "o.outlier=1", "with_warranty": "o.warranty_months>=12"}.items():
        r = con.execute(f"SELECT o.shop_id, o.product_id FROM offers o WHERE {cond} LIMIT 1").fetchone()
        if r:
            sh = c.find_shops(con, [r[1]], include_category_only=False)["listed"]
            edge[label] = next((x for x in sh if x["shop_id"] == r[0]), None)
    dump("offer_edge_cases", edge)
    mk = c.list_malls(con, 12)
    dump("malls", {"items": mk})
    dump("mall_directory", c.mall_directory(con, mk[0]["mall_key"]))
    dump("top_categories", {"items": [dict(name=r[0], n=r[1]) for r in con.execute(
        "SELECT category, COUNT(*) FROM products WHERE shop_count>=2 GROUP BY category ORDER BY 2 DESC LIMIT 24")]})
    # inquiry timeline: hand-built states mirroring GET /api/sessions/{id}/inquiries (see api-contract)
    sh = res["listed"][:4]
    base = lambda i, st, label, ans: {"id": f"inq_demo{i}", "status": st, "label": label, "answer": ans,
                                       "shop": {k: sh[i][k] for k in ("shop_id", "name", "mall", "floor_label", "unit", "area", "address", "lat", "lon")},
                                       "product": {"product_id": prods[0]["product_id"], "title": prods[0]["title"], "image": prods[0]["image"]},
                                       "created_at": "2026-10-21T15:05:00+00:00", "deadline_at": "2026-10-21T15:10:00+00:00",
                                       "questions": [{"key": "stock", "text": "آیا الان موجود است؟"}, {"key": "price", "text": "قیمت نهایی امروز چقدر است؟"}]}
    dump("inquiries_all_states", {"_note": "sent/delivered/answered/unavailable/no_reply states. unavailable & no_reply carry `alternatives`.", "items": [
        base(0, "sent", "ارسال شد", None), base(1, "delivered", "دیده شد", None),
        base(2, "answered", "پاسخ داد", {"available": True, "price": 2_850_000, "message": "موجوده، تشریف بیارید.", "closes_at": "19:00", "installment": True, "simulated": False}),
        {**base(3, "unavailable", "ناموجود است", {"available": False, "message": "تموم شده", "price": None, "simulated": False}),
         "alternatives": {"kind": "same_product", "shops": res["listed"][1:3], "products": []}}]})
    dump("visit_plan_SPEC_not_yet_implemented", {"_note": "Target shape for the visit plan screen (backend endpoint comes next).", "start": {"label": "موقعیت شما"},
        "stops": [{"order": 1, "shop_id": sh[0]["shop_id"], "name": sh[0]["name"], "mall": sh[0]["mall"], "floor_label": sh[0]["floor_label"], "unit": sh[0]["unit"],
                   "arrive_by": "17:30", "closes_at": "19:00", "walk_min_from_previous": 6, "confirmed_price": 2850000, "confirmed_by_seller": True,
                   "tips": ["گارانتی را روی بسته‌بندی چک کنید", "فاکتور رسمی بگیرید"]}],
        "transport": {"in_traffic_zone": True, "suggestion": "ایستگاه مترو حافظ یا امام خمینی نزدیک‌ترین است؛ ورود با خودرو به طرح ترافیک مجاز نیست مگر با مجوز."},
        "deep_links": {"neshan": "https://nshn.ir/?lat=35.69&lng=51.41", "balad": "https://balad.ir/location?latitude=35.69&longitude=51.41", "google": "https://maps.google.com/?q=35.69,51.41"}})
    dump("openapi_summary", {"paths": sorted(app.openapi()["paths"])})
    (OUT.parent / "openapi.json").write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
