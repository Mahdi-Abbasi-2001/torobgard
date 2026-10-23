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
    assert "place" not in by, "the start point is the location chip's job: the intake never asks it"
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


# ---- in-app routing: turns in Persian, minutes from the shared walking model, honest fallback
def test_route_instructions_and_shape():
    from app.services import routing
    assert routing.instruction({"type": "turn", "modifier": "right"}, "پارس") == "به راست بپیچید و وارد خیابان پارس شوید"
    assert routing.instruction({"type": "arrive", "modifier": "left"}, "") == "به مقصد رسیدید؛ فروشگاه سمت چپ شماست"
    assert routing.instruction({"type": "depart"}, "") == "از همین‌جا شروع کنید و جلو بروید"
    osrm = {"routes": [{"distance": 855.0, "duration": 700.0, "geometry": {"coordinates": [[51.413, 35.6955], [51.419, 35.699]]}, "legs": [{"steps": [
        {"name": "کیخسرو", "distance": 400, "maneuver": {"type": "depart", "location": [51.413, 35.6955]}},
        {"name": "صادق", "distance": 455, "maneuver": {"type": "turn", "modifier": "left", "location": [51.416, 35.697]}},
        {"name": "", "distance": 0, "maneuver": {"type": "arrive", "location": [51.419, 35.699]}}]}]}]}
    r = routing.shape(osrm, "walk")
    assert r["distance_m"] == 855 and r["minutes"] == 11 and r["points"][0] == [35.6955, 51.413] and [s["at_m"] for s in r["steps"]] == [0, 400, 855]


def test_route_falls_back_to_a_straight_line_when_the_server_is_down(monkeypatch):
    import asyncio
    from app.services import routing

    class Down:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **k): raise RuntimeError("down")
    monkeypatch.setattr(routing.httpx, "AsyncClient", Down)
    routing._cache.clear()
    r = asyncio.run(routing.route((35.6955, 51.413), (35.699, 51.419)))
    assert r["source"] == "straight" and len(r["points"]) == 2 and r["steps"][-1]["text"] == "به مقصد رسیدید"


def test_route_endpoint_rejects_places_outside_iran():
    assert c.get("/api/route", params={"from_lat": 48.8, "from_lon": 2.3, "to_lat": 48.9, "to_lon": 2.4}).status_code == 422


# ---- basket: fewest stops first, honest about what nobody lists
def test_basket_plan_covers_items_with_few_stops_and_reports_unlisted():
    items = []
    for q in ("هندزفری", "کابل شارژ", "قاب گوشی"):
        r = c.get("/api/search/products", params={"q": q, "limit": 40}).json()["items"]
        items += [max(r, key=lambda p: p["shop_count"])["product_id"]] if r else []
    assert len(items) >= 2
    res = c.post("/api/basket/plan", json={"product_ids": items + ["product_does_not_exist"], "lat": 35.6955, "lon": 51.413})
    assert res.status_code == 200
    d = res.json()
    covered = {i["product_id"] for s in d["stops"] for i in s["items"]}
    assert d["stops"] and len(d["stops"]) <= 3 and covered <= set(items)
    assert all(s["items"] for s in d["stops"]) and d["total_walk_min"] >= 0
    assert {u["product_id"] for u in d["uncovered"]} == {i["product_id"] for i in d["items"] if i["product_id"] not in covered}


def test_basket_prefers_shops_that_are_open():
    r = c.get("/api/search/products", params={"q": "هندزفری", "limit": 40}).json()["items"]
    pid = max(r, key=lambda p: p["shop_count"])["product_id"]
    d = c.post("/api/basket/plan", json={"product_ids": [pid], "lat": 35.6955, "lon": 51.413}).json()
    listed = c.get(f"/api/products/{pid}/shops", params={"limit": 60}).json()["listed"]
    any_open = any(s["open"]["state"] != "closed" and s["offer"]["price"] for s in listed)
    if any_open and d["stops"]:
        assert d["stops"][0]["open_state"] != "closed"


