import os, time
os.environ["TOROB_SIMULATE_SELLERS"] = "0"
from fastapi.testclient import TestClient
from app.main import app

def client():
    return TestClient(app)

def test_search_and_budget():
    with client() as c:
        r = c.get("/api/search/products", params={"q": "هندزفری زیر ۳ میلیون"}).json()
        assert r["applied"]["price_max"] == 3_000_000 and r["total"] > 0
        assert all(p["price_min"] <= 3_000_000 for p in r["items"])

def test_product_shops_tiers():
    with client() as c:
        items = c.get("/api/search/products", params={"q": "هندزفری", "limit": 10}).json()["items"]
        pid = next(p for p in items if p["shop_count"] >= 2)["product_id"]
        s = c.get(f"/api/products/{pid}/shops").json()
        assert s["counts"]["listed"] >= 2
        assert all(x["tier"] == "listed" and x["offer"] for x in s["listed"])
        assert all(x["tier"] == "category_only" and x["offer"] is None for x in s["category_only"])
        assert "freshness" in s["listed"][0]["offer"]

def test_compare_and_similar():
    with client() as c:
        items = c.get("/api/search/products", params={"q": "هدفون", "limit": 3}).json()["items"]
        r = c.post("/api/products/compare", json={"ids": [i["product_id"] for i in items[:2]]}).json()
        assert len(r["products"]) == 2
        assert c.get(f"/api/products/{items[0]['product_id']}/similar").json()["items"]

def test_inquiry_flow_timeout_and_answer():
    with client() as c:
        items = c.get("/api/search/products", params={"q": "هندزفری", "limit": 60}).json()["items"]
        pid = next(p for p in items if p["shop_count"] >= 3)["product_id"]
        shops = c.get(f"/api/products/{pid}/shops").json()["listed"]
        sid = "t-" + str(time.time())
        c.put(f"/api/sessions/{sid}", json={"state": {"location": {"lat": 35.6955, "lon": 51.413}}})
        r = c.post("/api/inquiries", json={"session_id": sid, "shop_ids": [shops[0]["shop_id"], shops[1]["shop_id"]],
                                           "product_id": pid, "timeout_s": 10}).json()["items"]
        assert [i["status"] for i in r] == ["sent", "sent"]
        shop_id = shops[0]["shop_id"]
        link = c.get(f"/api/demo/seller-link/{shop_id}").json()["path"]
        inbox = c.get(f"/api/seller{link[len('/seller'):]}/inquiries").json()
        assert inbox["items"] and inbox["items"][0]["status"] == "delivered"
        assert c.post(f"/api/seller{link[len('/seller'):]}/inquiries/{r[0]['id']}/answer",
                      json={"available": False}).json()["status"] == "unavailable"
        assert c.post("/api/seller/" + shop_id + "/badtoken/inquiries/x/answer", json={}).status_code == 403
        lst = c.get(f"/api/sessions/{sid}/inquiries").json()["items"]
        failed = next(i for i in lst if i["status"] == "unavailable")
        assert failed["alternatives"]["shops"], "unavailable shop must trigger alternatives"

def test_simulated_seller_actually_runs(monkeypatch):
    """Regression: create() from a sync endpoint must schedule simulated sellers (no event loop in worker thread)."""
    from app.services import inquiries as inq
    ran = []
    async def _mark(iid): ran.append(iid)
    monkeypatch.setattr(inq, "SIMULATE", True)
    monkeypatch.setattr(inq, "_simulate", _mark)
    with client() as c:
        items = c.get("/api/search/products", params={"q": "هندزفری", "limit": 10}).json()["items"]
        pid = next(p for p in items if p["shop_count"] >= 2)["product_id"]
        shop = c.get(f"/api/products/{pid}/shops").json()["listed"][0]["shop_id"]
        r = c.post("/api/inquiries", json={"session_id": "sim-test", "shop_ids": [shop], "product_id": pid})
        assert r.status_code == 200
        time.sleep(0.3)
        assert len(ran) == 1

def test_search_is_forgiving():
    with client() as c:
        r = c.get("/api/search/products", params={"q": "یه هندزفری بی‌سیم برای ورزش زیر ۳ میلیون"}).json()
        assert r["total"] > 0 and r["items"], "need-style query must still return products"
        assert r["applied"]["price_max"] == 3_000_000

def test_phone_query_prefers_phones_over_batteries():
    with client() as c:
        items = c.get("/api/search/products", params={"q": "گوشی سامسونگ زیر ۱۵ میلیون", "limit": 8}).json()["items"]
        assert items and sum(1 for p in items if p["category"] == "گوشی موبایل") >= 5, [p["category"] for p in items]
