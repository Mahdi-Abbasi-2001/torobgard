"""Steps 1-3: need presets and fit, spec filters, purchase conditions, variants, fair price, compare insights/verdict,
arrival-time opening state, travel, zones, listing red flags, real areas, shop comparison with priorities. LLM off."""
import json, os
os.environ["TOROB_SIMULATE_SELLERS"] = "0"
from datetime import datetime
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.agent import llm as llm_mod
from app.services import discover
from app.services.hours import TEHRAN

PHONE = "product_e743ce86bbc5c2a0c9bd16f4"   # Samsung A56 256 GB: many shops downtown
PHONE2 = "product_d24b597176bdf2a82035dcc2"  # Samsung A17


@pytest.fixture(autouse=True)
def no_llm(monkeypatch):
    monkeypatch.setattr(llm_mod.OpenAICompatLLM, "configured", property(lambda self: False))


@pytest.mark.parametrize("title,desc,codes", [
    ("گوشی سامسونگ A56 استوک", None, {"stock"}),
    ("آیفون ۱۳ کارکرده تمیز", None, {"used"}),
    ("ایرپاد پرو طرح اصلی", None, {"copy"}),
    ("گوشی شیائومی نسخه ویتنام", "رجیستر نشده", {"region", "not_registered"}),
    ("گوشی سامسونگ A56", "دستگاه فوق سفارش اروپا میباشد", {"region", "on_order"}),
    ("هندزفری بی سیم سامسونگ", "اورجینال با گارانتی", set()),
])
def test_listing_flags(title, desc, codes):
    assert {f["code"] for f in discover.offer_flags(title, desc)} == codes


def test_numbers_units_and_fit():
    assert discover.num("۵۰۰۰ میلی‌آمپرساعت") == 5000
    assert discover.num("1 ترابایت") == 1024 and discover.num("~460 پیکسل") == 460
    f = discover.fit({"ظرفیت باتری": "۶۰۰۰ میلی آمپر", "nfc": "دارد"}, [
        {"key": "ظرفیت باتری", "op": ">=", "value": 5000}, {"key": "NFC", "op": "has", "value": "دارد"},
        {"key": "وزن", "op": "<=", "value": 180}])
    assert [x["ok"] for x in f] == [True, True, None], "a missing spec is 'unknown', never a fail"


def test_arrival_time_presets():
    now = datetime(2026, 10, 22, 19, 30, tzinfo=TEHRAN)
    assert discover.arrival_time("1h", now)[0].hour == 20
    t, label = discover.arrival_time("tomorrow", now)
    assert t.day == 23 and t.hour == 11 and label == "فردا صبح"
    assert discover.arrival_time("evening", now)[0] == now, "evening already started: go now"
    assert discover.arrival_time("10:00", now)[0].day == 23, "a past clock time means tomorrow"


def test_travel_estimates_and_traffic_zone():
    t = discover.travel(2.0, True)
    assert t["walk"] == round(2 * 1.3 / 4.5 * 60) and t["car"] > t["taxi"] and t["car_note"]
    assert discover.travel(None, False) is None


def test_shops_carry_flags_travel_zones_and_fair_price():
    with TestClient(app) as c:
        r = c.get(f"/api/products/{PHONE}/shops", params={"when": "tomorrow"}).json()
        assert r["when"] == "فردا صبح" and r["at"]
        s = r["listed"][0]
        assert "flags" in s["offer"] and s["travel"]["walk"] >= 0 and "score_parts" in s
        assert r["zones"] and r["zones"][0]["shop_count"] >= 2 and "فروشگاه کنار هم" in r["zones"][0]["why"]
        assert "الان باز" not in r["zones"][0]["why"], "opening is judged for tomorrow, not now"
        assert r["fair_price"]["low"] <= r["fair_price"]["median"] <= r["fair_price"]["high"]
        assert any(x["offer"]["fair"] for x in r["listed"])
        # priority changes the order
        cheap = c.get(f"/api/products/{PHONE}/shops", params={"priority": "price"}).json()["listed"]
        near = c.get(f"/api/products/{PHONE}/shops", params={"priority": "near"}).json()["listed"]
        assert [x["shop_id"] for x in cheap[:5]] != [x["shop_id"] for x in near[:5]]


