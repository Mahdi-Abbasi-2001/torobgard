# ترب‌گرد — frontend

Next.js 16 (App Router) + TypeScript + TanStack Query. Mobile-first Persian RTL UI built from the design canvas
(`design/canvas.src.html`, published as an artifact). Styles are plain CSS with the design's tokens in
`src/app/globals.css` (light + dark), Vazirmatn is self-hosted via `@fontsource-variable/vazirmatn`.

## Run
```bash
cd frontend
npm install
cp .env.example .env.local   # API_URL defaults to http://localhost:8765
npm run dev                  # http://localhost:3000 (backend must be running)
```
Production: `npm run build && npm start`.

## How it talks to the backend
- The browser calls `/api/*` on the same origin. `src/app/api/[...path]/route.ts` proxies it to `API_URL` **at runtime** (so Liara can set it without a rebuild).
- `src/app/api/sessions/[id]/events/route.ts` streams the live-update SSE through untouched. The generic rewrite
  gzips responses, which buffers events until the connection closes; keep this route.
- The anonymous session id lives in `localStorage` and is mirrored to `PUT /api/sessions/{id}` (location, filters, shortlist).

## Screens (routes)
| Route | Screen |
|---|---|
| `/` | Home: need input, examples, location sheet (GPS or area), recent inquiries, categories, malls |
| `/search?q=` | Results + filter sheet (budget, brand, category); budget parsed from text is a removable chip; empty state suggests relaxations with counts |
| `/p/[id]` | Product detail: price range to scale, why-this, specs, single-shop warning + similar |
| `/compare?ids=` | Compare 2–4 products, differing rows first, «نامشخص» for missing cells |
| `/p/[id]/shops` | Shops for product: schematic map + list, listed vs category-only, filters (installment, open now, radius, fast delivery, sort), zero-result relax suggestions, pick ≤5 |
| `/p/[id]/shops/compare?ids=` | Compare shops, sort presets, why-ranked, tie note |
| `/p/[id]/ask` | Inquiry composer (questions from `/api/inquiry-questions`, note, deadline, preview) |
| `/track?product=` | Live tracker (SSE): confirmed price vs listed diff + toast, alternatives sheet opens on unavailable / no reply |
| `/plan?product=` | Visit plan built on the client from answers: order by closing time, late/tight warnings, reorder, traffic zone, deep links, checklist |
| `/mine` | My shopping: inquiries grouped by product, active / finished |
| `/shop/[id]` | Shop detail: mall locator, weekly hours (today highlighted, suspicious hours flagged), installments, offers, no call button |
| `/mall/[key]` | Mall directory: floor accordion, search, category filter, «طبقه نامشخص» group |
| `/seller/[shop]/[token]` | Seller inbox (open the link from `GET /api/demo/seller-link/{shop}`): big buttons, listed price prefilled, 403/409 states |
| `/chat` | Streaming agent (`/api/chat`, blocks → components); falls back to simple search + banner when the LLM is unavailable |

## Not wired yet (backend pieces missing)
- `/api/visit-plan` now exists; `src/views/PlanView.tsx` still computes the plan client-side. Swap when convenient.
- `src/app/api/chat/[id]/route.ts` streams the chat SSE through untouched (same gzip/buffering reason as the events route); keep it.
- Map tiles: `src/components/ShopMap.tsx` draws a schematic map (no tile server). Neshan/Leaflet can replace the background.
- Demo banner on the tracker shows unless `NEXT_PUBLIC_DEMO_MODE=0`.
