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
| `?s=go` | trip line, live reroute when the main shop sold out, checklist | route on the map |
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
7. «رسیدم و خریدم» → «بله، همان قیمت».
