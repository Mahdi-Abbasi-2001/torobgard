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

> The step-by-step pages below (`/p/[id]/shops`, `/ask`, `/track`, `/plan`, `/mine`) are now redirects into missions; see `docs/UX.md`.

## Screens (routes)
| Route | Screen |
|---|---|
| `/` | Home: need input, examples, location sheet (GPS or area), recent inquiries, categories, malls |
| `/search?q=` | Results + filter sheet (budget, brand, category); budget parsed from text is a removable chip; empty state suggests relaxations with counts |
| `/p/[id]` | Product detail: price range to scale, why-this, specs, single-shop warning + similar |
| `/compare?ids=` | Compare 2–4 products, differing rows first, «نامشخص» for missing cells |
| `/p/[id]/shops` | Shops for product: street map + list, listed vs category-only, filters (installment, open now, radius, fast delivery, sort), zero-result relax suggestions, pick ≤5 |
| `/p/[id]/shops/compare?ids=` | Compare shops, sort presets, why-ranked, tie note |
| `/p/[id]/ask` | Inquiry composer (questions from `/api/inquiry-questions`, note, deadline, preview) |
| `/track?product=` | Live tracker (SSE): confirmed price vs listed diff + toast, alternatives sheet opens on unavailable / no reply |
| `/plan?product=` | Visit plan built on the client from answers: order by closing time, late/tight warnings, reorder, traffic zone, deep links, checklist |
| `/mine` | My shopping: inquiries grouped by product, active / finished |
| `/shop/[id]` | Shop detail: mall locator, weekly hours (today highlighted, suspicious hours flagged), installments, offers, no call button |
| `/mall/[key]` | Mall directory: floor accordion, search, category filter, «طبقه نامشخص» group |
| `/seller/[shop]/[token]` | Seller inbox (open the link from `GET /api/demo/seller-link/{shop}`): big buttons, listed price prefilled, 403/409 states |
| `/login` | Optional account: sign in / sign up (username + password). Entry points: desktop top bar, account card on «خریدهای من». Signing out starts a fresh anonymous session |
| `/snap` | Photo of a product in a shop: what was read (editable), «همین است؟» candidates, price check against listed prices nearby, cheaper shops + one-tap inquiry. Camera buttons: Home need box, desktop top bar, phone search field |
| `/chat` | Streaming agent (`/api/chat`, blocks → components); falls back to simple search + banner when the LLM is unavailable |

## Desktop and tablet (design/canvas.src.html, sections D and T)
- Phones (≤ 640 px) are untouched. Tablet (641–959) only widens the column to 640 px. Desktop (≥ 960) is a CSS layer at the end of
  `src/app/globals.css`.
- Layout wrappers in the views use `className="lay lay-…"`. Below 960 px `.lay` is `display: contents`, so the wrapper draws nothing
  and the phone layout is pixel-identical; on desktop each wrapper becomes a grid or column. `.dk-only` parts are hidden on phones,
  `.m-only` parts are hidden on desktop.
- `src/components/TopBar.tsx` replaces the bottom nav on desktop (search, location, گفتگو / خریدهای من, light/dark toggle stored in
  `localStorage["tg-theme"]`). `useIsDesktop()` (`src/lib/media.ts`) is used only where JS must differ: the large map in
  `ShopMap.tsx`, the tracker's side panel instead of the alternatives sheet, and the mall's floor tabs.
- Before changing any view, check phones stay identical: screenshot the routes at 375 px before and after and diff them.

## Not wired yet (backend pieces missing)
- `/api/visit-plan` now exists; `src/views/PlanView.tsx` still computes the plan client-side. Swap when convenient.
- `src/app/api/chat/[id]/route.ts` streams the chat SSE through untouched (same gzip/buffering reason as the events route); keep it.
- Map: `src/components/LeafletMap.tsx` (loaded client-side by `ShopMap.tsx`): Leaflet with OpenStreetMap's standard tiles (no key; attribution shown; darkened by a CSS filter in dark mode). Price pins group when they overlap; walking-time rings around the user. CARTO basemaps now need an API key, so they aren't used.
- Demo banner on the tracker shows unless `NEXT_PUBLIC_DEMO_MODE=0`.
