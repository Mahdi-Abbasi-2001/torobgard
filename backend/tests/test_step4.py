"""Step 4 (contact & follow-up): free-text conversations, follow-ups, the shared confirmation layer, listing updates,
holds, rechecks, reports, reliability, waves and auto-alternatives. LLM off: the rule parser must carry everything."""
import asyncio, json, os, time
os.environ["TOROB_SIMULATE_SELLERS"] = "0"
import httpx
import pytest
from fastapi.testclient import TestClient
from app import db
from app.main import app
from app.agent import llm as llm_mod
from app.services import bale, catalog, converse, inquiries as inq, verify


@pytest.fixture(autouse=True)
def no_llm(monkeypatch):
    monkeypatch.setattr(llm_mod.OpenAICompatLLM, "configured", property(lambda self: False))


def _product(c, min_shops=4):
    items = c.get("/api/search/products", params={"q": "هندزفری", "limit": 60}).json()["items"]
    for p in items:
        if p["shop_count"] < min_shops:
            continue
        shops = [s for s in c.get(f"/api/products/{p['product_id']}/shops", params={"sort": "distance"}).json()["listed"]
                 if s["offer"]["price"] and not s["offer"]["suspicious"]]
        if len(shops) >= min_shops:
            return p["product_id"], shops
    raise AssertionError("no product with enough priced shops")


def _session(c):
    sid = f"s4-{time.time()}"
    c.put(f"/api/sessions/{sid}", json={"state": {"location": {"lat": 35.6955, "lon": 51.413}}})
    return sid


def _seller(c, shop_id):
    return "/api/seller" + c.get(f"/api/demo/seller-link/{shop_id}").json()["path"][len("/seller"):]


# ------------------------------------------------------------------ parsing
@pytest.mark.parametrize("text,ctx,expect", [
    ("سلام، بله موجوده. قیمتش ۲٬۹۵۰٬۰۰۰ تومنه. تا ۸ شب هستیم.", {"listed": 2_850_000}, {"available": True, "price": 2_950_000, "closes_at": "20:00"}),
    ("داریم ولی قیمت رفته بالا، ۳۱۰۰ میشه", {"listed": 2_850_000}, {"available": True, "price": 3_100_000}),
    ("۲ میلیون و ۸۵۰", {}, {"price": 2_850_000}),
    ("مشکیش تموم شده، سفید داریم", {}, {"available": True, "variants_available": ["سفید"], "variants_unavailable": ["مشکی"]}),
    ("نه متاسفانه تموم کردیم. مشابهش ردمی بادز ۵ رو داریم", {}, {"available": False, "price": None, "alt_suggestion": "ردمی بادز 5"}),
    ("فعلاً نداریم، فردا بار میاد", {}, {"available": False, "restock": "فردا"}),
    ("قسطی نداریم ولی موجوده ۱۲۰۰", {"listed": 1_200_000}, {"available": True, "price": 1_200_000, "installment": False}),
    ("باشه، تا ساعت ۶ براتون کنار می‌ذارم", {"kind": "hold"}, {"hold_accepted": True, "closes_at": None}),
    ("شرمنده، نگه نمی‌داریم", {"kind": "hold"}, {"hold_accepted": False}),
    ("همین الان آخریش فروخته شد", {"kind": "recheck"}, {"available": False}),
])
def test_rule_parser(text, ctx, expect):
    got = converse.rule_parse(text, ctx)
    for k, v in expect.items():
        assert got[k] == v, (k, got)


def test_follow_up_rules():
    ctx = {"kind": "ask", "keys": ["stock", "price"]}
    assert "قیمت" in converse.follow_up({"available": True, "price": None}, ctx, 0)
    assert "موجود" in converse.follow_up({"available": None}, ctx, 0)
    assert converse.follow_up({"available": True, "price": 5000}, ctx, 0) is None
    assert converse.follow_up({"available": None}, ctx, converse.MAX_FOLLOW_UPS) is None
    assert converse.follow_up({"available": False}, ctx, 0) is None