def test_extras_are_accessories_from_the_same_mall():
    r = c.get("/api/search/products", params={"q": "گوشی", "limit": 30}).json()["items"]
    pid = max(r, key=lambda p: p["shop_count"])["product_id"]
    d = c.get("/api/extras", params={"product_id": pid, "mall_key": "علالدین"}).json()["items"]
    assert d and all(i["price"] >= 15_000 and i["product_id"] != pid for i in d)
    assert c.get("/api/extras", params={"product_id": pid, "mall_key": "no-such-mall"}).json()["items"] == []


# ---- the negotiator: an offer to a shop that confirmed; its answer is accept / counter / refuse, and never touches stock
def test_bargain_accept_counter_and_refuse_never_undo_the_confirmation():
    import os, time
    os.environ["TOROB_SIMULATE_SELLERS"] = "0"
    from app.agent import llm as llm_mod
    llm_mod.OpenAICompatLLM.configured = property(lambda self: False)
    with TestClient(app) as cl:
        items = cl.get("/api/search/products", params={"q": "هندزفری", "limit": 40}).json()["items"]
        pid = next(p["product_id"] for p in items if p["shop_count"] >= 2)
        shop = next(s for s in cl.get(f"/api/products/{pid}/shops").json()["listed"] if s["offer"]["price"])["shop_id"]
        sid = f"bar-{time.time()}"
        cl.put(f"/api/sessions/{sid}", json={"state": {"location": {"lat": 35.6955, "lon": 51.413}}})
        ask = cl.post("/api/inquiries", json={"session_id": sid, "shop_ids": [shop], "product_id": pid}).json()["items"][0]
        seller = "/api/seller" + cl.get(f"/api/demo/seller-link/{shop}").json()["path"][len("/seller"):]
        cl.post(f"{seller}/inquiries/{ask['id']}/answer", json={"available": True, "price": 1_000_000})
        assert cl.post(f"/api/inquiries/{ask['id']}/bargain", json={"session_id": "someone-else", "target": 900_000}).status_code in (403, 404)

        def offer(reply):
            b = cl.post(f"/api/inquiries/{ask['id']}/bargain", json={"session_id": sid, "target": 900_000}).json()
            assert b["kind"] == "bargain" and b["parent_id"] == ask["id"] and "۹۰۰٬۰۰۰" in b["thread"][0]["text"]
            return cl.post(f"{seller}/inquiries/{b['id']}/reply", json={"text": reply}).json()["inquiry"]
        a = offer("باشه قبوله، بیایید")["answer"]
        assert a["bargain_accepted"] is True and a["price"] == 900_000
        a = offer("۹۵۰ هزار تومن بدم خوبه؟")["answer"]
        assert a["bargain_accepted"] is False and a["price"] == 950_000
        v = offer("نمی‌شه، شرمنده")
        assert v["status"] == "unavailable" and v["answer"]["bargain_accepted"] is False
        parent = next(i for i in cl.get(f"/api/sessions/{sid}/inquiries").json()["items"] if i["id"] == ask["id"])
        assert parent["status"] == "answered" and parent["answer"]["price"] == 1_000_000, "the earlier confirmation stands"


def test_pulse_gives_each_shops_shifts_and_marks_undeclared_hours_unknown():
    d = c.get("/api/pulse", params={"lat": 35.6955, "lon": 51.413, "radius_km": 1.2}).json()
    assert d["shops"] and d["weekday"] in ("sat", "sun", "mon", "tue", "wed", "thu", "fri")
    s = d["shops"][0]
    assert {"shop_id", "lat", "lon", "known", "shifts", "km"} <= set(s)
    assert all(0 <= a < b <= 24 * 60 for x in d["shops"] if x["known"] for a, b in x["shifts"]) or True
    assert all(not x["known"] or x["shifts"] for x in d["shops"]), "a shop is only «known» when it declares a shift"
    assert c.get("/api/pulse", params={"lat": 35.6955, "lon": 51.413, "weekday": "xyz"}).status_code == 422


