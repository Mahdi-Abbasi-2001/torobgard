# UX: one mission, start to counter

User-facing Persian calls a mission «خرید» (not «مأموریت»), the duel «مقایسه», a backup shop «جایگزین»: written as a shopper would say it, not translated from the English concept names.

Design source: the Design canvas «Torob-Gard concept directions» (pages: Demo flow, Sheets & coverage, Desktop). The mentor's point: a chat
thread (Torob Chat) or a result list (Torob Joo) is not a product. Ours is a **mission**: one errand with a certainty level that rises
as sellers answer. Every screen shows the same four-stage rail and the same **ripeness meter** (listed → asked → confirmed → held).

## Model
- `lib/mission.tsx`: a mission lives on the device (localStorage `tg-missions-v1`): sentence, product words, need, budget, conditions,
  place / when / how, chosen product, duel state, shortlist, priority. Progress is **derived** from the server (`lib/useMissionStatus.ts`):
  inquiries, holds, re-checks, the waves campaign. Stage = decide (no product) · find (product) · confirm (questions sent) · go (held / on my way) · done.
- `POST /api/mission/parse`: sentence → slots (rules, no LLM; unread slots stay null and show as «open»).

## Screens (`views/`, `components/mission/`)
| Route | Phone | Desktop (≥ 960 px) |
|---|---|---|
| `/` start | one sentence; slots it understood, each editable; photo / browse side doors | + missions in progress and live feed |
| `/m/[id]` `?s=decide` | duel: two models, rows for the need, winner per row, verdict; details in a sheet | details docked on the left |
| `?s=find` / `compare` | map (price pins, one-trip hub, time scrubber, travel mode) then shortlist (priority chips, list/table) | map in the middle, shortlist left |
| `?s=confirm` | rows ripen as sellers answer; conversation, hold, re-check, alternatives, call script | pins ripen on the map |
| `?s=go` | trip line, live reroute when the main shop sold out, last 100 metres (floor, neighbours, card to show a guard), «I'm here» (tap only: tells the seller, with the hold code), counter photo check, checklist | route on the map |
| `?s=done` | «was it there, same price?» one tap; summary | |
| `/missions` | active / finished, latest answer, notifications | |

Sheets: product, shop, mall, conditions (where / when / how / budget), ask, conversation, hold, alternatives, call, assistant, photo check (`/snap`).
Old links (`/p/[id]/shops`, `/ask`, `/track`, `/plan`, `/mine`, chat proposals) redirect into the matching mission (`views/GoMission.tsx`).

## Demo script (≈ 2 min)
1. Type «هندزفری گردنی برای ورزش، تا ۳٫۵ میلیون، نزدیک علاالدین، عصر»: the slots fill in. Start.
2. Duel: tap a need chip, «گزینهٔ بعدی», read the verdict; open details. «… را انتخاب می‌کنم».
3. Map: drag the time scrubber (shops open/close), switch to taxi, tap the hub (mall floors). «مقایسهٔ این فروشگاه‌ها», change priority.
4. «از فروشنده‌ها بپرس»: rows ripen, one says no and the next is asked. Open «گفتگو و جزئیات».
5. «برایم نگه دار»: code appears. «شروع مسیر».
6. Trip: «نمایشی: اگر تمام شده بود» (demo only; `NEXT_PUBLIC_DEMO_MODE=0` hides it, backend `TOROB_DEMO_SOLDOUT=0` ignores it): the line reroutes.
7. In the mall: «آخرین ۱۰۰ متر» card, then «رسیدم؛ به فروشنده خبر بده» (the seller's second phone shows «مشتری رسید» with the code; the simulated seller answers by itself).
8. «بررسی کالا با عکس، قبل از پرداخت»: photo of the item; model and tag price are checked against what the seller confirmed, a mismatch can be reported.
9. «خریدم؛ ثبت نتیجه» → «بله، همان قیمت».

## The model is the brain, not a chat window

The assistant never appears as a conversation you have to live in. It works behind the screens and surfaces as small, checkable cards:

| Where | What the model does | What keeps it honest |
|---|---|---|
| **Start** (`IntakeAgent`) | Reads the sentence, fills every slot (item, need, budget band, place, time, mode), asks at most two tap-able questions about what is truly open. You watch each check live: "looking in the catalogue…", "reading the price range…". | Tools read the real data (`search_catalog`, `price_spread`, `lookup_place`, `category_needs`). Budget and place options come from the data, never from the model; questions about slots already found are dropped; two rounds at most; hand-set slots are pinned and never changed. |
| **Find** (`AdviceCard`) | Looks at the real candidate shops (walk time, open at arrival, price vs the fair range, reply rate, last confirmation) and picks the 2–4 worth asking first, one reason each, plus one thing to watch on the trip. | Picks must be real candidates; shops that just said "not available" or are shut at arrival are removed first; the shortlist is only replaced while you haven't touched it. |
| **Decide** | "Ask Torob-Gard to help" when a search finds nothing exact reruns the intake agent with that context. | Same guard rails as Start. |
| **Compare / Confirm / Go** | Duel verdict for your need, seller replies parsed into price / stock / hours, a counter photo check. | Already grounded in specs, prices, and what the seller actually confirmed. |

Every model call has a rules fallback with the same response shape (`engine` / `source` = `rules`), so the product works without a key and the card says so.
