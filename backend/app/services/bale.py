"""Bale messenger channel (Telegram-compatible Bot API, https://docs.bale.ai) for sellers and shoppers.

Sellers link a shop with `/link <shop_id> <token>` (the HMAC from the seller link, so only someone holding that link can
claim the shop). Inquiries for linked shops arrive with one-tap buttons:
  ✅ همان قیمت ثبت‌شده · ✏️ قیمت جدید · ❌ ناموجود · ⏰ فردا موجود می‌شود
Sellers may also just type (or send a voice note): the text is parsed like any free-text answer and the assistant asks a
follow-up if something is missing. After a price answer the bot offers to update the shop's listed price too.
Shoppers can link their own chat with `/follow <session> <token>` to get answers as Bale messages.
Long polling (getUpdates), so no public URL is needed. Enabled only when BALE_BOT_TOKEN is set."""
from __future__ import annotations
import asyncio
import json
import os
import re
from datetime import datetime, timezone

import httpx

from .. import db
from . import inquiries as inq
from .converse import money
from .text import normalize_fa

TOKEN = os.environ.get("BALE_BOT_TOKEN", "")
BASE = os.environ.get("BALE_API_BASE", "https://tapi.bale.ai").rstrip("/")
BOT_USERNAME = os.environ.get("BALE_BOT_USERNAME", "")
CLIENT: "BaleClient | None" = None


def enabled() -> bool:
    return bool(TOKEN)


class BaleError(Exception):
    pass


class BaleClient:
    def __init__(self, token: str = "", base: str = "", transport=None):
        self.token, self.base = token or TOKEN, (base or BASE).rstrip("/")
        self._c = httpx.AsyncClient(timeout=40, transport=transport)

    async def call(self, method: str, **params):
        r = await self._c.post(f"{self.base}/bot{self.token}/{method}", json=params)
        data = r.json()
        if not data.get("ok"):
            raise BaleError(f"{method}: {str(data)[:160]}")
        return data["result"]

    async def send(self, chat_id, text: str, buttons: list[list[tuple[str, str]]] | None = None):
        p = {"chat_id": chat_id, "text": text}
        if buttons:
            p["reply_markup"] = {"inline_keyboard": [[{"text": t, "callback_data": d} for t, d in row] for row in buttons]}
        return await self.call("sendMessage", **p)

    async def download(self, file_id: str) -> bytes:
        f = await self.call("getFile", file_id=file_id)
        r = await self._c.get(f"{self.base}/file/bot{self.token}/{f['file_path']}")
        r.raise_for_status()
        return r.content


def parse_price(text: str) -> int | None:
    """'۲٬۸۵۰٬۰۰۰' -> 2850000; '2.85 میلیون' -> 2850000; '2850 هزار' -> 2850000; '1500' -> 1500 (toman)."""
    t = normalize_fa(text).replace("٬", "").replace(",", "").replace("٫", ".")
    m = re.search(r"(\d+(?:\.\d+)?)\s*(میلیون|ملیون|هزار)?", t)
    if not m:
        return None
    v = float(m.group(1)) * {"میلیون": 1_000_000, "ملیون": 1_000_000, "هزار": 1_000}.get(m.group(2) or "", 1)
    return int(v) if 0 < v < 10_000_000_000 else None


def _kv_get(con, k, default=None):
    r = con.execute("SELECT v FROM bale_kv WHERE k=?", (k,)).fetchone()
    return json.loads(r[0]) if r else default