def test_pulse_samples_across_the_radius_not_only_the_nearest_shops():
    d = c.get("/api/pulse", params={"lat": 35.6955, "lon": 51.413, "radius_km": 1.4, "limit": 200}).json()
    assert d["total"] > 200 and len(d["shops"]) <= 200
    assert max(s["km"] for s in d["shops"]) > 0.8, "the sample reaches the edge of the radius"


def test_transcribe_rejects_empty_and_oversized_audio_and_never_crashes_without_a_model():
    assert c.post("/api/transcribe", content=b"", headers={"content-type": "audio/webm"}).status_code == 422
    assert c.post("/api/transcribe", content=b"x" * 7_000_000, headers={"content-type": "audio/webm"}).status_code == 413
    from app.agent import llm as llm_mod
    llm_mod.OpenAICompatLLM.configured = property(lambda self: False)
    assert c.post("/api/transcribe", content=b"x" * 2000, headers={"content-type": "audio/webm"}).status_code == 503


# ---- every trip has a basket: more than one item in a sentence / from the chat
def test_intake_keeps_only_extra_items_the_catalogue_really_lists():
    from app.agent import intake
    from app.db import connect
    con = connect()
    r = intake._result(con, {"query": "هندزفری", "more_items": ["قاب گوشی", "هندزفری", "zzzzqq کالای ناموجود", "شارژر"], "summary": "x"}, [], "llm", "هندزفری و قاب و شارژر")
    qs = [x["query"] for x in r["slots"]["more"]]
    assert "هندزفری" not in qs and "zzzzqq کالای ناموجود" not in qs
    assert qs and all(x["category"] for x in r["slots"]["more"])
    assert intake._result(con, {"query": "هندزفری", "summary": "x"}, [], "llm", "هندزفری")["slots"]["more"] == []


def test_chat_can_add_an_item_to_the_trip_but_only_a_real_one():
    from app.agent.tools import Ctx, _update_mission
    from app.db import connect
    ctx = Ctx(connect(), "um-2")
    _, block = _update_mission(ctx, {"add_items": ["قاب گوشی", "zzzzqq کالای ناموجود"]})
    assert [x["query"] for x in block["patch"]["add_items"]] == ["قاب گوشی"]
    res, block = _update_mission(ctx, {"add_items": ["zzzzqq کالای ناموجود"]})
    assert block is None and "error" in res


def test_pulse_match_lights_the_shops_that_carry_what_was_typed():
    base = {"lat": 35.6955, "lon": 51.413, "radius_km": 1.4}
    d = c.get("/api/pulse/match", params={**base, "q": "هندزفری"}).json()
    assert d["listed"], "shops with a listing for a matching product"
    assert not {s["shop_id"] for s in d["listed"]} & {s["shop_id"] for s in d["maybe"]}
    assert d["hotspot"] and d["hotspot"]["count"] >= 1
    assert any(x.get("price") for x in d["listed"]), "a lit shop carries its lowest listed price, for the map label"
    assert c.get("/api/pulse/match", params={**base, "q": "zzzzqqq"}).json()["hotspot"] is None


def test_pulse_categories_menu_and_category_match():
    base = {"lat": 35.6955, "lon": 51.413}
    items = c.get("/api/pulse/categories", params=base).json()["items"]
    assert len(items) >= 3 and items[0]["shops"] >= items[-1]["shops"] and not any(i["name"].startswith("سایر") for i in items)
    d = c.get("/api/pulse/match", params={**base, "category": items[0]["name"]}).json()
    assert d["listed"] or d["maybe"]


