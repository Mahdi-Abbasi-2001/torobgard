"""Mission sentence parsing: slots are read by rules (no LLM), unread slots stay null."""
from fastapi.testclient import TestClient
from app.main import app

c = TestClient(app)


def parse(text):
    r = c.post("/api/mission/parse", json={"text": text})
    assert r.status_code == 200
    return r.json()


def test_full_sentence():
    r = parse("هندزفری گردنی برای ورزش، تا ۳٫۵ میلیون، نزدیک علاالدین، عصر")
    assert r["query"] == "هندزفری گردنی" and r["need"] == "ورزش"
    assert r["budget"]["max"] == 3_500_000
    assert r["place"]["kind"] == "mall" and "علاالدین" in r["place"]["label"] and r["place"]["lat"]
    assert r["when"] == "evening"
    assert r["category"]


def test_range_installment_clock():
    r = parse("یه گوشی سامسونگ ۱۰ تا ۱۵ میلیون قسطی فردا ساعت ۱۱")
    assert r["budget"] == {"min": 10_000_000, "max": 15_000_000}
    assert r["conditions"]["installment"] is True
    assert r["when"] == "11:00" and r["query"] == "گوشی سامسونگ"


def test_area_mode_and_clock_afternoon():
    r = parse("دوربین مداربسته ۴ کانال اطراف فردوسی با تاکسی")
    assert r["place"]["kind"] == "area" and r["place"]["label"] == "فردوسی" and r["mode"] == "taxi"
    assert parse("کابل شارژ ساعت ۶ با ماشین")["when"] == "18:00"


def test_plain_word_leaves_the_rest_open():
    r = parse("هندزفری")
    assert r["query"] == "هندزفری"
    assert r["budget"] is None and r["place"] is None and r["when"] is None and r["mode"] is None and r["need"] is None


# ---- «I'm here»: the shopper taps, the seller is told (with the hold code) and acknowledges
def test_arrival_tells_the_seller_and_carries_the_hold_code():
    import os, time
    os.environ["TOROB_SIMULATE_SELLERS"] = "0"
    from app.agent import llm as llm_mod
    llm_mod.OpenAICompatLLM.configured = property(lambda self: False)
    with TestClient(app) as c:
        items = c.get("/api/search/products", params={"q": "هندزفری", "limit": 40}).json()["items"]
        pid = next(p["product_id"] for p in items if p["shop_count"] >= 2)
        shop = next(s for s in c.get(f"/api/products/{pid}/shops").json()["listed"] if s["offer"]["price"])["shop_id"]
        sid = f"arr-{time.time()}"
        c.put(f"/api/sessions/{sid}", json={"state": {"location": {"lat": 35.6955, "lon": 51.413}}})
        ask = c.post("/api/inquiries", json={"session_id": sid, "shop_ids": [shop], "product_id": pid}).json()["items"][0]
        seller = "/api/seller" + c.get(f"/api/demo/seller-link/{shop}").json()["path"][len("/seller"):]
        c.post(f"{seller}/inquiries/{ask['id']}/answer", json={"available": True, "price": 1_000_000})
        hold = c.post(f"/api/inquiries/{ask['id']}/hold", json={"session_id": sid, "until": "18:30"}).json()
        code = c.post(f"{seller}/inquiries/{hold['id']}/reply", json={"text": "باشه، نگه می‌دارم"}).json()["inquiry"]["answer"]["hold_code"]
        before = (c.get(f"/api/shops/{shop}").json().get("confirmation") or {}).get("count", 0)
        arr = c.post(f"/api/inquiries/{ask['id']}/arrive", json={"session_id": sid}).json()
        assert arr["kind"] == "arrive" and arr["parent_id"] == ask["id"]
        assert code[-1] in arr["thread"][0]["text"] or "کد نگه‌داری" in arr["thread"][0]["text"], "the seller sees the hold code"
        v = c.post(f"{seller}/inquiries/{arr['id']}/reply", json={"text": "بفرمایید منتظرم"}).json()["inquiry"]
        assert v["status"] == "answered" and v["label"] == "فروشنده منتظر شماست"
        # an acknowledgement says nothing about stock: it must not add a stock confirmation
        after = (c.get(f"/api/shops/{shop}").json().get("confirmation") or {}).get("count", 0)
        assert after == before, (before, after)
