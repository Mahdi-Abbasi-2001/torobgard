from datetime import datetime
from app import db
from app.services import catalog, visit_plan
from app.services.hours import TEHRAN

def _shops(con):
    items = catalog.search_products(con, "هندزفری", limit=60)["items"]
    pid = next(p for p in items if p["shop_count"] >= 3)["product_id"]
    return [s for s in catalog.find_shops(con, [pid], include_category_only=False, sort="distance")["listed"]][:3]

def test_closing_first_goes_first_and_late_warning():
    con = db.connect()
    sh = _shops(con)
    now = datetime(2026, 10, 21, 18, 0, tzinfo=TEHRAN)
    stops = [{"shop_id": sh[0]["shop_id"], "confirmed": True, "closes_at": "20:00"},
             {"shop_id": sh[1]["shop_id"], "confirmed": True, "closes_at": "18:03"}]  # closes before we can arrive
    p = visit_plan.build(con, catalog.DEFAULT_LOC, stops, now=now)
    assert [s["shop_id"] for s in p["stops"]][0] == sh[1]["shop_id"], "earliest closing first"
    assert p["stops"][0]["late"] and p["stops"][0]["warnings"][0]["level"] == "bad"
    assert p["deep_links"]["neshan"].startswith("https://nshn.ir")
    assert p["stops"][1]["arrive_at"] > p["stops"][0]["arrive_at"]

def test_explicit_order_respected_and_unconfirmed_flag():
    con = db.connect()
    sh = _shops(con)
    stops = [{"shop_id": sh[0]["shop_id"], "confirmed": False}, {"shop_id": sh[1]["shop_id"], "confirmed": True, "price": 123000}]
    p = visit_plan.build(con, catalog.DEFAULT_LOC, stops, order=[sh[0]["shop_id"], sh[1]["shop_id"]])
    assert [s["shop_id"] for s in p["stops"]] == [sh[0]["shop_id"], sh[1]["shop_id"]]
    assert p["stops"][0]["confirmed_by_seller"] is False and p["stops"][1]["confirmed_price"] == 123000
