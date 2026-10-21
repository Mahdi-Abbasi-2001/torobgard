# Torob StarCoach: In-Person Shopping Assistant. Master Plan

---

## PART 1: THE SIMPLE VERSION (read this first)

**What we're building:** A Persian, mobile-first web app ("دستیار خرید حضوری") that helps someone in Tehran go from *"I want headphones but don't know which"* to *standing in the right shop, on the right floor of the right mall, with a confirmed price*.

**How judges score us (300 points):**
| Area | Points | What wins it |
|---|---|---|
| Product | 75 | All 4 steps work end-to-end, plus the pain points from the video |
| UX/UI | 75 | Beautiful, simple, RTL, mobile. Cards and buttons, not only chat |
| Intelligence | 50 | The assistant *contacts sellers*, tracks replies, and finds alternatives when a shop is closed or out of stock |
| Deploy | 40 | Live on Liara, stable, HTTPS, never down during judging |
| Tech | 40 | Clean code, tests, good architecture, fast |
| Dataset | 20 | Use every field honestly: show what's known, what's old, what's unknown |

**The 4 steps (from the video), and what we add to each:**
1. **Pick the product.** Chat or tap chips (budget, use, brand). We compare models side by side and say *why* we recommend one.
2. **Find shops nearby.** Map and list of shops that have it, sorted by distance from you, with an "open now" badge.
3. **Compare shops.** Price, distance, hours, installments, warranty, how old the price is.
4. **Contact shops.** One button: "Ask these 3 shops if it's in stock at this price". The seller answers from a simple seller page or a **Bale bot**. Your screen updates live. If no one answers in X minutes, or the shop says "out of stock", the assistant automatically offers the next best shop.

**Our "wow" features:**
- **In-mall finder:** "Alaeddin mall → Floor 6 → Unit 622". 74% of shops have floor and unit info in their address. We parse it and show it like a directory.
- **Live seller follow-up:** in the demo, a teammate's phone acts as the seller and replies, and the user's screen updates in real time.
- **Smart visit plan:** "Go to these 2 shops in this order. Both are in the same mall. Take the metro because it's inside the traffic zone. Shop B closes at 14:00 on Thursday."
- **Installment filter:** show only shops with Torob Pay, Snapp Pay, Digipay, and similar, and say whether that was confirmed for in-store use.
- **Honesty labels:** "Price listed 3 days ago" ≠ "Seller confirmed 10 min ago" ≠ "Stock unknown".

**The workflow you described:**
1. **Here (Claude Code):** build the data pipeline, search, backend API, AI agent, seller system, and a **design brief plus realistic mock data** for Claude Design.
2. **Claude Design:** design all screens using the brief and real data samples.
3. **Back here:** plug the designed UI into the real API, polish, deploy to Liara, then record the 5-min demo.

**Timeline (team, ~2.5 weeks):** Days 1–3 foundation and design handoff → Days 4–10 build all features → Days 11–13 polish and deploy hardening → Days 14–16 demo video, freeze, buffer.

---

## PART 2: THE DETAILED PLAN

### 1. Context
Torob's StarCoach hackathon challenge: build an intelligent assistant for **in-person shopping** in Tehran's shops, malls and passages, using Torob's dataset (6,476 shops, 225,903 products, 331,506 offers). The required deliverables are a deployed product and a ~5-minute demo video. The video is mandatory, and its quality affects the score. Judges weight **Product (75) + UX (75) = 150/300**, so product thinking and UX dominate. Engineering scale comes second. Liara is the suggested host (sponsor). BoxAPI provides the LLM credits (OpenAI-compatible gateway assumed).

The project folder currently contains only `competition-brief.txt`, `competition-video-transcript.txt` and `starcoach-dataset-v16-cap300-csv.zip`. This is a greenfield project.

### 2. What the data actually looks like (profiled, and it drives the design)

