# Step 4: contact shops and follow up

The mentor's point: shops rarely update stock and prices, so step 4 is where the assistant earns its points. This is what
it does now, where it lives, and how to demo it.

## What the shopper gets

| # | Feature | Where |
|---|---------|-------|
| 1 | **Three separate badges** on every shop/offer: listed-price age · seller confirmation (with age) · stock | `TruthRow` in `components/honesty.tsx`; shop cards, shop page |
| 2 | **Shared confirmation layer**: every seller answer, visit report and phone report is stored per shop + product and shown to *all* users. It fades: fresh < 2 h, aging < 6 h, then "ask again" | `services/verify.py`, table `confirmations` |
| 3 | **Shop reliability**: reply rate, typical reply time, how often the confirmed price matched the listing, visit outcomes. Shown on cards/shop page and used in ranking | `verify.reliability`, `ReliabilityLine` |
| 4 | **Price drift**: a confirmed price compared with the listed one and with nearby shops ("2 shops nearby are cheaper") | `verify.drift`, stored on the answer |
| 5 | **Real conversation**: sellers can answer in free text; the LLM (rules as fallback) reads it, and the assistant asks a follow-up when something is missing or unclear (max 2) | `services/converse.py`, `inquiries.seller_says` |
| 6 | **Product-specific questions** from the specs (registered phone? exact RAM/storage? sizes? original or copy?) | `converse.suggest_questions`, Ask screen |
| 7 | **Ask in waves**: best 2 shops first, the next only when one says no / stays silent, stop when one confirms; closed shops are skipped (asked about tomorrow when nothing is open) | `services/campaigns.py`, "موجی و هوشمند" on the Ask screen |
| 8 | **Alternatives**: the seller is asked "do you have something similar?" when out of stock; optional auto-ask of the next shops | `seller_says`, `campaigns.on_inquiry_change`, tracker toggle |
| 9 | **Hold**: "keep one for me until 20:00", the seller accepts and the shopper gets a 4-digit code (shown in the tracker and the plan) | `inquiries.request_hold` |
| 10 | **Re-check before leaving**: "on my way, still there?"; a "sold out" drops the shop from the plan and opens alternatives | `inquiries.request_recheck` |
| 11 | **Notifications**: system notification when the tab is in the background, in-app toast on other pages, or Bale messages via `/follow` | `LiveNotifier.tsx`, `bale._buyer_listener` |
| 12 | **After the visit**: "was it there, at that price?" feeds confirmations and reliability | `VisitReport`, `POST /api/reports` |
| 13 | **Seller one-tap**: «همان قیمت ثبت‌شده», «فردا موجود می‌شود», free text, voice notes (Bale, transcribed) | `SellerView.tsx`, `bale.py` |
| 14 | **"Update my listing too"**: the confirmed price replaces the dataset price for everyone, which goes after the root cause, not just the symptom | table `listing_updates`, seller page + Bale button |
| 15 | **Shops with no messenger**: call script + "what did they say?" form → stored as a phone report | `CallScript` |
| 17 | **Simulated sellers type like people**, sometimes vaguely, so the same parser and follow-ups run; replies are labelled «نمایشی» | `inquiries._simulate` |

## Demo script (about 90 s)
1. Product page → «استعلام» → with no shops picked: **«بگذار ترب‌گرد انتخاب کند و موجی بپرسد»**. The tracker shows the wave
   banner, who is asked and *why*, and the product-specific question.
2. One shop says «تموم کردیم، مشابهش X رو داریم» → card turns red, the seller's suggestion and alternatives appear, the next
   shop is asked automatically. Another says «بله داریم» → the assistant asks the price → «۱۱۸ تومن» → confirmed price, +x %
   vs listed, cheaper-nearby note. Open «گفتگو با فروشنده» to show the actual messages.
3. «برایم نگه دارید» → 20:00 → code appears. Plan page shows the code; «راه افتادم؛ دوباره بپرس».
4. Back on the shop list: the shop now shows «تأیید فروشنده: ۱ دقیقه پیش · موجودی: تأییدشده» for *every* user.
5. Second phone as the seller (`/api/demo/seller-link/{shop_id}`, or Bale): type a vague answer and show the follow-up, tick
   «قیمت ثبت‌شده‌ام در ترب هم به‌روز شود».

For a live seller on the second phone, list that shop in `TOROB_LIVE_SHOPS` (or link it in Bale) so it is not simulated.

## Settings
- `TOROB_SIM_USE_LLM=0`: simulated sellers' texts are parsed by rules only (saves tokens; real sellers still use the LLM).
- `LLM_STT_MODEL` (default `whisper-1`): transcription model for Bale voice notes (provider must support `/audio/transcriptions`).
- `python -m app.services.bale check` (from `backend/`): checks `BALE_BOT_TOKEN` against the real Bale API (`getMe`).

## Tests
`backend/tests/test_step4.py`: parser cases, follow-ups, web free-text conversation, shared layer, listing updates,
hold/recheck/plan, visit reports, reliability, waves, auto-alternatives, custom questions, Bale free text + hold buttons,
shopper `/follow`. All run with the LLM switched off.
