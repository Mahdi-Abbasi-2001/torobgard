# Desktop redesign brief for «ترب‌گرد»

**Rule #1: the mobile design stays exactly as it is.** Mobile (≤ 640 px) is what the competition brief asks for and what the demo
video shows. Desktop is an additional, intentional layout for judges/users who open the live link on a laptop. Do not change any
mobile spacing, components or behaviour; every desktop change must live behind a `min-width` breakpoint.

## Where things are
- Running app: `frontend/` (Next.js, plain CSS tokens in `frontend/src/app/globals.css`, screens in `frontend/src/views/*`,
  shared pieces in `frontend/src/components/*`). Dev server: http://localhost:3000 (backend :8765).
- Existing design sources: `design/canvas.src.html` (15 mobile screens), `docs/design-brief.md`, `docs/screens.md`, real data in `docs/fixtures/`.
- Today on desktop the app is a centred phone-width column on an empty page (that is the problem to solve).

## Breakpoints (suggested)
| Width | Layout |
|---|---|
| ≤ 640 | Mobile: unchanged (bottom nav, single column, bottom sheets) |
| 641 to 959 | Tablet: same as mobile with a wider, centred column and larger tap-friendly cards (no new patterns) |
| ≥ 960 | Desktop: top navigation bar, multi-pane layouts, sheets become side panels/popovers, content max-width ~1280 |
| ≥ 1440 | Wide desktop: same as desktop with more breathing room, never stretched edge to edge |

## Principles
1. **RTL first.** Primary pane on the right, secondary (filters/map/detail) on the left. Use logical CSS properties.
2. **Same product, same steps.** Keep the 4-step journey visible (انتخاب کالا ← فروشگاه‌ها ← مقایسه ← استعلام و بازدید), as a horizontal stepper in the top bar area.
3. **Use the width to reduce clicks:** show list and detail together, filters as a permanent sidebar, map beside the list.
4. **Honesty rules still apply everywhere** (listed vs seller-confirmed vs unknown; price age; «تأییدنشده» labels; category-only shops separate). Desktop must not hide them.
5. **Keep the brand:** same tokens, light and dark themes, Vazirmatn, the existing component look. No Torob logo/colours copied.
6. **Pointer + keyboard:** hover states, visible focus rings, keyboard-reachable everything, comfortable 14-16 px body text, no tap-only affordances.

## Screen-by-screen desktop intent
| Screen | Desktop layout idea |
|---|---|
| Shell | Top bar: logo, search field, location chip, step indicator, links (گفتگو، خریدهای من), theme toggle. Replaces the bottom nav. |
| Home | Hero with the big need box + example chips; below: category grid (4-6 columns), malls row, recent inquiries. |
| Search results | Left: results grid (2-3 columns of product cards); right sidebar: permanent filters (budget slider, brand, category) instead of the bottom sheet; relaxation suggestions inline. |
| Product detail | Two columns: gallery + price range / why-this + review card (right); specs table + similar products (left). Sticky action bar becomes a sticky side card. |
| Compare products | Wide comparison table with sticky first column and differing rows highlighted. |
| Shops for product | **Key screen:** list on the right (listed and category-only sections), large map on the left filling the height; hover on a card highlights its pin; filters as a top toolbar; selection tray (≤ 5) as a sticky side panel with the «استعلام» button. |
| Compare shops | Side-by-side columns (up to 4) with the why-ranked row. |
| Inquiry composer + tracker | Split view: tracker timeline cards on the right, selected inquiry details + alternatives panel on the left (no modal sheet); live updates keep working. |
| Visit plan | Stops timeline on the right, map route on the left, checklist and deep links below. |
| Chat | Two panes: conversation on the right; a results panel on the left that shows the cards/blocks the agent produces (products, shops, review, where-to-look, inquiry proposal) so the chat stays short. |
| Shop detail / Mall directory | Two columns; mall directory gets floor tabs plus search. |
| My shopping | Table-like list with status filters. |
| Seller inbox | Stays a simple narrow centred page (it is opened on a phone or small window). Include the optional «Bale connect» box. |

## Blocks added since the original design (must be designed for desktop and mobile consistency)
- **Where to look («کجا بگردم؟»)**: mall/area cards with counts, distance, floors, Neshan/Balad/Google buttons, a low-confidence note, and an «اطلاعات عمومی (تأییدنشده)» note with a maps-search link.
- **Short review («نقد کوتاه»)**: pros/cons each with the spec evidence line, in-shop tips, unverified reputation note.
- **Shop links**: Instagram / website chips; seller listing title + seller note on shop cards.
- **Bale connect box** on the seller page (copyable `/link …` command).
- Real data for all of these: `docs/fixtures/` (add new fixtures if you need more) or call the local API.

## Deliverables
1. Desktop (and tablet) versions of the screens above, added to `design/canvas.src.html` (rerun `design/build.py`), keeping mobile frames untouched.
2. Then implement in `frontend/` **CSS-first**: media queries and layout wrappers inside the existing components, not a second copy of each screen. Add an app shell that swaps the bottom nav for the top bar at ≥ 960 px.
3. Verify: mobile screenshots before/after must be identical; run `npx tsc --noEmit`, `npx eslint src`, `npm run build`; test at 375, 768, 1280 and 1536 px in light and dark themes.