**shops.csv (6,476)**: `shop_id, name, address, location_label, lat, lon, category_names[], contacts[], payment_options[], supports_fast_delivery, weekly_hours{}, instagram, website_url`
- **Names are fake for 6,364 shops, and every phone number is fake.** We can't call anyone, so the "contact seller" step must be a system we build: a seller portal and a Bale bot. Locations are real.
- **Geography is heavily concentrated:** فردوسی 3,282, شیخ هادی 1,587, بهارستان 616, then a long tail (31 labels in total). This is downtown Tehran: the electronics and lighting bazaars of Jomhouri, Lalehzar and Baharestan. These areas are **inside the Tehran traffic zone (طرح ترافیک)**, which gives us a visit-condition feature.
- **74% of addresses contain پاساژ / مجتمع / طبقه**, for example `پاساژ علاءالدین 2، طبقه 6، واحد 622`. That is enough to build the in-mall finder.
- `weekly_hours`: 4,473 shops have it. Per-day `status` ∈ {declared, closed, unsupported}, with shifts. Some data is odd (`02:00–08:00`), so we sanity-flag it. 2,003 shops have no hours, and we show "ساعت کاری ثبت نشده".
- `payment_options`: about 370 entries. Providers: ترب‌پی, اسنپ‌پی, دیجی‌پی, تارا, ازکی‌وام. The `channel` is `in_person` or `unknown`, which matches the brief's instruction to label the type of information: "confirmed in-store" vs "declared, channel unknown".
- `supports_fast_delivery`: true 1,168, false 433, null 4,875. We show all three states.
- `contacts`: phone only. Instagram exists for 22 shops and a website for 90. These are the real-named shops.
- `category_names`: 3,988 categories. Top ones: mobile phones, switches and sockets, lighting, cables, CCTV, headphones, speakers, chargers.

**offers.csv (331,506)**: `offer_id, shop_id, product_id, seller_title, description, price_toman, last_price_changed_at, warranty{description, period_months, provider}`
- Only **3,792 shops have offers**. The other ~2,700 are **category-only**. The brief says explicitly that a category alone does not mean the product is available. We show them as "ممکن است داشته باشد. بپرسید" (may have it, ask) and make them inquiry targets.
- **15,083 offers have a 0 or null price**, which we show as "قیمت ثبت نشده — استعلام بگیرید".
- Price age: most dates are Sep–Oct 2026, with a tail back to 2020. We show freshness buckets: <7 days, <30 days, older (stale warning).
- Warranty exists on 58,943 offers and is mostly free text. We parse months and provider when possible.
- **187,004 of 225,903 products have only one offer.** Exact-product shop comparison is often impossible, so we need **similar-product grouping**: same category, brand and key specs, plus title similarity. Alternatives become core, not optional.

**products.csv (225,903)**: `product_id, persian_title, brand_name (57k), model (4k), category_name (3,428), image_urls[], specs[{section,key,value}] (145k)`
- Good specs give us spec-diff comparison tables and spec-aware filters per category.

**Implication for demo scenarios:** pick categories where data is rich: **mobile phones, headphones and earbuds, chargers and accessories, CCTV cameras, lighting and chandeliers, speakers**. The video's "sneakers" example probably has thin data. Verify with queries on Day 2 and pick 3 demo scenarios with many multi-offer products.

### 3. Scoring strategy: points mapped to features

| Criterion | Must-have (to not lose points) | Differentiators (to win points) |
|---|---|---|
| **Product 75** | All 4 steps; search; compare products; nearby shops; compare shops; contact/follow-up; installment filter; budget/area filters | In-mall finder; visit-plan/route; "my shopping list" tracking page; checklist of what to ask in store |
| **UX 75** | Persian RTL, mobile-first, fast, cards/chips/filters (not chat-only), clear "why recommended" + "next step" CTA on every screen | Hybrid chat ↔ UI with shared state; bottom-sheet map; one-tap filter edits that re-rank instantly; skeleton loaders; empty and error states written in good Persian; PWA install |
| **Intelligence 50** | Clarifying questions; tool-using agent; alternatives on out-of-stock | Live seller inquiry with timeouts → automatic fallback; visit-condition awareness (open now, closes soon, Friday, traffic zone, distance); price-outlier warning; proactive "this shop closes in 40 min, go to B first" |
| **Deploy 40** | Live HTTPS URL on Liara, works on mobile | Health checks, zero-downtime redeploy, CI/CD, monitoring, LLM-down fallback, seeded DB, custom domain |
| **Tech 40** | Clean repo, README, docker-compose | Typed API (OpenAPI → TS client), tests (parsers, ranking, agent golden set), architecture diagram, latency budget |
| **Dataset 20** | Correct use of all three tables | Data-transparency badges on every fact ("منبع: ترب، ۳ روز پیش"), explicit unknowns, category-only vs listed shops distinguished |