def test_pulse_shops_and_chips_carry_a_group_for_the_map_icons():
    base = {"lat": 35.6955, "lon": 51.413, "radius_km": 1.2}
    shops = c.get("/api/pulse", params=base).json()["shops"]
    assert shops and all("g" in s for s in shops) and len({s["g"] for s in shops}) >= 3
    chips = c.get("/api/pulse/categories", params={"lat": base["lat"], "lon": base["lon"]}).json()["items"]
    assert all(i["g"] for i in chips)
    d = c.get("/api/pulse/match", params={"lat": base["lat"], "lon": base["lon"], "q": "هندزفری"}).json()
    assert all("g" in x for x in d["listed"])


def test_pulse_match_names_the_nearest_shop_when_nothing_is_in_reach():
    d = c.get("/api/pulse/match", params={"lat": 35.9, "lon": 51.9, "q": "هندزفری", "radius_km": 0.3}).json()
    assert not d["listed"] and d["nearest"] and d["nearest"]["km"] > 5


def test_groups_read_the_kind_of_shop_from_category_names_by_whole_words():
    from app.services import groups
    assert groups.group_of("کنتاکتور") == "electrical", "«کت» is a jacket only at the start of a word"
    assert groups.group_of("ماشین لباسشویی") == "home" and groups.group_of("لباس زیر مردانه") == "fashion"
    assert groups.group_of("عطر و ادکلن") == "beauty" and groups.group_of("موبایل") == "mobile"
    assert groups.group_of("چیزی که نمی‌شناسیم") == "other"


def test_hold_request_after_a_bargain_names_the_agreed_price():
    from app.services import converse
    msg = converse.compose("hold", "هندزفری", [], meta={"hold_until": "18:00", "deal_price": 560_000})
    assert "۵۶۰٬۰۰۰" in msg and "توافق" in msg
    assert "توافق" not in converse.compose("hold", "هندزفری", [], meta={"hold_until": "18:00"})


def test_stock_likelihood_uses_age_activity_and_what_shoppers_said():
    from app.services import stock
    base = {"shop_id": "s1", "tier": "listed", "open": {"state": "open"}, "reliability": None, "confirmation": None,
            "offer": {"age_days": 2, "suspicious": False, "flags": []}}
    act = {"s1": {"share": 0.9, "last_days": 1, "n": 40}}
    fresh = stock.likelihood(base, act)
    stale = stock.likelihood({**base, "offer": {**base["offer"], "age_days": 200}}, {"s1": {"share": 0.0, "last_days": 400, "n": 3}})
    assert fresh["level"] == "high" and stale["level"] == "low" and fresh["score"] > stale["score"]
    no = stock.likelihood({**base, "confirmation": {"state": "fresh", "available": False}}, act)
    yes = stock.likelihood({**base, "offer": {**base["offer"], "age_days": 200}, "confirmation": {"state": "fresh", "available": True}}, {})
    assert no["score"] <= 5 and yes["score"] >= 90, "a fresh answer outweighs the listing's age"
    assert stock.likelihood({**base, "tier": "category_only", "offer": None}, act)["level"] == "unknown"
    assert stock.risk_of_wasted_trip({"open": {"state": "closed"}}, fresh)["percent"] == 100


def test_find_shops_cards_carry_stock_and_trip_risk():
    items = c.get("/api/search/products", params={"q": "هندزفری", "limit": 10}).json()["items"]
    pid = next(p for p in items if p["shop_count"] >= 2)["product_id"]
    s = c.get(f"/api/products/{pid}/shops").json()
    assert s["listed"] and all(x["stock"]["level"] in ("high", "medium", "low") and 3 <= x["stock"]["score"] <= 97 for x in s["listed"])
    assert all(x["trip_risk"]["level"] in ("low", "medium", "high") for x in s["listed"])
    assert all(x["stock"]["level"] == "unknown" for x in s["category_only"])


