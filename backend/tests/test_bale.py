import asyncio, json, os
os.environ["TOROB_SIMULATE_SELLERS"] = "0"
import httpx
from app import db
from app.services import bale, catalog, inquiries as inq


class FakeBale:
    """Records Bot API calls the way tapi.bale.ai would receive them."""
    def __init__(self):
        self.calls = []
        self.client = bale.BaleClient("TEST", "https://fake.bale", httpx.MockTransport(self._h))
    def _h(self, req):
        method = req.url.path.rsplit("/", 1)[-1]
        self.calls.append((method, json.loads(req.content or b"{}")))
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 1}})
    def texts(self, chat=None): return [p["text"] for m, p in self.calls if m == "sendMessage" and (chat is None or str(p["chat_id"]) == str(chat))]
    def last_keyboard(self):
        return [p["reply_markup"]["inline_keyboard"] for m, p in self.calls if m == "sendMessage" and "reply_markup" in p][-1]


def run(coro): return asyncio.run(coro)
def msg(chat, text): return {"update_id": 1, "message": {"chat": {"id": chat}, "text": text}}
def tap(chat, data): return {"update_id": 2, "callback_query": {"id": "cb1", "data": data, "message": {"chat": {"id": chat}}}}


def _setup():
    con = db.connect()
    con.execute("DELETE FROM bale_links"); con.execute("DELETE FROM bale_kv"); con.commit()
    pid = next(p for p in catalog.search_products(con, "هندزفری", limit=60)["items"] if p["shop_count"] >= 2)["product_id"]
    shop = catalog.find_shops(con, [pid], include_category_only=False)["listed"][0]["shop_id"]
    iid = inq.create(con, "bale-s1", [shop], pid, ["stock", "price"])[0]["id"]
    return con, shop, iid


def test_parse_price():
    assert bale.parse_price("۲٬۸۵۰٬۰۰۰") == 2_850_000
    assert bale.parse_price("2.85 میلیون") == 2_850_000
    assert bale.parse_price("۲۸۵۰ هزار") == 2_850_000
    assert bale.parse_price("سلام") is None


def test_link_requires_the_real_token_then_full_conversation():
    con, shop, iid = _setup(); fb = FakeBale()
    run(bale.handle_update(fb.client, msg(7, "/start")))
    assert "ترب‌گرد" in fb.texts(7)[-1]
    run(bale.handle_update(fb.client, msg(7, f"/link {shop} wrongtoken")))
    assert "نامعتبر" in fb.texts(7)[-1] and not bale.is_linked(db.connect(), shop)
    run(bale.handle_update(fb.client, msg(7, bale.link_command(shop))))
    assert bale.is_linked(db.connect(), shop) and any("متصل شد" in t for t in fb.texts(7))
    # linking pushes the already-waiting inquiry with two buttons
    kb = fb.last_keyboard()[0]
    assert [b["callback_data"] for b in kb] == [f"a:{iid}:1", f"a:{iid}:0"]
    assert inq.view(db.connect(), iid)["status"] == "delivered"
    # tap "available" -> bot asks for the price -> price answers the inquiry
    run(bale.handle_update(fb.client, tap(7, f"a:{iid}:1")))
    assert any(m == "answerCallbackQuery" for m, _ in fb.calls) and "قیمت" in fb.texts(7)[-1]
    run(bale.handle_update(fb.client, msg(7, "۲٬۸۵۰٬۰۰۰")))
    v = inq.view(db.connect(), iid)
    assert v["status"] == "answered" and v["answer"]["price"] == 2_850_000 and v["answer"]["available"] is True
    assert "ثبت شد" in fb.texts(7)[-1]


def test_unavailable_button_bad_price_and_skip():
    con, shop, iid = _setup(); fb = FakeBale()
    run(bale.handle_update(fb.client, msg(9, bale.link_command(shop))))
    run(bale.handle_update(fb.client, tap(9, f"a:{iid}:0")))
    assert inq.view(db.connect(), iid)["status"] == "unavailable"
    con, shop, iid = _setup(); fb = FakeBale()
    run(bale.handle_update(fb.client, msg(9, bale.link_command(shop))))
    run(bale.handle_update(fb.client, tap(9, f"a:{iid}:1")))
    run(bale.handle_update(fb.client, msg(9, "نمیدونم")))
    assert "عدد" in fb.texts(9)[-1] and inq.view(db.connect(), iid)["status"] == "delivered", "bad price must not answer"
    run(bale.handle_update(fb.client, msg(9, "/skip")))
    v = inq.view(db.connect(), iid)
    assert v["status"] == "answered" and v["answer"]["price"] is None


def test_a_foreign_chat_cannot_answer_someone_elses_inquiry():
    con, shop, iid = _setup(); fb = FakeBale()
    run(bale.handle_update(fb.client, msg(1, bale.link_command(shop))))
    run(bale.handle_update(fb.client, tap(666, f"a:{iid}:1")))   # chat 666 never linked this shop
    assert "نیست" in fb.texts(666)[-1] and inq.view(db.connect(), iid)["status"] == "delivered"
    assert not any("await_price" in (r[0] or "") for r in db.connect().execute("SELECT k FROM bale_kv").fetchall())


def test_notify_returns_false_for_unlinked_shop():
    con, shop, iid = _setup(); fb = FakeBale()
    assert run(bale.notify_inquiry(iid, fb.client)) is False and not fb.calls


def test_poll_loop_processes_updates_and_remembers_offset():
    """getUpdates is called with the stored offset; every handled update advances it, so a restart never replays messages."""
    c0 = db.connect(); c0.execute("DELETE FROM bale_kv"); c0.commit(); c0.close()
    seen_offsets, served = [], {"done": False}
    def handler(req):
        method = req.url.path.rsplit("/", 1)[-1]
        body = json.loads(req.content or b"{}")
        if method == "getUpdates":
            seen_offsets.append(body.get("offset"))
            if not served["done"]:
                served["done"] = True
                return httpx.Response(200, json={"ok": True, "result": [{"update_id": 41, "message": {"chat": {"id": 5}, "text": "/start"}}]})
            return httpx.Response(200, json={"ok": True, "result": []})
        sent.append(method)
        return httpx.Response(200, json={"ok": True, "result": {}})
    sent = []
    client = bale.BaleClient("TEST", "https://fake.bale", httpx.MockTransport(handler))
    async def go():
        t = asyncio.create_task(bale.poll_loop(client)); await asyncio.sleep(0.4); t.cancel()
        try: await t
        except asyncio.CancelledError: pass
    run(go())
    assert "sendMessage" in sent, "the /start update must have been handled"
    assert bale._kv_get(db.connect(), "offset") == 42
    assert seen_offsets[0] == 0 and 42 in seen_offsets, seen_offsets