def test_suggested_questions_fall_back_to_rules():
    p = {"product_id": "x-phone", "title": "گوشی موبایل سامسونگ A55", "category": "گوشی موبایل", "specs": [{"key": "حافظه داخلی", "value": "256 گیگابایت"}]}
    qs = asyncio.run(converse.suggest_questions(p, None))
    assert qs and qs[0]["key"] == "c1" and any("رجیستر" in q["text"] for q in qs) and any("256" in q["text"] for q in qs)


# ------------------------------------------------------------------ conversation over the web inbox
def test_free_text_reply_gets_a_follow_up_then_a_final_answer_that_feeds_the_shared_layer():
    with TestClient(app) as c:
        pid, shops = _product(c)
        sid, shop = _session(c), shops[0]
        iid = c.post("/api/inquiries", json={"session_id": sid, "shop_ids": [shop["shop_id"]], "product_id": pid}).json()["items"][0]["id"]
        base = _seller(c, shop["shop_id"])
        r = c.post(f"{base}/inquiries/{iid}/reply", json={"text": "بله داریم، تشریف بیارید"}).json()
        assert r["follow_up"] and "قیمت" in r["follow_up"]
        v = r["inquiry"]
        assert v["status"] == "delivered" and v["awaiting_seller"] and v["label"] == "در حال گفتگو"
        assert [m["role"] for m in v["thread"]] == ["buyer", "seller", "agent"]
        listed = shop["offer"]["price"]
        r = c.post(f"{base}/inquiries/{iid}/reply", json={"text": f"{listed // 1000} میشه، تا ۹ شب هستیم"}).json()
        v = r["inquiry"]
        assert r["follow_up"] is None and v["status"] == "answered"
        assert v["answer"]["available"] is True and v["answer"]["price"] == listed // 1000 * 1000 and v["answer"]["closes_at"] == "21:00"
        assert v["answer"]["summary"] and v["answer"]["drift"] is not None
        # everyone now sees it as confirmed on the shop list
        s = next(x for x in c.get(f"/api/products/{pid}/shops").json()["listed"] if x["shop_id"] == shop["shop_id"])
        assert s["confirmation"]["state"] == "fresh" and s["confirmation"]["available"] is True
        assert s["confirmation"]["price"] == listed // 1000 * 1000 and s["confirmation"]["source"] == "seller"


def test_out_of_stock_then_seller_suggests_a_similar_item_late():
    with TestClient(app) as c:
        pid, shops = _product(c)
        sid, shop = _session(c), shops[1]
        iid = c.post("/api/inquiries", json={"session_id": sid, "shop_ids": [shop["shop_id"]], "product_id": pid}).json()["items"][0]["id"]
        base = _seller(c, shop["shop_id"])
        v = c.post(f"{base}/inquiries/{iid}/reply", json={"text": "نه متاسفانه نداریم"}).json()["inquiry"]
        assert v["status"] == "unavailable" and v["thread"][-1]["role"] == "agent" and "مشابه" in v["thread"][-1]["text"]
        v = c.post(f"{base}/inquiries/{iid}/reply", json={"text": "مشابهش ایرپاد پرو ۲ رو داریم"}).json()["inquiry"]
        assert v["status"] == "unavailable" and v["answer"]["alt_suggestion"] == "ایرپاد پرو 2"
        s = next(x for x in c.get(f"/api/products/{pid}/shops").json()["listed"] if x["shop_id"] == shop["shop_id"])
        assert s["confirmation"]["available"] is False