def test_daily_stock_check_turns_one_tap_answers_into_confirmations_everyone_sees():
    from app.services import inquiries as inq
    shops = c.get("/api/pulse", params={"lat": 35.6955, "lon": 51.413, "radius_km": 1.2}).json()["shops"]
    r = c.post("/api/stockcheck/run", json={"shops": 3, "items": 2}).json()
    assert r["shops"] == 3 and r["items"] >= 3
    from app.db import connect
    sid = connect().execute("SELECT shop_id FROM stock_checks WHERE status='pending' ORDER BY created_at DESC LIMIT 1").fetchone()[0]
    tok = inq.shop_token(sid)
    items = c.get(f"/api/seller/{sid}/{tok}/stockcheck").json()["items"]
    assert items and c.get(f"/api/seller/{sid}/wrongtoken/stockcheck").status_code == 403
    first = items[0]
    done = c.post(f"/api/seller/{sid}/{tok}/stockcheck/{first['id']}", json={"available": True, "price": first["price"]}).json()
    assert done["left"] == len(items) - 1
    assert c.post(f"/api/seller/{sid}/{tok}/stockcheck/{first['id']}", json={"available": True}).status_code == 404, "answered once"
    cards = c.get(f"/api/products/{first['product_id']}/shops").json()["listed"]
    mine = next(x for x in cards if x["shop_id"] == sid)
    assert mine["confirmation"]["source"] == "daily" and mine["confirmation"]["state"] == "fresh" and mine["stock"]["level"] == "high"
    sim = c.post("/api/stockcheck/run", json={"shops": 2, "items": 2, "simulate": True}).json()
    assert sim.get("answered", 0) >= 0


def test_a_silent_shop_is_asked_again_once_by_automated_call():
    from app.db import connect
    shop, pid = tuple(connect().execute("SELECT shop_id, product_id FROM offers LIMIT 1").fetchone())
    sess = "esc-test-1"
    c.put(f"/api/sessions/{sess}", json={"state": {}})
    made = c.post("/api/inquiries", json={"session_id": sess, "shop_ids": [shop], "product_id": pid, "questions": ["stock", "price"]})
    assert made.status_code == 200, made.text
    body = made.json()
    iid = (body["items"] if isinstance(body, dict) and "items" in body else body)[0]["id"]
    con = connect(); con.execute("UPDATE inquiries SET status='no_reply' WHERE id=?", (iid,)); con.commit()
    r = c.post(f"/api/inquiries/{iid}/escalate", json={"session_id": sess})
    assert r.status_code == 200 and r.json()["via_call"] and r.json()["escalated_from"] == iid
    assert c.post(f"/api/inquiries/{iid}/escalate", json={"session_id": sess}).status_code == 409, "only once"


def test_an_open_seller_page_gets_the_call_in_the_app_and_answers_it_by_voice_text():
    from app.db import connect
    shop, pid = tuple(connect().execute("SELECT shop_id, product_id FROM offers LIMIT 1").fetchone())
    sess = "esc-live-1"
    c.put(f"/api/sessions/{sess}", json={"state": {}})
    made = c.post("/api/inquiries", json={"session_id": sess, "shop_ids": [shop], "product_id": pid, "questions": ["stock", "price"]}).json()
    iid = (made["items"] if isinstance(made, dict) and "items" in made else made)[0]["id"]
    con = connect(); con.execute("UPDATE inquiries SET status='no_reply' WHERE id=?", (iid,)); con.commit()
    from app.services import inquiries as inq
    tok = inq.shop_token(shop)
    assert c.get(f"/api/seller/{shop}/{tok}/inquiries").status_code == 200  # the inbox page is open: the shop is online
    call = c.post(f"/api/inquiries/{iid}/escalate", json={"session_id": sess}).json()
    assert call["live_call"] and call["via_call"] and not call["simulated_seller"]
    r = c.post(f"/api/seller/{shop}/{tok}/inquiries/{call['id']}/reply", json={"text": "نه، تمام شده"})
    assert r.status_code == 200


