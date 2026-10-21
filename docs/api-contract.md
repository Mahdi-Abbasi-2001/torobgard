# API contract (v0.1): implemented

Interactive docs: run the backend, open `/docs`. Machine-readable: `docs/openapi.json`.

| Method & path | Notes |
|---|---|
| `GET /api/search/products?q=&category=&brand=&price_min=&price_max=&has_shops=&limit=&offset=` | Persian FTS (prefix, AND). Budget phrases inside `q` («زیر ۳ میلیون») are parsed → `applied`. Returns `items`, `total`, `facets{categories,brands}` |
| `GET /api/products/{id}` | + specs, images |
| `POST /api/products/compare {ids:[2-4]}` | spec rows, differing first |
| `GET /api/products/{id}/similar` | same category, price band, title/brand overlap |
| `GET /api/products/{id}/shops?lat&lon&radius_km&installment&provider&open_now&fast_delivery&price_max&include_category_only&sort=best\|price\|distance\|freshness` | `listed[]` (has `offer`) + `category_only[]` + `counts`. Default location: Jomhouri/Hafez |
| `GET /api/shops/{id}` | weekly hours, offers, payments |
| `GET /api/malls`, `GET /api/malls/{mall_key}` | floor-grouped directory |
| `GET /api/categories/top` | home tiles |
| `PUT/GET /api/sessions/{id}` | shared UI/chat state (location, filters, shortlist) |
| `GET /api/inquiry-questions` · `POST /api/inquiries` | up to 5 shops; status flow sent→delivered→answered\|unavailable\|no_reply |
| `GET /api/sessions/{id}/inquiries` | each failed inquiry includes `alternatives` |
| `GET /api/sessions/{id}/events` | **SSE** live inquiry updates |
| `GET /api/seller/{shop}/{token}/inquiries` · `POST …/{inquiry}/answer` | seller side (HMAC token) |
| `GET /api/demo/seller-link/{shop}` | demo helper: open on a 2nd phone to play the seller |
| `GET /healthz`, `/readyz` | ops |

Env: `TOROB_DB`, `TOROB_SECRET`, `TOROB_INQUIRY_TIMEOUT_S` (default 300), `TOROB_SIMULATE_SELLERS` (default 1), `TOROB_LIVE_SHOPS` (shop ids answered by real people, never simulated).

## Added in v0.2
| Method & path | Notes |
|---|---|
| `POST /api/chat/{session_id}` `{message}` | **SSE** agent stream. Events: `text{delta}`, `tool_status{text}`, `block{block}`, `degraded{reason}` (LLM down → rule-based fallback), `error`, `done`. Blocks: `product_cards`, `comparison_table`, `shop_list`, `chips`, `inquiry_proposal` (nothing is sent; user confirms in the composer), `inquiry_status`. History is kept server-side per session. 20 msgs/min/session |
| `GET /api/chat-status` | `{llm_configured, model, base_url}` |
| `POST /api/visit-plan` `{session_id, product_id?, shop_ids?, lat?, lon?, order?}` | Ordered stops from sellers' "available" answers (+ optional unconfirmed shops): arrival times, late/tight warnings, same-mall, traffic-zone tip, deep links, checklist |

Search is now forgiving: filler words are dropped, an empty exact match relaxes to a ranked partial match (`applied.relaxed=true`), and products whose *category* starts with a query word rank first («گوشی» → phones before phone batteries).

LLM config (`backend/.env`, gitignored; see `.env.example`): `OPENAI_API_KEY` (or `LLM_API_KEY`), `LLM_BASE_URL` (default OpenAI; set to BoxAPI's OpenAI-compatible URL later), `LLM_MODEL` (default `gpt-4o-mini`).

## Added in v0.3 (mentor guidance)
| Method & path | Notes |
|---|---|
| `GET /api/where-to-look?q=&category=&lat=&lon=&hint=` | Malls/areas where shops of that category concentrate (dataset shop locations), `confidence` high/medium/low/none, map links; `hint` adds a Google Maps search link |
| `GET /api/products/{id}/review` | Grounded short review: pros/cons each cite a real spec (`spec_key`/`spec_value`), in-shop tips, optional `reputation` (general knowledge, `verified:false`). Cached per product; daily cap `TOROB_REVIEW_DAILY_CAP` |
| chat blocks | new `location_widget` and `review`; agent tools `where_to_look`, `product_review` |
| shop cards | `instagram` is now `{handle, profile_url}`; offers expose `seller_title` and `description` |
| Bale channel | optional, see `docs/BALE.md` |

## Not built yet
Bale bot webhook · frontend `PlanView` still computes the plan client-side (swap to `/api/visit-plan`).