### 4. Product design: user flows

**Global state = "Shopping Session"**: `{need, budget_min/max, location(lat/lon or chosen area), radius, must_have: [installment provider, open_now, warranty, fast_delivery], candidate_products[], shortlisted_shops[], inquiries[], visit_plan}`. Chat and UI read and write the same session, so the user can type "زیر ۱۵ میلیون" or drag the budget slider and both update the results.

**Entry (Home):** big search bar ("چی می‌خوای بخری؟") + mic (optional) + category tiles (top data-rich groups) + "location chip" (GPS / choose neighborhood / pin) + recent sessions.

**Step 1: Find the right product (needs → models)**
- The user types a free need → the LLM extracts `{category, use-case, budget, brand prefs, must-specs}`. If the request is ambiguous, it asks **one** clarifying question at a time **as tappable chips** (e.g., "برای ورزش / برای تماس کاری / گیمینگ").
- Results: product cards (image, title, brand, price range across shops, # shops in Tehran, freshest price age, a "چرا این؟" line).
- **Compare tray**: pick 2–4 → spec-diff table that highlights the differences, AI summary "برای نیاز تو B بهتره چون…", and price range per model.
- Filters: budget slider, brand, key category specs (auto-derived from the most common spec keys per category), "only shops with installments", "only open now".

**Step 2: Find shops that have it near me**
- For the chosen product(s), or its **similar-product group**: map (bottom-sheet list over map) + list sorted by a weighted score.
- Each shop card: distance/travel estimate, open-now status ("باز است · تا ۱۹:۰۰" / "بسته · فردا ۱۰:۰۰" / "ساعت نامشخص"), listed price + its age, installment badges (with in-person vs unknown), warranty, mall/floor/unit, fast-delivery state.
- Two tiers, clearly separated: **"این محصول را ثبت کرده"** (has an offer) vs **"در این دسته فعالیت دارد"** (category-only: ask first).

**Step 3: Compare shops**
- Side-by-side for 2–4 shops: price, price age, distance, open now / closes at, installment providers, warranty, same-mall grouping. Plus a **ranking explanation** ("ارزان‌ترین ولی قیمت ۴۰ روز پیش ثبت شده").
- Sort presets: cheapest / nearest / most reliable info / open now. A custom weights slider is optional.

**Step 4: Contact and follow up**
- "استعلام از فروشگاه‌ها": choose questions (موجودی؟ قیمت فعلی؟ امروز تا کی باز هستید؟ قسطی با X؟ گارانتی؟ رنگ موجود؟) → send to 1–5 shops at once.
- The **Inquiry tracker** shows a per-shop status timeline: ارسال شد → دیده شد → پاسخ داد / بی‌پاسخ (timeout) / ناموجود.
- Answers update the shop card with a **"تأیید شده توسط فروشنده · ۱۲ دقیقه پیش"** badge, which is shown separately from the listed data.
- On **no answer within N min / out of stock / closed**, the assistant pushes "۳ جایگزین نزدیک پیدا کردم" (3 nearby alternatives found) with one-tap re-inquiry.
- **Visit plan**: after confirmations, it orders the stops by geography and opening hours. It shows mall → floor → unit directions, deep links to **Neshan / Balad / Google Maps**, a transport hint (inside the traffic zone → suggest metro and name the nearest station), and an in-store checklist (check the guarantee sticker, serial, IMEI registration for phones, invoice).

**"My shopping" page (پیگیری):** all sessions, inquiries and visit plans with live status. This covers the "tracking" item in the judging criteria.

**Seller side (needed to make Step 4 real):**
- **Seller web inbox** at `/seller/{token}`: a mobile page where the seller sees inquiries and answers with big buttons (موجود است / ناموجود / قیمت: [input] / تا ساعت … باز هستیم).
- **Bale bot** (Bale is named in the brief; its Telegram-style bot API works inside Iran): sends the inquiry with inline buttons, and the seller taps to answer. A team member "is" a seller in the demo.
- **Simulated seller mode** (clearly labeled "شبیه‌سازی" in an admin/demo toggle): an LLM role-plays sellers with realistic delays and some no-replies, so the judges can try the flow on any shop themselves. **This matters because judges won't have a teammate answering.**

### 5. Intelligence design (agent)

**Pattern:** a tool-calling LLM agent (OpenAI-compatible API via BoxAPI) over **deterministic tools**. The LLM decides and explains. Tools do the retrieval and math, which keeps the numbers grounded and cheap.

**Tools (backend functions exposed to the agent):**
- `search_products(query, category?, brand?, price_min?, price_max?, specs?)`
- `get_product(product_id)` / `compare_products(ids[])` → spec diff + price stats
- `similar_products(product_id, k)` → same category + brand/spec/title similarity
- `find_shops(product_ids[], location, radius_km, filters{installment, open_now, warranty, fast_delivery}, include_category_only)`
- `shop_details(shop_id)` (hours parsed, mall/floor/unit, payments with channel)
- `check_visit_conditions(shop_ids[], when)` → open/closing soon/closed, traffic-zone flag, Friday/holiday
- `send_inquiry(shop_ids[], product_id, questions[])` / `get_inquiries(session_id)`
- `plan_visit(shop_ids[], start_location, start_time)` → ordered route + legs
- `update_session(filters…)`: lets chat edit the shared UI state

**Agent output = text + typed UI blocks**, streamed over SSE: `product_cards`, `comparison_table`, `shop_list`, `map`, `chips` (clarifying options), `inquiry_status`, `visit_plan`, `alert`. The frontend renders each block as a real component (generative UI), so the chat is never a wall of text.

**Smart behaviors to implement explicitly:**
1. **Clarify before recommending:** at most one question per turn, as chips. It skips the question when the query is already specific.
2. **Explain every recommendation**, using data fields (price, age, distance, warranty).
3. **Inquiry state machine** + scheduler: `pending → delivered → answered | no_reply(timeout) | unavailable`. A timeout or a negative answer triggers `similar_products` + `find_shops` → proactive alternatives message.
4. **Visit-condition awareness:** current Tehran time (Asia/Tehran), shop hours, closing soon (<60 min), Friday closures, distance, and the traffic-zone polygon for downtown shops.
5. **Price sanity:** flag an offer that is >X% below its product's median ("احتمالاً قیمت قدیمی/اشتباه؛ استعلام بگیرید"), and flag stale prices.
6. **Graceful degradation:** if the LLM is down or slow, the structured search UI still works fully, with rule-based query parsing for budget numbers, brand dictionary and category match.
7. **Persian normalization everywhere:** ي→ی, ك→ک, Persian/Arabic digits, ZWNJ, and "میلیون/تومن" budget parsing ("زیر ۱۵ تومن" → 15,000,000).

**Agent quality:** keep a golden set of about 25 Persian test queries (in-category, ambiguous, budget, installment, closed-shop) with expected tool calls and filters. Run it in CI or before each deploy.

### 6. Architecture & stack

```
[Next.js 15 PWA (RTL, Tailwind, Vazirmatn)] ──REST + SSE──> [FastAPI (Python 3.12)]
        ▲ UI from Claude Design                                   │
        │                                                         ├─ Postgres (shops, products, offers, sessions, inquiries)
 [Seller web inbox /seller/{token}]                               ├─ Meilisearch (Persian product search, facets, typo tolerance)
 [Bale Bot webhook] ───────────────────────────────────────────>  ├─ Agent (OpenAI-compatible client → BoxAPI)
                                                                  └─ Scheduler (APScheduler: inquiry timeouts, sim sellers)
```
- **Backend:** FastAPI + SQLAlchemy 2 (async) + Alembic + Pydantic v2. Pub/sub for live updates via Postgres LISTEN/NOTIFY (no Redis needed). Add Redis later only if required.
- **Search:** Meilisearch for products (searchable: title, brand, category, model, flattened key specs; filterable: category, brand, price_min, has_offer, shop_count). Optional phase 2: hybrid semantic search via embeddings (BoxAPI embeddings if available, else a local multilingual-e5-small computed offline).
- **Geo:** 6.5k shops is small, so we use Haversine in SQL/Python with a bounding-box prefilter. PostGIS is unnecessary.
- **Maps:** Neshan Web SDK (works well in Iran) or Leaflet + an Iranian tile provider. Navigation goes through deep links to Neshan, Balad and Google Maps.
- **Frontend:** Next.js App Router + TypeScript + Tailwind (RTL logical properties) + TanStack Query, plus an **OpenAPI-generated TS client** so the Claude Design UI binds to typed endpoints. PWA manifest.
- **LLM:** a single `llm.py` adapter (base_url, model, key from env). Models are configurable: a strong one for the agent and a cheap one for extraction and simulated sellers. Responses for identical extraction prompts are cached.
- **Identity:** anonymous session (uuid in a cookie/localStorage), with no login friction. Sellers authenticate by a magic token.

**Repo layout (to create):**
```
torob/
  data/raw/                 # zip extracted here (gitignored)
  backend/
    app/api/                # routers: search, products, shops, sessions, chat(SSE), inquiries, seller, bale
    app/agent/              # llm adapter, tools, prompts (Persian), block schemas
    app/services/           # ranking, hours, geo, mall_parser, price_stats, similarity, visit_plan, traffic_zone
    app/ingest/             # csv → postgres + meilisearch, normalization, derived fields
    app/models/             # SQLAlchemy models
    tests/                  # parsers, hours, ranking, agent golden set
  frontend/                 # Next.js (UI from Claude Design lands here)
  docs/
    design-brief.md         # for Claude Design
    screens.md              # screen inventory + states
    api-contract.md + openapi.json
    fixtures/*.json         # REAL samples from dataset for design mocks
  docker-compose.yml        # postgres, meilisearch, backend, frontend
  README.md
```

### 7. Data pipeline (`backend/app/ingest/`)
1. Extract the zip, stream the CSVs (products.csv is 196 MB, so stream it and don't load it all), and parse JSON fields. Treat the literal `null` as None.
2. Normalize Persian text (shared `normalize_fa()` used by both ingest and query).
3. **Derived shop fields:** `mall_name`, `floor`, `unit` (regex over address: پاساژ|مجتمع|بازار|ساختمان …, طبقه (number or word: اول/دوم/همکف/زیرزمین/منفی), واحد|پلاک|غرفه); `hours` normalized + `hours_quality` flag; `installment_providers[{name, channel}]`; `in_traffic_zone` (point-in-polygon); `is_real_name` (has instagram/website); `has_offers`.
4. **Derived offer fields:** `price_known`, `price_age_days` (relative to now, displayed as an actual date too), `freshness_bucket`, `warranty_months` parsed, `is_price_outlier` vs product median.
5. **Derived product fields:** `offer_count`, `price_min/median/max`, `top_specs` (flattened key→value for the category's most common keys), `similarity_group_key`.
6. Index into Meilisearch. Build a category → top-level group mapping for the home tiles.
7. Make it idempotent, runnable as a one-off job on Liara, and finish in under ~10 min.

### 8. API contract (first draft; the frontend and Claude Design depend on it)
- `GET /api/search/products?q=&category=&brand=&price_min=&price_max=&specs=&page=`
- `GET /api/products/{id}` · `POST /api/products/compare {ids}` · `GET /api/products/{id}/similar`
- `GET /api/products/{id}/shops?lat=&lon=&radius=&open_now=&installment=&sort=`
- `GET /api/shops/{id}` · `GET /api/shops/near?lat=&lon=&category=`
- `GET /api/malls/{mall}`: shops in a mall grouped by floor
- `POST /api/sessions` · `GET/PATCH /api/sessions/{id}` (filters, shortlist)
- `POST /api/chat/{session_id}` → **SSE** stream of `{type: text|block|tool_status|done}`
- `POST /api/inquiries {session_id, shop_ids, product_id, questions}` · `GET /api/sessions/{id}/inquiries` · `GET /api/sessions/{id}/events` (SSE live updates)
- `POST /api/visit-plan {shop_ids, start, time}`
- Seller: `GET /api/seller/{token}/inquiries` · `POST /api/seller/{token}/inquiries/{id}/answer`
- Bale: `POST /api/bale/webhook`
- Ops: `GET /healthz`, `GET /readyz`

### 9. Claude Design handoff package (produced here before you go to Claude Design)
- `docs/design-brief.md`: product summary, persona ("someone going to Jomhouri to buy earphones on a phone"), brand tone (friendly, trustworthy, Torob-adjacent but original), RTL/Persian rules, Vazirmatn type scale, color tokens incl. **status semantics** (confirmed=green, listed=neutral, stale=amber, unknown=gray-dashed), and accessibility.
- `docs/screens.md`, the screen inventory with all states (loading/empty/error/unknown data):
  1. Home / need input + location chip
  2. Chat + inline blocks (product cards, chips, comparison, shop list, inquiry status, visit plan)
  3. Product results + filters sheet
  4. Product detail (specs, price range, offers)
  5. Product compare table
  6. Shops for product: map + list bottom sheet
  7. Shop detail (hours, mall/floor/unit, payments, offers, "data source" panel)
  8. Shop compare
  9. Inquiry composer + tracker timeline
  10. Alternatives suggestion sheet
  11. Visit plan / route
  12. My shopping (tracking)
  13. Seller inbox (seller-side mobile page)
  14. Mall directory view (floor by floor)
- `docs/fixtures/*.json`: **real** records from the dataset for each component (a shop with full hours plus a mall address, a shop with no hours, a category-only shop, an offer with price 0, a stale offer, installment in-person vs unknown) so the designs cover the real edge cases.
- A component list with props that mirror the API schemas, so the design-to-code mapping is 1:1.

### 10. Deployment on Liara (40 pts)
- Apps: `backend` (Docker), `frontend` (Next.js platform), `meilisearch` (Docker + persistent disk), Liara **PostgreSQL** managed DB. All on HTTPS with a custom domain if available.
- Ingest runs as a one-off command (`liara shell` / a job), followed by a smoke test.
- Health checks (`/healthz`, `/readyz` that checks DB, Meili and LLM reachability), restart policy, and env vars for secrets (BoxAPI key, Bale token, Neshan key).
- CI: GitHub Actions → tests → `liara deploy` for each app. Tag releases.
- Resilience: LLM timeout + fallback, rate limit on `/chat`, cache hot queries, and a "demo mode" toggle for the simulated sellers.
- Monitoring: structured logs, an uptime ping (e.g., a cron that hits `/healthz`), and an error page in Persian.
- **Freeze a stable release 2 days before the deadline. Don't redeploy during judging.**

### 11. Team split (small team; adjust names)
- **A: Data & Search & Core API:** ingest, normalization, mall parser, hours, ranking, Meilisearch, shops/products endpoints, tests.
- **B: Agent & Follow-up:** LLM adapter, tools, prompts, SSE chat, inquiry state machine, scheduler, seller inbox API, Bale bot, simulated sellers, golden-set evals.
- **C: Frontend & Design:** Claude Design iterations, Next.js integration, generative-UI blocks, map, PWA, polish, demo video.
- Everyone: deploy hardening and the demo rehearsal.

### 12. Timeline (~16 days)
| Days | Milestone |
|---|---|
| 1–2 | Repo + docker-compose; ingest pipeline; data profiling notebook; pick 3 demo scenarios; API contract v1 + OpenAPI; fixtures exported |
| 3 | **Design handoff:** design-brief, screens, fixtures → Claude Design starts. Backend search + product/shop endpoints live locally. First Liara deploy of a skeleton (deploy early!) |
| 4–7 | Agent with tools + SSE blocks; product compare; shops-near-me ranking; hours/open-now; installment filter; mall parser; inquiry system + seller inbox |
| 6–9 | Bring the Claude Design UI into Next.js screen by screen; wire it to the real API |
| 8–10 | Bale bot; timeouts → alternatives; visit plan + traffic-zone + deep links; My Shopping tracker; simulated sellers |
| 11–13 | UX polish (empty/loading/error/unknown states), performance, golden-set evals, README + architecture diagram, deploy hardening, CI |
| 14 | Feature freeze, final deploy, full rehearsal on a real phone |
| 15 | Record the demo video (two devices: user + seller) |
| 16 | Buffer and submission |

### 13. Demo video (~5 min, it affects the score)
1. **0:00–0:30:** Problem: stale prices, can't find the shop in the mall, closed shops, no installments.
2. **0:30–1:30 Step 1:** "یه هندزفری بی‌سیم برای ورزش می‌خوام، زیر ۳ میلیون" → chips clarification → compare 3 models → why B.
3. **1:30–2:30 Steps 2–3:** map near Enghelab/Jomhouri → toggle "قسطی با اسنپ‌پی" + "الان باز" → compare 3 shops (price age, hours, warranty).
4. **2:30–3:45 Step 4 (the wow):** ask 3 shops → the **second phone (seller, via Bale)** answers "موجود، ۲,۷۵۰,۰۰۰" → live badge flips to confirmed; another shop times out or says out of stock → alternatives appear automatically.
5. **3:45–4:30:** Visit plan: mall → floor 4 → unit 412, metro hint (traffic zone), "shop B closes 14:00 Thursday" warning, in-store checklist.
6. **4:30–5:00:** Data honesty labels, the live Liara URL, architecture in one slide, close.
Record on a real phone (screen recording) with a clear Persian voiceover.

### 14. Verification
- `docker compose up` runs the whole stack locally and ingest finishes. Row counts match (6,476 / 225,903 / 331,506).
- Unit tests: `normalize_fa`, budget parser, mall/floor/unit parser (on 50 hand-labeled addresses, ≥90% accuracy), hours parser (open-now at given times incl. closed/unsupported/missing), ranking, price outlier.
- API tests for each endpoint. SSE chat test with a mocked LLM.
- Agent golden set (~25 Persian queries) passes; manually review the explanations.
- E2E (Playwright, mobile viewport): the full 4-step flow and the inquiry → seller answer → live update → timeout → alternatives flow.
- On Liara: hit the health endpoints, run the full flow on a real Android and iPhone, and check Lighthouse mobile ≥90 for performance and accessibility.

### 15. Risks & mitigations
| Risk | Mitigation |
|---|---|
| BoxAPI latency or outage | Timeouts, cheap model for extraction, cached results, full non-LLM structured UI path |
| Thin data for chosen demo category | Pick the scenarios on Day 2 by data density |
| Most products have only one shop | Similar-product groups + category-only "ask them" tier |
| Judges can't act as seller | Simulated seller mode, clearly labeled |
| Map tiles slow in Iran | Neshan SDK; list-first layout with map as an optional sheet |
| Claude Design ↔ code drift | Fixtures + component props mirroring API schemas; integrate screen by screen |
| Liara resource limits (Meilisearch RAM with 226k docs) | Index only the needed fields and trim the specs; test the plan size on Day 3 |

### 16. First thing we build after approval (the "base" before Claude Design)
1. Scaffold the repo + docker-compose (Postgres, Meilisearch, FastAPI, Next.js skeleton).
2. Ingest pipeline + derived fields + tests.
3. Search/product/shop endpoints + OpenAPI.
4. Export fixtures + write `docs/design-brief.md` and `docs/screens.md` → **you take these to Claude Design.**
5. In parallel: the agent and the inquiry/seller system.