def test_same_as_listed_and_listing_update():
    with TestClient(app) as c:
        pid, shops = _product(c)
        sid, shop = _session(c), shops[2]
        listed = shop["offer"]["price"]
        ids = [i["id"] for i in c.post("/api/inquiries", json={"session_id": sid, "shop_ids": [shop["shop_id"]], "product_id": pid}).json()["items"]]
        base = _seller(c, shop["shop_id"])
        v = c.post(f"{base}/inquiries/{ids[0]}/answer", json={"available": True, "same_as_listed": True}).json()
        assert v["answer"]["price"] == listed and v["answer"]["same_as_listed"]
        # second inquiry: new price + "update my listing too"
        iid = c.post("/api/inquiries", json={"session_id": sid, "shop_ids": [shop["shop_id"]], "product_id": pid}).json()["items"][0]["id"]
        new = int(listed * 1.1) // 1000 * 1000
        v = c.post(f"{base}/inquiries/{iid}/answer", json={"available": True, "price": new, "update_listing": True}).json()
        assert v["answer"]["listing_updated"]
        s = next(x for x in c.get(f"/api/products/{pid}/shops").json()["listed"] if x["shop_id"] == shop["shop_id"])
        assert s["offer"]["price"] == new and s["offer"]["updated_by_seller"] and s["offer"]["freshness"] == "fresh"
        assert s["offer"]["listed_before_update"] == listed
        shop_page = c.get(f"/api/shops/{shop['shop_id']}").json()
        o = next((o for o in shop_page["offers"] if o["product_id"] == pid), None)
        assert o is None or o["price"] == new
        # undo for other tests / local runs
        con = db.connect(); con.execute("DELETE FROM listing_updates WHERE shop_id=? AND product_id=?", (shop["shop_id"], pid)); con.commit()


# ------------------------------------------------------------------ hold, recheck, plan, reports
def test_hold_and_recheck_and_visit_plan():
    with TestClient(app) as c:
        pid, shops = _product(c)
        sid = _session(c)
        a, b = shops[0]["shop_id"], shops[1]["shop_id"]
        items = c.post("/api/inquiries", json={"session_id": sid, "shop_ids": [a, b], "product_id": pid}).json()["items"]
        ia, ib = items[0]["id"], items[1]["id"]
        assert c.post(f"/api/inquiries/{ia}/hold", json={"session_id": sid, "until": "18:00"}).status_code == 409, "hold needs a yes first"
        for s, i in ((a, ia), (b, ib)):
            c.post(f"{_seller(c, s)}/inquiries/{i}/answer", json={"available": True, "price": 1_000_000})
        h = c.post(f"/api/inquiries/{ia}/hold", json={"session_id": sid, "until": "18:30"}).json()
        assert h["kind"] == "hold" and h["parent_id"] == ia and "۱۸:۳۰" in h["thread"][0]["text"]
        v = c.post(f"{_seller(c, a)}/inquiries/{h['id']}/reply", json={"text": "باشه، نگه می‌دارم"}).json()["inquiry"]
        assert v["answer"]["hold_accepted"] and len(v["answer"]["hold_code"]) == 4
        r = c.post(f"/api/inquiries/{ib}/recheck", json={"session_id": sid, "eta_min": 25}).json()
        assert r["kind"] == "recheck" and "۲۵" in r["thread"][0]["text"]
        c.post(f"{_seller(c, b)}/inquiries/{r['id']}/answer", json={"available": False})
        plan = c.post("/api/visit-plan", json={"session_id": sid, "product_id": pid}).json()
        ids = [s["shop_id"] for s in plan["stops"]]
        assert ids == [a], "a shop that said 'sold out' on recheck must drop out of the plan"
        assert plan["stops"][0]["hold"]["code"] == v["answer"]["hold_code"]
        # the main tracker list keeps children attached by parent_id
        allq = c.get(f"/api/sessions/{sid}/inquiries").json()["items"]
        assert {q["kind"] for q in allq} == {"ask", "hold", "recheck"}


def test_visit_report_feeds_confirmations_and_reliability():
    with TestClient(app) as c:
        pid, shops = _product(c)
        sid, shop = _session(c), shops[3]["shop_id"]
        before = c.get(f"/api/shops/{shop}").json()["reliability"]["visits"]
        r = c.post("/api/reports", json={"session_id": sid, "shop_id": shop, "product_id": pid, "kind": "visit",
                                         "available": True, "price": 990_000}).json()
        assert r["kind"] == "visit"
        s = next(x for x in c.get(f"/api/products/{pid}/shops").json()["listed"] if x["shop_id"] == shop)
        assert s["confirmation"]["source"] == "visit" and s["confirmation"]["price"] == 990_000
        assert c.get(f"/api/shops/{shop}").json()["reliability"]["visits"] == before + 1
        assert c.get(f"/api/sessions/{sid}/reports").json()["items"][0]["shop_id"] == shop
        assert c.post("/api/reports", json={"session_id": sid, "shop_id": shop, "product_id": pid, "kind": "rumour"}).status_code == 422