def test_insights_variants_and_availability():
    with TestClient(app) as c:
        r = c.get(f"/api/products/{PHONE}/insights").json()
        assert any("128" in v["variant"] for v in r["variants"]), "the 128 GB version is a variant of the 256 GB one"
        assert all(v["near"]["shops"] >= 1 for v in r["variants"])
        assert r["availability"]["near"] >= 1 and r["fair_price"]["note"]


def test_search_presets_conditions_specs_and_near():
    with TestClient(app) as c:
        plain = c.get("/api/search/products", params={"q": "گوشی سامسونگ"}).json()
        assert "near" in plain["items"][0] and plain["items"][0]["near"]["shops"] >= 1
        cons = [{"key": "ظرفیت باتری", "op": ">=", "value": 5000}]
        r = c.get("/api/search/products", params={"q": "گوشی سامسونگ", "prefs": json.dumps(cons), "near_only": True}).json()
        assert r["items"] and all(i["near"]["near"] >= 1 for i in r["items"])
        assert r["items"][0]["fit"][0]["ok"] is True, "best fits first"
        assert r["applied"]["prefs"] == [{"key": "ظرفیت باتری", "op": ">=", "value": 5000.0}]
        facets = c.get("/api/spec-facets", params={"category": "گوشی موبایل"}).json()["items"]
        f = next(x for x in facets if x["key"] == "حافظه داخلی")
        v = f["values"][0]["value"]
        r = c.get("/api/search/products", params={"category": "گوشی موبایل", "spec": f"حافظه داخلی={v}"}).json()
        assert r["total"] >= 1
        assert c.get("/api/search/products", params={"q": "x", "prefs": "not json"}).status_code == 400
        presets = c.get("/api/category-presets", params={"category": "گوشی موبایل"}).json()
        assert presets["source"] == "rules" and {"battery", "cheap", "available"} <= {p["id"] for p in presets["presets"]}


def test_compare_insights_and_rule_verdict():
    with TestClient(app) as c:
        r = c.post("/api/products/compare", json={"ids": [PHONE, PHONE2]}).json()
        ins = r["insights"]
        assert ins["cheapest"] == 1 and ins["per_product"][0]["wins"]
        assert all(row.get("best") is None or set(row["best"]) <= {0, 1} for row in r["rows"])
        selfie = next((row for row in r["rows"] if "فیلم" in row["key"] and "سلفی" in row["key"]), None)
        assert selfie is None or selfie["best"] is None or len({discover._unit(v) for v in selfie["values"] if v}) == 1
        v = c.post("/api/products/compare/verdict", json={"ids": [PHONE, PHONE2], "need": "باتری"}).json()
        assert v["pick"] in (PHONE, PHONE2) and v["source"] == "rules" and v["per_need"]


def test_compare_shops_winners_and_verdict():
    with TestClient(app) as c:
        listed = c.get(f"/api/products/{PHONE}/shops").json()["listed"][:4]
        ids = ",".join(s["shop_id"] for s in listed)
        r = c.get(f"/api/products/{PHONE}/shops/compare", params={"ids": ids, "priority": "price"}).json()
        assert len(r["shops"]) == 4 and r["priority_label"] == "قیمت"
        assert r["winners"]["price"] and r["verdict"][0]["for"] == "ارزان‌ترین"
        assert all("trust_score" in s for s in r["shops"])
        assert c.get(f"/api/products/{PHONE}/shops/compare", params={"ids": ids, "priority": "bogus"}).status_code == 422


def test_areas_come_from_the_dataset():
    with TestClient(app) as c:
        a = c.get("/api/areas").json()["items"]
        assert len(a) >= 10 and a[0]["shop_count"] >= a[-1]["shop_count"] and {"فردوسی", "تجریش"} <= {x["label"] for x in a}
