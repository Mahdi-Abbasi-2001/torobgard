"""Bale messenger channel for sellers (Telegram-compatible Bot API, https://docs.bale.ai).

A seller links a shop to their Bale chat with `/link <shop_id> <token>` (the token is the HMAC from the seller link, so only
someone who holds that link can claim the shop). Inquiries for linked shops are pushed to the chat with inline buttons;
tapping «موجود است» asks for the price; the answer flows into the same inquiry/SSE pipeline as the web inbox.
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


def is_linked(con, shop_id: str) -> bool:
    return con.execute("SELECT 1 FROM bale_links WHERE shop_id=?", (shop_id,)).fetchone() is not None


def link_command(shop_id: str) -> str:
    return f"/link {shop_id} {inq.shop_token(shop_id)}"


HELP = ("سلام! من ربات استعلام ترب‌گرد هستم.\nبرای اینکه پرسش‌های خریداران برای یک فروشگاه به همین گفتگو بیاید، دستور اتصال را "
        "از صفحه‌ی فروشنده کپی کنید و بفرستید:\n/link <شناسه‌ی فروشگاه> <کد>\n\nوقتی استعلامی بیاید، با دکمه‌ها جواب بدهید.")


def _inquiry_text(con, iid: str) -> str:
    v = inq.view(con, iid)
    price = None
    if v["product"]:
        r = con.execute("SELECT MIN(price) FROM offers WHERE shop_id=? AND product_id=?", (v["shop"]["shop_id"], v["product"]["product_id"])).fetchone()
        price = r[0]
    lines = ["📩 استعلام جدید", f"کالا: {v['product']['title'] if v['product'] else '—'}", f"فروشگاه: {v['shop']['name']}", "سؤال‌ها:"]
    lines += [f"• {q['text']}" for q in v["questions"]]
    if v["note"]:
        lines.append(f"توضیح خریدار: {v['note']}")
    if price:
        lines.append(f"(قیمت ثبت‌شده‌ی شما در ترب: {price:,} تومان)")
    return "\n".join(lines)


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
        await client.send(link["chat_id"], _inquiry_text(con, iid),
                          [[("✅ موجود است", f"a:{iid}:1"), ("❌ ناموجود است", f"a:{iid}:0")]])
        inq.mark_delivered(con, iid)
        inq.publish(inq.view(con, iid)["session_id"], {"type": "inquiry", "inquiry": inq.view(con, iid)})
        return True
    finally:
        con.close()


async def handle_update(client: "BaleClient", upd: dict):
    con = db.connect()
    try:
        if "callback_query" in upd:
            await _on_callback(con, client, upd["callback_query"])
        elif "message" in upd and upd["message"].get("text"):
            await _on_message(con, client, upd["message"])
    finally:
        con.close()


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
    pending = _kv_get(con, f"await_price:{chat}")
    if pending:
        if text.startswith("/skip"):
            price = None
        else:
            price = parse_price(text)
            if price is None:
                return await client.send(chat, "قیمت را به‌صورت عدد بفرستید (مثلاً ۲٬۸۵۰٬۰۰۰ یا «۲٫۸۵ میلیون»)، یا /skip.")
        con.execute("DELETE FROM bale_kv WHERE k=?", (f"await_price:{chat}",)); con.commit()
        v = inq.answer(con, pending, True, price=price, message="پاسخ از طریق بله")
        return await client.send(chat, "✅ پاسخ ثبت شد؛ خریدار همین الان می‌بیند." if v else "این استعلام قبلاً پاسخ داده شده است.")
    await client.send(chat, "برای شروع /start را بفرستید.")


async def _on_callback(con, client, cb):
    chat, data = str(cb["message"]["chat"]["id"]), cb.get("data", "")
    try:
        await client.call("answerCallbackQuery", callback_query_id=cb["id"])
    except BaleError:
        pass
    m = re.fullmatch(r"a:(inq_[0-9a-f]+):([01])", data)
    if not m:
        return
    iid, yes = m.group(1), m.group(2) == "1"
    r = con.execute("SELECT i.shop_id FROM inquiries i JOIN bale_links b ON b.shop_id=i.shop_id WHERE i.id=? AND b.chat_id=?", (iid, chat)).fetchone()
    if not r:
        return await client.send(chat, "این استعلام متعلق به فروشگاه‌های متصل به این گفتگو نیست.")
    if not yes:
        v = inq.answer(con, iid, False, message="پاسخ از طریق بله")
        return await client.send(chat, "✅ ثبت شد: ناموجود." if v else "این استعلام قبلاً پاسخ داده شده است.")
    cur = con.execute("SELECT status FROM inquiries WHERE id=?", (iid,)).fetchone()
    if cur["status"] in ("answered", "unavailable"):
        return await client.send(chat, "این استعلام قبلاً پاسخ داده شده است.")
    _kv_set(con, f"await_price:{chat}", iid)
    await client.send(chat, "قیمت نهایی را به تومان بفرستید (مثلاً ۲٬۸۵۰٬۰۰۰ یا «۲٫۸۵ میلیون»)، یا /skip اگر نمی‌خواهید قیمت بدهید.")


async def poll_loop(client: "BaleClient | None" = None):
    """Long-poll Bale for updates forever; errors back off (a flaky messenger must never take the API down)."""
    global CLIENT
    CLIENT = client or BaleClient()
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