def _kv_set(con, k, v):
    con.execute("INSERT INTO bale_kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, json.dumps(v)))
    con.commit()


def _kv_del(con, k):
    con.execute("DELETE FROM bale_kv WHERE k=?", (k,))
    con.commit()


def is_linked(con, shop_id: str) -> bool:
    return con.execute("SELECT 1 FROM bale_links WHERE shop_id=?", (shop_id,)).fetchone() is not None


def link_command(shop_id: str) -> str:
    return f"/link {shop_id} {inq.shop_token(shop_id)}"


def follow_command(session_id: str) -> str:
    return f"/follow {session_id} {inq.buyer_token(session_id)}"


HELP = ("سلام! من ربات استعلام ترب‌گرد هستم.\n"
        "فروشنده‌ها: برای اینکه پرسش‌های خریداران به همین گفتگو بیاید، دستور اتصال را از صفحه‌ی فروشنده کپی کنید و بفرستید:\n"
        "/link <شناسه‌ی فروشگاه> <کد>\n"
        "وقتی استعلامی بیاید با دکمه‌ها جواب بدهید، یا خیلی ساده جواب را بنویسید یا پیام صوتی بفرستید.\n\n"
        "خریدارها: دستور /follow را از صفحه‌ی پیگیری ترب‌گرد کپی کنید تا پاسخ فروشنده‌ها همین‌جا بیاید.")


def _inquiry_text(con, iid: str) -> str:
    v = inq.view(con, iid)
    kind = v["kind"]
    head = {"ask": "📩 استعلام جدید", "hold": "📌 درخواست نگه‌داشتن کالا", "recheck": "🚶 مشتری در راه است", "arrive": "📍 مشتری رسید", "bargain": "💬 پیشنهاد قیمت"}[kind]
    lines = [head, f"فروشگاه: {v['shop']['name']}", ""]
    first = next((m["text"] for m in v["thread"] if m["role"] == "buyer"), None)
    lines.append(first or f"کالا: {v['product']['title'] if v['product'] else '—'}")
    if kind == "ask" and v["listed_price"]:
        lines.append(f"\n(قیمت ثبت‌شده‌ی شما در ترب: {money(v['listed_price'])} تومان)")
    if kind == "ask":
        lines.append("\nبا دکمه‌ها جواب بدهید یا جوابتان را بنویسید (مثلاً «داریم، ۲ و ۸۵۰ تا ۸ شب هستیم»).")
    return "\n".join(lines)


def _buttons(v: dict) -> list[list[tuple[str, str]]]:
    iid = v["id"]
    if v["kind"] == "hold":
        return [[("✅ نگه می‌دارم", f"h:{iid}:1"), ("❌ نمی‌توانم", f"h:{iid}:0")]]
    if v["kind"] == "recheck":
        return [[("✅ هنوز هست", f"r:{iid}:1"), ("❌ تمام شد", f"r:{iid}:0")]]
    if v["kind"] == "arrive":
        return [[("✅ بیایید، منتظرم", f"r:{iid}:1"), ("⏳ الان نمی‌توانم", f"r:{iid}:0")]]
    if v["kind"] == "bargain":
        return [[("✅ قبول است", f"b:{iid}:1"), ("❌ نمی‌شود", f"b:{iid}:0")]]
    first = [("✅ همان قیمت ثبت‌شده", f"a:{iid}:same"), ("✏️ قیمت جدید", f"a:{iid}:1")] if v["listed_price"] else [("✅ موجود است", f"a:{iid}:1")]
    return [first, [("❌ ناموجود است", f"a:{iid}:0"), ("⏰ فردا موجود می‌شود", f"a:{iid}:tom")]]


async def notify_inquiry(iid: str, client: "BaleClient | None" = None) -> bool:
    """Push an inquiry to the shop's linked chat. False if the shop has no linked chat (caller may then simulate)."""
    client = client or CLIENT
    if not client:
        return False
    con = db.connect()
    try:
        r = con.execute("SELECT shop_id, status FROM inquiries WHERE id=?", (iid,)).fetchone()
        if not r or r["status"] not in ("sent", "delivered"):
            return False
        link = con.execute("SELECT chat_id FROM bale_links WHERE shop_id=?", (r["shop_id"],)).fetchone()
        if not link:
            return False
        v = inq.view(con, iid)
        m = await client.send(link["chat_id"], _inquiry_text(con, iid), _buttons(v))
        if isinstance(m, dict) and m.get("message_id"):
            _kv_set(con, f"msg:{link['chat_id']}:{m['message_id']}", iid)
        inq.mark_delivered(con, iid)
        inq.publish(v["session_id"], {"type": "inquiry", "inquiry": inq.view(con, iid)})
        return True
    finally:
        con.close()


async def send_stockcheck(shop_id: str, items: list[dict], client: "BaleClient | None" = None) -> int:
    """The daily «do you still have these?» list to a linked shop: one message per item, two buttons each. Returns how many were sent."""
    client = client or CLIENT
    if not client or not items:
        return 0
    con = db.connect()
    try:
        link = con.execute("SELECT chat_id FROM bale_links WHERE shop_id=?", (shop_id,)).fetchone()
        if not link:
            return 0
        await client.send(link["chat_id"], f"🗓 بررسی روزانهٔ موجودی: {len(items)} کالای پرتقاضای شما. برای هرکدام یک دکمه بزنید؛ خریدارها همان‌جا موجود بودنش را می‌بینند.")
        for it in items:
            price = f" (قیمت ثبت‌شده: {it['price']:,} تومان)" if it.get("price") else ""
            await client.send(link["chat_id"], f"{str(it['title'])[:80]}{price}\nهنوز دارید؟", [[("✅ دارم", f"s:{it['id']}:1"), ("❌ ندارم", f"s:{it['id']}:0")]])
        return len(items)
    finally:
        con.close()


async def send_follow_up(con, shop_id: str, iid: str, text: str, client: "BaleClient | None" = None):
    """The assistant's follow-up question to a linked seller (the next free-text message answers it)."""
    client = client or CLIENT
    link = con.execute("SELECT chat_id FROM bale_links WHERE shop_id=?", (shop_id,)).fetchone()
    if not client or not link:
        return
    v = inq.view(con, iid)
    m = await client.send(link["chat_id"], f"🤖 {text}\n(دربارهٔ «{(v['product'] or {}).get('title', '')[:50]}»؛ جواب را بنویسید)")
    if isinstance(m, dict) and m.get("message_id"):
        _kv_set(con, f"msg:{link['chat_id']}:{m['message_id']}", iid)
    _kv_set(con, f"focus:{link['chat_id']}", iid)


async def handle_update(client: "BaleClient", upd: dict):
    con = db.connect()
    try:
        if "callback_query" in upd:
            await _on_callback(con, client, upd["callback_query"])
        elif "message" in upd:
            m = upd["message"]
            if m.get("text"):
                await _on_message(con, client, m)
            elif m.get("voice") or m.get("audio"):
                await _on_voice(con, client, m)
    finally:
        con.close()


def _chat_shops(con, chat: str) -> list[str]:
    return [r[0] for r in con.execute("SELECT shop_id FROM bale_links WHERE chat_id=?", (chat,))]


def _target_inquiry(con, chat: str, m: dict) -> str | None:
    """Which inquiry a free-text message answers: the one replied to, else the one the bot last asked about, else the
    newest waiting inquiry of this chat's shops."""
    rep = (m.get("reply_to_message") or {}).get("message_id")
    if rep:
        iid = _kv_get(con, f"msg:{chat}:{rep}")
        if iid:
            return iid
    shops = _chat_shops(con, chat)
    if not shops:
        return None
    ph = ",".join("?" * len(shops))
    focus = _kv_get(con, f"focus:{chat}")
    if focus:
        r = con.execute(f"SELECT id FROM inquiries WHERE id=? AND shop_id IN ({ph}) AND status IN ('sent','delivered')", (focus, *shops)).fetchone()
        if r:
            return r[0]
    r = con.execute(f"SELECT id FROM inquiries WHERE shop_id IN ({ph}) AND status IN ('sent','delivered') ORDER BY created_at DESC LIMIT 1",
                    shops).fetchone()
    if r:
        return r[0]
    if focus:  # late reply to an alternative question on an already-answered inquiry
        r = con.execute(f"SELECT id FROM inquiries WHERE id=? AND shop_id IN ({ph})", (focus, *shops)).fetchone()
        return r[0] if r else None
    return None


async def _free_text(con, client, chat: str, m: dict, text: str):
    iid = _target_inquiry(con, chat, m)
    if not iid:
        return await client.send(chat, "استعلام بازی برای فروشگاه‌های شما نیست. برای راهنما /start را بفرستید.")
    res = await inq.seller_says(iid, text, "bale")
    if not res.get("ok"):
        return await client.send(chat, "این پیام ثبت نشد. دوباره بفرستید.")
    if res.get("follow_up"):
        return  # send_follow_up already asked it in this chat
    v = res["inquiry"]
    if res.get("late"):
        return await client.send(chat, "✅ ممنون، به خریدار گفتیم.")
    a = v["answer"] or {}
    await client.send(chat, f"✅ ثبت شد: {a.get('summary') or v['label']}\nخریدار همین الان می‌بیند.")
    await _offer_listing_update(client, chat, v)


async def _offer_listing_update(client, chat: str, v: dict):
    a = v.get("answer") or {}
    if v["kind"] == "hold" or not a.get("price") or a.get("listing_updated") or a.get("price") == v.get("listed_price"):
        return
    await client.send(chat, f"قیمت ثبت‌شده‌ی شما در ترب هم {money(a['price'])} تومان شود؟ (بقیه‌ی خریدارها هم قیمت درست را می‌بینند)",
                      [[("بله، به‌روز کن", f"u:{v['id']}:1"), ("نه", f"u:{v['id']}:0")]])


async def _on_message(con, client, m):
    chat, text = str(m["chat"]["id"]), m["text"].strip()
    if text.startswith("/start") or text.startswith("/help"):
        return await client.send(chat, HELP)
    if text.startswith("/link"):
        parts = text.split()
        if len(parts) != 3 or not inq.valid_shop_token(parts[1], parts[2]):
            return await client.send(chat, "❌ کد اتصال نامعتبر است. دستور را دقیقاً از صفحه‌ی فروشنده کپی کنید.")
        row = con.execute("SELECT name FROM shops WHERE shop_id=?", (parts[1],)).fetchone()
        if not row:
            return await client.send(chat, "❌ فروشگاه پیدا نشد.")
        con.execute("INSERT INTO bale_links(shop_id,chat_id,linked_at) VALUES(?,?,?) ON CONFLICT(shop_id) DO UPDATE SET chat_id=excluded.chat_id, linked_at=excluded.linked_at",
                    (parts[1], chat, datetime.now(timezone.utc).isoformat()))
        con.commit()
        await client.send(chat, f"✅ فروشگاه «{row['name']}» به این گفتگو متصل شد. از این به بعد استعلام‌ها اینجا می‌آید.")
        for r in con.execute("SELECT id FROM inquiries WHERE shop_id=? AND status IN ('sent','delivered')", (parts[1],)).fetchall():
            await notify_inquiry(r["id"], client)
        return
    if text.startswith("/follow"):
        parts = text.split()
        import hmac
        if len(parts) != 3 or not hmac.compare_digest(inq.buyer_token(parts[1]), parts[2]):
            return await client.send(chat, "❌ کد پیگیری نامعتبر است. دستور را از صفحه‌ی پیگیری ترب‌گرد کپی کنید.")
        _kv_set(con, f"buyer:{parts[1]}", chat)
        return await client.send(chat, "✅ از این به بعد پاسخ فروشنده‌ها به استعلام‌هایتان همین‌جا می‌آید. برای لغو: /unfollow")
    if text.startswith("/unfollow"):
        for r in con.execute("SELECT k FROM bale_kv WHERE k LIKE 'buyer:%' AND v=?", (json.dumps(chat),)).fetchall():
            _kv_del(con, r[0])
        return await client.send(chat, "✅ دیگر پیامی نمی‌فرستیم.")
    pending = _kv_get(con, f"await_price:{chat}")
    if pending:
        if text.startswith("/skip"):
            price = None
        else:
            price = parse_price(text)
            if price is None:
                return await client.send(chat, "قیمت را به‌صورت عدد بفرستید (مثلاً ۲٬۸۵۰٬۰۰۰ یا «۲٫۸۵ میلیون»)، یا /skip.")
        _kv_del(con, f"await_price:{chat}")
        v = inq.answer(con, pending, True, price=price, message="پاسخ از طریق بله", channel="bale")
        if not v:
            return await client.send(chat, "این استعلام قبلاً پاسخ داده شده است.")
        await client.send(chat, "✅ پاسخ ثبت شد؛ خریدار همین الان می‌بیند.")
        return await _offer_listing_update(client, chat, v)
    if text.startswith("/"):
        return await client.send(chat, "برای شروع /start را بفرستید.")
    if not _chat_shops(con, chat):
        return await client.send(chat, "برای شروع /start را بفرستید.")
    await _free_text(con, client, chat, m, text)


async def _on_voice(con, client, m):
    chat = str(m["chat"]["id"])
    if not _chat_shops(con, chat):
        return await client.send(chat, "برای شروع /start را بفرستید.")
    from ..agent.llm import OpenAICompatLLM
    llm = OpenAICompatLLM()
    f = m.get("voice") or m.get("audio")
    try:
        audio = await client.download(f["file_id"])
        text = await llm.transcribe(audio, "voice.ogg")
    except Exception:
        text = ""
    if not text:
        return await client.send(chat, "پیام صوتی را نتوانستم بخوانم؛ لطفاً جواب را بنویسید.")
    await client.send(chat, f"🎙 شنیدم: «{text[:200]}»")
    await _free_text(con, client, chat, m, text)


async def _on_callback(con, client, cb):
    chat, data = str(cb["message"]["chat"]["id"]), cb.get("data", "")
    try:
        await client.call("answerCallbackQuery", callback_query_id=cb["id"])
    except BaleError:
        pass
    sc = re.fullmatch(r"s:(chk_[0-9a-f]+):(1|0)", data)
    if sc:   # the daily stock check
        cid, opt = sc.groups()
        r = con.execute("SELECT c.shop_id FROM stock_checks c JOIN bale_links b ON b.shop_id=c.shop_id WHERE c.id=? AND b.chat_id=?", (cid, chat)).fetchone()
        if not r:
            return await client.send(chat, "این مورد متعلق به فروشگاه‌های متصل به این گفتگو نیست.")
        from . import stockcheck
        done = stockcheck.answer(con, cid, r["shop_id"], opt == "1", channel="bale")
        return await client.send(chat, "✅ ثبت شد؛ ممنون." if done else "این مورد قبلاً جواب داده شده است.")
    m = re.fullmatch(r"([ahru]):(inq_[0-9a-f]+):(1|0|same|tom)", data)
    if not m:
        return
    typ, iid, opt = m.groups()
    r = con.execute("SELECT i.shop_id, i.status FROM inquiries i JOIN bale_links b ON b.shop_id=i.shop_id WHERE i.id=? AND b.chat_id=?",
                    (iid, chat)).fetchone()
    if not r:
        return await client.send(chat, "این استعلام متعلق به فروشگاه‌های متصل به این گفتگو نیست.")
    if typ == "u":
        if opt == "1":
            v = inq.set_listing_update(con, iid)
            return await client.send(chat, "✅ قیمت شما در ترب‌گرد به‌روز شد." if v else "به‌روزرسانی ممکن نشد.")
        return await client.send(chat, "باشه، فقط همین خریدار قیمت را می‌بیند.")
    if r["status"] in ("answered", "unavailable"):
        return await client.send(chat, "این استعلام قبلاً پاسخ داده شده است.")
    done = "✅ ثبت شد؛ خریدار همین الان می‌بیند."
    if typ == "h":
        v = inq.answer(con, iid, opt == "1", message="نگه می‌دارم" if opt == "1" else "نمی‌توانم نگه دارم", channel="bale",
                       extra={"hold_accepted": opt == "1"})
        return await client.send(chat, (done + (f"\nکد نگه‌داری: {v['answer']['hold_code']}" if opt == "1" else "")) if v else "قبلاً پاسخ داده شده.")
    if typ == "b":
        tgt = (inq.view(con, iid) or {}).get("target")
        v = inq.answer(con, iid, None, price=tgt if opt == "1" else None, message="قبول است" if opt == "1" else "نمی‌شود", channel="bale", extra={"bargain_accepted": opt == "1"})
        return await client.send(chat, done if v else "قبلاً پاسخ داده شده.")
    if typ == "r":
        arriving = (inq.view(con, iid) or {}).get("kind") == "arrive"
        msg = ("بفرمایید، منتظرم" if opt == "1" else "الان نمی‌توانم") if arriving else ("هنوز هست" if opt == "1" else "تمام شد")
        v = inq.answer(con, iid, opt == "1", message=msg, channel="bale")
        return await client.send(chat, done if v else "قبلاً پاسخ داده شده.")
    if opt == "0":
        v = inq.answer(con, iid, False, message="ناموجود است", channel="bale")
        return await client.send(chat, "✅ ثبت شد: ناموجود. اگر مدل مشابهی دارید، اسمش را بنویسید تا به خریدار بگوییم." if v else "این استعلام قبلاً پاسخ داده شده است.")
    if opt == "tom":
        v = inq.answer(con, iid, False, message="فردا موجود می‌شود", channel="bale", extra={"restock": "فردا"})
        return await client.send(chat, "✅ ثبت شد: فردا موجود می‌شود." if v else "این استعلام قبلاً پاسخ داده شده است.")
    if opt == "same":
        listed = inq.view(con, iid)["listed_price"]
        v = inq.answer(con, iid, True, price=listed, message="موجود است، به همان قیمت ثبت‌شده", channel="bale",
                       extra={"same_as_listed": True})
        return await client.send(chat, done if v else "این استعلام قبلاً پاسخ داده شده است.")
    _kv_set(con, f"await_price:{chat}", iid)
    await client.send(chat, "قیمت نهایی را به تومان بفرستید (مثلاً ۲٬۸۵۰٬۰۰۰ یا «۲٫۸۵ میلیون»)، یا /skip اگر نمی‌خواهید قیمت بدهید.")


# ---------------------------------------------------------------- shopper notifications
_FINAL = ("answered", "unavailable", "no_reply")


def _buyer_listener(session_id: str, event: dict):
    if event.get("type") != "inquiry" or not CLIENT:
        return
    v = event["inquiry"]
    if v["status"] not in _FINAL:
        return
    inq._spawn(_notify_buyer(session_id, v))


async def _notify_buyer(session_id: str, v: dict):
    con = db.connect()
    try:
        chat = _kv_get(con, f"buyer:{session_id}")
        key = f"notified:{v['id']}:{v['status']}"
        if not chat or _kv_get(con, key):
            return
        _kv_set(con, key, 1)
        a = v.get("answer") or {}
        shop = (v.get("shop") or {}).get("name", "فروشگاه")
        title = ((v.get("product") or {}).get("title") or "")[:50]
        if v["kind"] == "hold":
            txt = f"📌 {shop}: " + (f"تا ساعت {a.get('hold_until')} برایتان نگه می‌دارد. کد: {a.get('hold_code')}" if a.get("hold_accepted") else "نمی‌تواند نگه دارد.")
        elif v["kind"] == "bargain":
            txt = f"💬 {shop}: {a.get('summary') or v['label']}"
        elif v["kind"] == "arrive":
            txt = f"📍 {shop}: " + ("منتظر شماست." if v["status"] == "answered" else "الان نمی‌تواند پاسخ بدهد." if v["status"] == "unavailable" else "جواب نداد.")
        elif v["status"] == "no_reply":
            txt = f"⌛ {shop} دربارهٔ «{title}» جواب نداد. گزینه‌های دیگر در ترب‌گرد آماده است."
        else:
            txt = f"💬 {shop} دربارهٔ «{title}»: {a.get('summary') or v['label']}"
        await CLIENT.send(chat, txt)
    except Exception:
        pass
    finally:
        con.close()


async def poll_loop(client: "BaleClient | None" = None):
    """Long-poll Bale for updates forever; errors back off (a flaky messenger must never take the API down)."""
    global CLIENT
    CLIENT = client or BaleClient()
    if _buyer_listener not in inq.LISTENERS:
        inq.LISTENERS.append(_buyer_listener)
    backoff = 2
    while True:
        try:
            con = db.connect()
            off = _kv_get(con, "offset", 0)
            con.close()
            ups = await CLIENT.call("getUpdates", offset=off, timeout=25)
            for u in ups:
                try:
                    await handle_update(CLIENT, u)
                except Exception:
                    pass  # one bad update must not stall the queue
                con = db.connect(); _kv_set(con, "offset", u["update_id"] + 1); con.close()
            backoff = 2
            if not ups:
                await asyncio.sleep(0.05)  # long polling normally blocks ~25 s; never spin if a server answers instantly
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


async def check(token: str = "") -> dict:
    """Smoke test against the real Bale API: `python -m app.services.bale check`."""
    c = BaleClient(token)
    me = await c.call("getMe")
    return {"ok": True, "bot": me.get("username"), "id": me.get("id")}


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "check":
        if not TOKEN:
            sys.exit("BALE_BOT_TOKEN is not set (backend/.env)")
        try:
            print(asyncio.run(check()))
        except Exception as e:
            sys.exit(f"Bale check failed: {e}")
