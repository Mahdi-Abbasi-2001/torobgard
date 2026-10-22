# Bale seller channel (optional)

Mentor said real contact channels are helpful if done well (mock is fine). This lets a real person, e.g. a teammate playing a
shop on a second phone, answer inquiries from the Bale messenger instead of the web page. Simulated sellers keep working for every
shop that is NOT linked.

## Setup (once)
1. In Bale, talk to **@botfather**, create a bot, and copy its token (looks like `123456789:abcd…`).
2. Put it in `backend/.env` (never commit it): `BALE_BOT_TOKEN=<token>` and optionally `BALE_BOT_USERNAME=<bot username>`.
3. Restart the backend. It long-polls `https://tapi.bale.ai` (no public URL or webhook needed), so it works locally and on Liara.
   On Liara set the same variables with `liara env set` (Iran-hosted servers can reach Bale).

## Using it
1. Open the shop's seller page (`GET /api/demo/seller-link/{shop_id}` gives the link). With Bale enabled it shows a box with a
   `/link <shop_id> <token>` command: copy it and send it to the bot. The token is the same HMAC as the seller link, so only someone holding
   the link can claim the shop.
2. Buyer inquiries for that shop now arrive in Bale with one-tap buttons: **✅ همان قیمت ثبت‌شده · ✏️ قیمت جدید · ❌ ناموجود است ·
   ⏰ فردا موجود می‌شود** (waiting inquiries are pushed on linking). Holds and rechecks get their own yes/no buttons.
3. «قیمت جدید» makes the bot ask for the price (`۲٬۸۵۰٬۰۰۰`, `2.85 میلیون`, or `/skip`). After a new price the bot offers
   «قیمت ثبت‌شده‌ی شما در ترب هم … شود؟», which updates the shop's listed price for everyone.
4. Sellers can also just **type** («داریم ولی مشکیش تموم شده، ۲ و ۸۵۰») or send a **voice note** (transcribed). The text is parsed
   like any free-text answer; if something is missing the bot asks a follow-up in the same chat. Replying to a specific bot
   message targets that inquiry; otherwise the newest waiting one.
5. Shoppers can get answers in Bale too: the tracker shows a `/follow <session> <token>` command (`/unfollow` to stop).

## Safety
- A chat can only answer inquiries of shops it linked with a valid token.
- Updates are acknowledged with a stored offset, so a restart never replays old messages.
- A failing Bale API only slows this channel down (exponential backoff); the rest of the app is unaffected.

Check a real token with `python -m app.services.bale check` (from `backend/`).

Tested against a fake Bale server (`backend/tests/test_bale.py`): linking with wrong/right token, push with buttons, price prompt,
unavailable, bad price, skip, foreign chat rejected, and the polling loop's offset handling. **Not yet tried against the real Bale
service** (needs a token).
