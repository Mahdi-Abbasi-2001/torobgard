# Steps 1–3: choose the product, find shops near me, compare shops

From the video: step 1 helps the shopper work out which product/model they need (compare products and prices against
what matters to them); step 2 finds shops that have it near the shopper's location or area; step 3 compares those shops
(price, distance, opening hours …). The brief adds: the user must be able to change area, budget and purchase conditions
easily and see the result; it must be clear *why* something is recommended and what the next step is; unknowns shown
as unknown. Scoring: Product 75 · UX 75 · Intelligence 50 · Dataset 20.

## Step 1: choose the product
| Feature | Why it scores | Where |
|---|---|---|
| **Need presets per category** («باتری قوی», «حذف نویز», «گیمینگ»…) → spec constraints; results re-rank by fit and each card shows ✓/✗/? per constraint with the product's real value | Intelligence + "why recommended" | `discover.need_presets` (LLM-proposed from the category's real spec keys, keys validated, cached; rules for phones/headphones; always «اقتصادی», «در دسترس‌ترین»), `GET /api/category-presets`, search `prefs` |
| **Purchase conditions at product level**: «نزدیک من», «فروشندهٔ قسطی», «باز وقتی می‌روم» | Brief: change conditions, see result | search `near_only / installment_only / open_only` |
| **Availability on every result card**: shops within 15 min walk, open, with installments | Product + Dataset | `discover.availability`, `near` on items |
| **Spec filters** per category (frequent keys and values) | UX | `GET /api/spec-facets`, search `spec=key=value` |
| **Variants of the same model** (128 vs 256 GB …) with price difference and nearby shops | Product (187k products have one offer) | `discover.variants`, product page, shops page when few shops |
| **Fair price range** (IQR of listings, outliers removed, freshness) | Dataset + honesty | `discover.fair_price`, product + shops pages |
| **Compare: winner per spec row** (only when units match) + each model's strengths | UX | `discover.compare_insights` |
| **"Which is better for me?" verdict** with the shopper's need, grounded in the compared specs/prices (LLM; rules fallback) | Intelligence | `POST /api/products/compare/verdict` |

## Step 2: find shops near me
| Feature | Where |
|---|---|
| **Real areas from the dataset** (27 areas with shop counts), search by name, **pin on a map**, GPS | `GET /api/areas`, `LocationSheet`, `PinMap` |
| **"When are you going?"** (now / in an hour / evening / tomorrow / exact time): open-closed judged *at arrival*, everywhere | `discover.arrival_time`, `when` on shops/search/insights/compare, `WhenChip` |
| **Travel by mode**: walk / taxi / car (car warns about the traffic zone) | `discover.travel`, `travel` on shop cards |
| **Best place to go**: the mall/area where several listing shops cluster (one trip, several shops), with directions | `discover.zones`, `ZonesCard` |
| **Listing red flags** from the seller's own text: used, stock/open-box, copy, not registered, regional version, on order, no warranty | `discover.offer_flags`, `FlagChips` |
| **Priority-weighted ranking** (balanced / price / near / trust / now) | `find_shops(weights=…)`, sort sheet |
| Per-offer **fair-price verdict** («منصفانه», «گران‌تر از بیشتر فروشگاه‌ها», «خیلی ارزان؛ شاید…») | `discover.price_verdict` |

## Step 3: compare shops
| Feature | Where |
|---|---|
| **Priorities** re-rank the columns; **score breakdown bars** show why | `GET /api/products/{id}/shops/compare`, `ScoreBars` |
| **Winner per row**: price (confirmed beats listed), freshness, arrival, open at arrival, trust, warranty | `discover.compare_shops` |
| New rows: confirmation & reliability (from step 4), listing red flags, travel by mode, fair price | `CompareShopsView` |
| **Verdict per priority**: cheapest (with the caveat if its price is old), nearest, open when you arrive, most trustworthy info | `verdict` |
| **One trip** note when several are in the same mall; add/remove shops in place | `one_trip`, add sheet |

The chat agent's `find_shops` tool takes `when` and `priority`, and returns listing warnings, travel minutes, best places
to go and the typical price.

## Demo script (≈ 2 min)
1. Search «گوشی سامسونگ» → tap the preset «باتری قوی» → cards re-rank, each shows «✓ ظرفیت باتری: ۵۰۰۰» and
   «۲۳ فروشگاه تا ۱۵ دقیقه پیاده». Toggle «فروشندهٔ قسطی» → only products with an installment seller remain.
2. Open A56 → fair price range, the 128 GB variant 13 % cheaper with 17 shops nearby → «مقایسه» → green winners per row,
   type «عکاسی و بازی» → verdict with reasons and the tradeoff.
3. Shops → «کی می‌روید؟» → «فردا صبح» + «تاکسی»: opening is judged for tomorrow, times are by taxi. «بهترین جا برای رفتن»
   shows the mall with 8 shops; one card warns «نسخهٔ منطقه‌ای خاص / سفارشی» from the seller's own text.
4. Pick 4 → «مقایسه» → priority «قیمت» vs «همین الان»: columns re-order; summary names the best per priority and notes
   that 3 are in one mall.
