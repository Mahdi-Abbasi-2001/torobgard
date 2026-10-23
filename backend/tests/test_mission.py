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


def test_year_and_filler_words_are_not_searched():
    r = parse("لباس پاییزی مد 2026")
    assert r["query"] == "لباس پاییزی"
    assert parse("کاپشن جدید")["query"] == "کاپشن"


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


def test_need_first_sentence_finds_the_product():
    r = parse("برای بچم لباس فرم میخوام")
    assert r["query"] == "لباس فرم" and r["need"] == "بچم"


# ---- the intake agent: the model reads the sentence, the data decides what can be offered
def test_intake_rules_fallback_has_the_same_shape():
    from app.agent import intake
    from app.db import connect
    con = connect()
    r = intake.rules_intake(con, "هندزفری گردنی تا ۳٫۵ میلیون نزدیک علاالدین عصر")
    assert r["engine"] == "rules" and r["slots"]["query"] and r["slots"]["budget"]["max"] == 3_500_000
    assert r["slots"]["place"]["label"] and r["slots"]["when"] == "evening"
    assert set(r) >= {"slots", "exact", "questions", "assumed", "summary", "trace"}


def test_intake_options_come_from_the_data_not_the_model():
    from app.agent import intake
    from app.db import connect
    con = connect()
    fake = {"query": "هندزفری", "questions": [
        {"slot": "budget", "text": "بودجه؟", "options": ["۱ تومان", "۲ تومان"]},
        {"slot": "place", "text": "از کجا؟", "options": ["ماه"]}]}
    by = {q["slot"]: q for q in intake._result(con, fake, [], "llm", "هندزفری")["questions"]}
    assert "ماه" not in by["place"]["options"] and "موقعیت فعلی من" in by["place"]["options"]
    assert "۱ تومان" not in by["budget"]["options"] and "فرقی نمی‌کند" in by["budget"]["options"]
    need = {"query": "هندزفری", "questions": [{"slot": "need", "text": "برای چه؟", "options": ["اقتصادی"]}]}
    assert intake._result(con, need, [], "llm", "هندزفری")["questions"] == []  # nothing real to tap: dropped, not the model's guess
    got = intake._result(con, need, [], "llm", "هندزفری", ["ورزش", "مسافرت"])["questions"]
    assert got[0]["options"] == ["ورزش", "مسافرت"]


def test_intake_endpoint_streams_a_result_without_an_llm():
    from app.agent import llm as llm_mod
    llm_mod.OpenAICompatLLM.configured = property(lambda self: False)
    body = {"session_id": "i1", "messages": [{"role": "user", "text": "هندزفری"}], "slots": {}, "pinned": []}
    with TestClient(app) as cl:
        txt = cl.post("/api/mission/intake", json=body).text
    assert '"type": "result"' in txt and '"engine": "rules"' in txt


# ---- the shop advisor: only real, still-standing candidates; same shape without a model
def test_advisor_rules_fallback_picks_real_open_shops():
    import asyncio
    from app.services import advisor, catalog
    from app.db import connect
    con = connect()
    items = c.get("/api/search/products", params={"q": "هندزفری", "limit": 40}).json()["items"]
    pid = max(items, key=lambda p: p["shop_count"])["product_id"]
    out = asyncio.run(advisor.advise(con, pid, catalog.DEFAULT_LOC, when="now", need=None, priority="balanced", budget_max=None, installment=False, llm=None))
    ids = {s["shop_id"] for s in c.get(f"/api/products/{pid}/shops", params={"limit": 40}).json()["listed"]}
    assert out["source"] == "rules" and 1 <= len(out["picks"]) <= 4 and all(p["shop_id"] in ids for p in out["picks"])


def test_advisor_drops_invented_shops_and_falls_back():
    import asyncio
    from app.services import advisor, catalog
    from app.db import connect
    con = connect()
    items = c.get("/api/search/products", params={"q": "هندزفری", "limit": 40}).json()["items"]
    pid = max(items, key=lambda p: p["shop_count"])["product_id"]

    class Fake:
        configured = True
        async def complete_json(self, messages):
            return {"picks": [{"shop_id": "shop_does_not_exist", "reason": "x"}, {"shop_id": "nope", "reason": "y"}], "headline": "h"}
    out = asyncio.run(advisor.advise(con, pid, catalog.DEFAULT_LOC, when="now", need=None, priority="balanced", budget_max=None, installment=False, llm=Fake()))
    assert out["source"] == "rules" and out["picks"] and all(p["shop_id"].startswith("shop_") and p["shop_id"] != "shop_does_not_exist" for p in out["picks"])