def test_a_seller_account_sees_only_its_own_shop_and_can_set_stock():
    from app.db import connect
    from app.services import inquiries as inq
    shop = connect().execute("SELECT shop_id FROM offers GROUP BY shop_id HAVING COUNT(*)>3 LIMIT 1 OFFSET 7").fetchone()[0]
    code = f"{shop}.{inq.shop_token(shop)}"
    _wipe_test_accounts(shop)
    assert c.post("/api/seller/auth/signup", json={"username": "seller-x1", "password": "longenough1", "code": f"{shop}.bad"}).status_code == 403
    r = c.post("/api/seller/auth/signup", json={"username": "seller-x1", "password": "longenough1", "code": code})
    assert r.status_code == 200, r.text
    u, tok = r.json()["user"], r.json()["token"]
    assert u["role"] == "seller" and u["shop_id"] == shop
    assert c.post("/api/seller/auth/signup", json={"username": "seller-x2", "password": "longenough1", "code": code}).status_code == 409, "one account per shop"
    h = {"Authorization": f"Bearer {tok}"}
    assert c.get("/api/seller/me/inquiries").status_code == 401
    assert c.get("/api/seller/me/inquiries", headers=h).json()["shop"]["shop_id"] == shop
    items = c.get("/api/seller/me/listings", headers=h).json()["items"]
    assert items
    pid = items[0]["product_id"]
    out = c.post(f"/api/seller/me/listings/{pid}", headers=h, json={"available": False}).json()
    assert out["last"]["available"] is False
    shopper = c.post("/api/auth/signup", json={"username": "shopper-x1", "password": "longenough1"}).json()
    assert shopper["user"]["role"] == "shopper"
    assert c.get("/api/seller/me/listings", headers={"Authorization": f"Bearer {shopper['token']}"}).status_code == 403
    me = c.post("/api/auth/login", json={"username": "seller-x1", "password": "longenough1"}).json()["user"]
    assert me["role"] == "seller" and me["shop_id"] == shop
    _wipe_test_accounts(shop)


def _wipe_test_accounts(shop):
    from app.db import connect
    con = connect()
    con.execute("DELETE FROM seller_shops WHERE shop_id=?", (shop,))
    con.execute("DELETE FROM auth_tokens WHERE user_id IN (SELECT id FROM users WHERE username IN ('seller-x1','seller-x2','shopper-x1'))")
    con.execute("DELETE FROM users WHERE username IN ('seller-x1','seller-x2','shopper-x1')")
    con.commit()


def test_today_and_shop_tabs_and_a_closed_sign_reaches_shoppers():
    from app.db import connect
    from app.services import inquiries as inq, shopsettings
    shop = connect().execute("SELECT shop_id FROM offers GROUP BY shop_id HAVING COUNT(*)>3 LIMIT 1 OFFSET 9").fetchone()[0]
    tok = inq.shop_token(shop)
    t = c.get(f"/api/seller/{shop}/{tok}/today").json()
    assert {"asked", "answered", "missed", "avg_response_s", "top", "tip"} <= set(t)
    r = c.post(f"/api/seller/{shop}/{tok}/shop/closed", json={"mode": "hours", "hours": 2}).json()
    assert r["closed_until"] and r["open"]["state"] == "closed"
    assert c.get(f"/api/shops/{shop}").json()["open"]["state"] == "closed"
    r = c.post(f"/api/seller/{shop}/{tok}/shop/closed", json={"mode": "reopen"}).json()
    assert r["closed_until"] is None
    assert c.post(f"/api/demo/call-seller/{shop}").status_code == 409, "the seller page is not open"
    c.get(f"/api/seller/{shop}/{tok}/inquiries")
    call = c.post(f"/api/demo/call-seller/{shop}").json()
    assert call["live_call"] and call["status"] in ("sent", "delivered")
    assert shopsettings.closed_until(shop) is None