def test_reliability_and_confirmation_fading():
    con = db.connect()
    pid, shop = "p-rel-test", "s-rel-test"
    con.execute("DELETE FROM inquiries WHERE shop_id=?", (shop,))
    for i, st in enumerate(["answered", "answered", "answered", "no_reply"]):
        con.execute("INSERT INTO inquiries(id,session_id,shop_id,product_id,questions,status,token,created_at,answered_at,deadline_at) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?)", (f"inq_rel{i}", "x", shop, pid, "{}", st, "t", "2026-10-22T10:00:00+00:00",
                                                    "2026-10-22T10:04:00+00:00" if st == "answered" else None, "2026-10-22T10:05:00+00:00"))
    con.commit()
    r = verify.reliability(con, [shop])[shop]
    assert r["asked"] == 4 and r["replied"] == 3 and r["median_reply_s"] == 240 and r["known"]
    assert "۴ دقیقه" in r["label"] and "۳ پیام از ۴ پیام" in r["label"]
    con.execute("DELETE FROM inquiries WHERE shop_id=?", (shop,)); con.commit()
    assert verify.state_for(30) == "fresh" and verify.state_for(200) == "aging" and verify.state_for(500) == "expired"


# ------------------------------------------------------------------ waves and auto-alternatives
def test_waves_ask_the_next_shop_only_when_one_fails():
    with TestClient(app) as c:
        pid, shops = _product(c)
        sid = _session(c)
        con = db.connect(); con.execute("DELETE FROM confirmations WHERE product_id=?", (pid,)); con.commit(); con.close()  # earlier runs' "no"s
        cmp = c.post("/api/inquiries/smart", json={"session_id": sid, "product_id": pid, "wave": 1, "target": 1, "max_shops": 4}).json()
        assert cmp["status"] == "running" and cmp["asked"] == 1 and cmp["queued"] >= 1 and cmp["next"][0]["why"]
        first = [i for i in c.get(f"/api/sessions/{sid}/inquiries").json()["items"] if i["campaign_id"] == cmp["id"]]
        assert len(first) == 1
        c.post(f"{_seller(c, first[0]['shop']['shop_id'])}/inquiries/{first[0]['id']}/answer", json={"available": False})
        now = [i for i in c.get(f"/api/sessions/{sid}/inquiries").json()["items"] if i["campaign_id"] == cmp["id"]]
        assert len(now) == 2, "a 'no' moves the wave on"
        nxt = next(i for i in now if i["status"] == "sent")
        c.post(f"{_seller(c, nxt['shop']['shop_id'])}/inquiries/{nxt['id']}/answer", json={"available": True, "price": 1_000_000})
        done = c.get(f"/api/sessions/{sid}/campaigns").json()["items"][0]
        assert done["status"] == "done" and done["confirmed"] == 1
        assert len([i for i in c.get(f"/api/sessions/{sid}/inquiries").json()["items"] if i["campaign_id"] == cmp["id"]]) == 2


def test_auto_alternatives_when_enabled():
    with TestClient(app) as c:
        pid, shops = _product(c)
        sid = _session(c)
        c.put(f"/api/sessions/{sid}", json={"state": {"auto_alternatives": True}})
        iid = c.post("/api/inquiries", json={"session_id": sid, "shop_ids": [shops[0]["shop_id"]], "product_id": pid}).json()["items"][0]["id"]
        c.post(f"{_seller(c, shops[0]['shop_id'])}/inquiries/{iid}/answer", json={"available": False})
        auto = [i for i in c.get(f"/api/sessions/{sid}/inquiries").json()["items"] if i["auto_from"] == iid]
        assert 1 <= len(auto) <= 2 and all(i["shop"]["shop_id"] != shops[0]["shop_id"] for i in auto)