# ---- the chat writes into the errand: only things that exist in the data get through
def test_chat_update_mission_patch_is_validated():
    from app.agent.tools import Ctx, _update_mission
    from app.db import connect
    ctx = Ctx(connect(), "um-1")
    res, block = _update_mission(ctx, {"need": "پسر بچه", "mode": "taxi", "when": "evening", "place_name": "فردوسی", "budget_max": 2_000_000, "query": "zzzzqqq", "mode_x": 1})
    p = block["patch"]
    assert p["need"] == "پسر بچه" and p["mode"] == "taxi" and p["when"] == "evening" and p["budget"] == {"min": None, "max": 2_000_000}
    assert p["place"]["lat"] and "query" not in p  # an item with no results is not written into the errand
    res, block = _update_mission(ctx, {"when": "yesterday", "mode": "plane", "place_name": "جایی در ماه"})
    assert block is None and "error" in res


def test_need_with_a_gender_hides_the_other_genders_items():
    from app.services.text import fits_need
    assert not fits_need("مانتو مدرسه دخترانه", "پسر بچه") and not fits_need("مانتو شلوار مدرسه کد ۱۰۷", "پسر بچه")
    assert fits_need("لباس مدرسه فرم دبیرستانی", "پسر بچه") and fits_need("پیراهن پسرانه", "پسر بچه")
    assert not fits_need("کت مردانه", "دختر") and fits_need("هر چیزی", None) and fits_need("مانتو", "بچه")


def test_intake_drops_a_category_that_hides_every_result():
    from app.agent import intake
    from app.db import connect
    con = connect()
    r = intake._result(con, {"query": "لباس فرم مدرسه", "category": "لباس", "summary": "x"}, [], "llm", "لباس فرم مدرسه")
    assert r["slots"]["category"] is None and r["exact"] is True


def test_intake_budget_only_from_the_shoppers_words_and_query_options_must_contain_the_word():
    from app.agent import intake
    from app.db import connect
    con = connect()
    a = {"query": "کتاب", "budget_min": 170_000, "budget_max": 375_000_000, "summary": "x",
         "questions": [{"slot": "query", "text": "چه نوع کتابی؟", "options": ["خودش"]}]}
    r = intake._result(con, a, [], "llm", "کتاب دانشگاهی میخوام")
    assert r["slots"]["budget"] is None  # the model read it off the price spread; the shopper never said it
    assert all("کتاب" in o.split() for q in r["questions"] for o in q["options"])
    assert intake._result(con, a, [], "llm", "کتاب تا ۳۰۰ هزار")["slots"]["budget"]
    assert intake._result(con, a, [], "llm", "کتاب", budget_known=True)["slots"]["budget"]


def test_visit_rating_reaches_the_shops_reliability():
    import os, time
    os.environ["TOROB_SIMULATE_SELLERS"] = "0"
    with TestClient(app) as cl:
        items = cl.get("/api/search/products", params={"q": "هندزفری", "limit": 40}).json()["items"]
        pid = next(p["product_id"] for p in items if p["shop_count"] >= 1)
        shop = next(s for s in cl.get(f"/api/products/{pid}/shops").json()["listed"])["shop_id"]
        sid = f"rate-{time.time()}"
        cl.put(f"/api/sessions/{sid}", json={"state": {}})
        rep = cl.post("/api/reports", json={"session_id": sid, "shop_id": shop, "product_id": pid, "kind": "visit", "available": True}).json()
        assert cl.post(f"/api/reports/{rep['id']}/rating", json={"session_id": sid, "rating": 9}).status_code == 422
        assert cl.post(f"/api/reports/{rep['id']}/rating", json={"session_id": "someone-else", "rating": 4}).status_code in (403, 404)
        assert cl.post(f"/api/reports/{rep['id']}/rating", json={"session_id": sid, "rating": 4}).json()["rating"] == 4
        rel = next(s for s in cl.get(f"/api/products/{pid}/shops").json()["listed"] if s["shop_id"] == shop)["reliability"]
        assert rel["rating"]["n"] >= 1 and 1 <= rel["rating"]["avg"] <= 5
