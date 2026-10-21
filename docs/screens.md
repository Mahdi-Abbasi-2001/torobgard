# Screen inventory & states

Real sample JSON for each is in `fixtures/`. API base: `/api` (see `openapi.json`). All screens mobile-first (375px), RTL.

| # | Screen | Purpose | Main data (fixture) | Key states to design |
|---|---|---|---|---|
| 1 | **Home** | Describe a need, pick location, jump to category/mall | `top_categories`, `malls` | first-run, location denied (choose area manually), recent sessions, offline |
| 2 | **Chat + inline blocks** | Conversational helper; blocks are real components | SSE blocks: `product_cards`, `comparison_table`, `shop_list`, `chips`, `inquiry_status`, `visit_plan`, `alert` | streaming, tool-status line, LLM down → "جستجوی ساده" fallback banner |
| 3 | **Product results** | Cards + filter sheet | `search_results` (has `facets`, `applied.budget_from_query`) | loading skeleton, no results (suggest removing filters/similar), budget parsed from text shown as removable chip |
| 4 | **Product detail** | Specs, price range, shop count | `product_detail` | no specs, no image, single shop only → "فقط ۱ فروشگاه، جایگزین‌ها را ببینید" |
| 5 | **Compare products** | 2–4 models; differing rows first | `product_compare`, `similar_products` | missing spec cell = "نامشخص", AI "برای شما کدام بهتر است" summary |
| 6 | **Shops for product** (map + list) | Step 2/3 | `shops_for_product`, `shops_for_product_installment_only` | two sections: listed vs category-only; zero results with filters → relax-filter suggestions; map tiles slow → list-first |
| 7 | **Shop detail** | Everything about a shop | `shop_full_hours_in_mall`, `shop_no_hours`, `shop_suspicious_hours`, `shop_no_mall_street_only`, `shop_real_name_with_website`, `shop_category_only_no_offers` | weekly hours table with today highlighted; "ساعت ثبت نشده"; hours that look wrong ("ساعت‌ها ممکن است دقیق نباشد"); `DataSourceNote` |
| 8 | **Compare shops** | 2–4 shops side by side + "why ranked" | cards from `shops_for_product` | sort presets (best/price/distance/freshness), tie handling |
| 9 | **Inquiry composer** | Choose questions → send to ≤5 shops | `GET /api/inquiry-questions` | max 5 shops; note field; sending state |
| 10 | **Inquiry tracker** | Live status per shop (SSE `/sessions/{id}/events`) | `inquiries_all_states` | sent, delivered, answered (green confirmed price vs listed price diff), unavailable, no_reply (timeout) |
| 11 | **Alternatives sheet** | Auto-appears on unavailable / no_reply | `inquiries_all_states` → `alternatives` | `same_product` vs `similar_product` (show the different product clearly) |
| 12 | **Visit plan** | Ordered stops, mall→floor→unit, timing warnings, deep links | `visit_plan_SPEC_not_yet_implemented` | shop closes before you arrive, same-mall grouping, traffic-zone tip, in-store checklist |
| 13 | **My shopping** | All sessions/inquiries/plans with live status | sessions + inquiries | empty, many sessions |
| 14 | **Seller inbox** (separate, seller-side mobile page) | Seller answers with big buttons | `GET /api/seller/{shop}/{token}/inquiries` | موجود / ناموجود / قیمت / ساعت; answered, already-answered (409), invalid link (403) |
| 15 | **Mall directory** | Floor-by-floor shop list | `mall_directory`, `malls` | floor "نامشخص" group, 263-shop mall needs search/collapse |

## Microcopy needed (Persian)
Empty search · no shops near you · all shops closed now · price very old · suspicious price · seller silent (timeout) · out of stock → alternatives · location permission ask/denied · slow network · generic error · simulated-seller banner ("پاسخ‌ها شبیه‌سازی‌شده‌اند — حالت نمایشی").

## Interaction notes
- Filters never reload the page; results re-rank with a subtle animation.
- Inquiry timeline updates **live** without refresh; show a gentle highlight on change and a toast when a price differs from the listed one ("قیمت واقعی ۸٪ بیشتر از قیمت ثبت‌شده است").
- Chat and UI share state; a chat message that changes a filter must visibly update the filter chip.