def test_product_questions_endpoint_and_custom_questions_reach_the_seller():
    with TestClient(app) as c:
        pid, shops = _product(c)
        q = c.get(f"/api/products/{pid}/inquiry-questions").json()
        assert q["custom"] and q["custom"][0]["key"] == "c1"
        sid = _session(c)
        v = c.post("/api/inquiries", json={"session_id": sid, "shop_ids": [shops[0]["shop_id"]], "product_id": pid,
                                          "questions": ["stock", "c1"], "custom": {"c1": "اصل است یا های‌کپی؟"}}).json()["items"][0]
        assert [x["key"] for x in v["questions"]] == ["stock", "c1"] and v["questions"][1]["custom"]
        assert "های‌کپی" in v["thread"][0]["text"]


# ------------------------------------------------------------------ Bale: free text, hold buttons, shopper follow
class FakeBale:
    def __init__(self):
        self.calls, self.n = [], 100
        self.client = bale.BaleClient("TEST", "https://fake.bale", httpx.MockTransport(self._h))
    def _h(self, req):
        method = req.url.path.rsplit("/", 1)[-1]
        self.calls.append((method, json.loads(req.content or b"{}")))
        self.n += 1
        return httpx.Response(200, json={"ok": True, "result": {"message_id": self.n}})
    def texts(self, chat): return [p["text"] for m, p in self.calls if m == "sendMessage" and str(p["chat_id"]) == str(chat)]


def _msg(chat, text, reply_to=None):
    m = {"chat": {"id": chat}, "text": text}
    if reply_to:
        m["reply_to_message"] = {"message_id": reply_to}
    return {"update_id": 1, "message": m}


def test_bale_free_text_follow_up_and_hold_buttons(monkeypatch):
    con = db.connect()
    con.execute("DELETE FROM bale_links"); con.execute("DELETE FROM bale_kv"); con.commit()
    pid = next(p for p in catalog.search_products(con, "هندزفری", limit=60)["items"] if p["shop_count"] >= 2)["product_id"]
    shop = catalog.find_shops(con, [pid], include_category_only=False)["listed"][0]["shop_id"]
    fb = FakeBale()
    monkeypatch.setattr(bale, "CLIENT", fb.client)
    monkeypatch.setattr(bale, "TOKEN", "TEST")
    asyncio.run(bale.handle_update(fb.client, _msg(5, bale.link_command(shop))))
    iid = inq.create(con, "bale-s4", [shop], pid, ["stock", "price"])[0]["id"]
    asyncio.run(bale.notify_inquiry(iid, fb.client))
    asyncio.run(bale.handle_update(fb.client, _msg(5, "بله داریم")))
    assert "قیمت" in fb.texts(5)[-1], "the assistant asks the missing price in the same chat"
    asyncio.run(bale.handle_update(fb.client, _msg(5, "۲ میلیون و ۸۵۰")))
    v = inq.view(db.connect(), iid)
    assert v["status"] == "answered" and v["answer"]["price"] == 2_850_000 and v["answer"]["channel"] == "bale"
    assert any("ثبت شد" in t for t in fb.texts(5)[-2:])
    hid = inq.request_hold(db.connect(), iid, "19:00")["id"]
    asyncio.run(bale.notify_inquiry(hid, fb.client))
    kb = [p["reply_markup"]["inline_keyboard"] for m, p in fb.calls if m == "sendMessage" and "reply_markup" in p][-1]
    assert kb[0][0]["callback_data"] == f"h:{hid}:1"
    asyncio.run(bale.handle_update(fb.client, {"update_id": 3, "callback_query": {"id": "c", "data": f"h:{hid}:1", "message": {"chat": {"id": 5}}}}))
    hv = inq.view(db.connect(), hid)
    assert hv["answer"]["hold_accepted"] and hv["answer"]["hold_code"] in fb.texts(5)[-1]


def test_bale_shopper_follow_requires_token():
    con = db.connect(); con.execute("DELETE FROM bale_kv"); con.commit()
    fb = FakeBale()
    asyncio.run(bale.handle_update(fb.client, _msg(11, "/follow sess-x wrong")))
    assert "نامعتبر" in fb.texts(11)[-1]
    asyncio.run(bale.handle_update(fb.client, _msg(11, bale.follow_command("sess-x"))))
    assert "همین‌جا" in fb.texts(11)[-1]
    assert bale._kv_get(db.connect(), "buyer:sess-x") == "11"
