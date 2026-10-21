# Design Brief for Claude Design: «همراه خرید» (working name)

> Give Claude Design this file + `screens.md` + the JSON files in `fixtures/`. All sample data is REAL data from Torob's Tehran dataset (shop names are fake in the dataset; locations and prices are real).

## 1. What this product is
A Persian, **mobile-first, RTL** web app that takes someone from *"I want wireless earbuds but I don't know which"* to *"I'm standing at the right unit, on the right floor of the right mall, and the seller has confirmed the price and stock."* It is for **in-person shopping in Tehran's bazaars and malls** (Jomhouri, Ferdowsi, Lalehzar, Baharestan, Sheikh Hadi). Hackathon judges score: Product 75, **UX 75**, Intelligence 50 → the UI is half the grade.

**Persona:** Reza, 28, on his phone in a taxi to Jomhouri. One hand. Poor signal. He wants earbuds under 3 million toman, prefers installments, and hates walking to a mall just to find the shop closed or the price different.

## 2. The 4-step journey (must be visually obvious: a step indicator or clear progress)
1. **Pick the product**: describe a need → clarifying chips → product cards → compare 2–4 models → "why this one".
2. **Find shops near me**: map + list. Shops that *have an offer for this product* are separated from shops that *only work in the category* (must ask).
3. **Compare shops**: price, how old the price is, distance, open now / closes soon, installments, warranty, mall/floor/unit.
4. **Contact & follow up**: ask 1–5 shops at once (stock, price, hours…), watch answers arrive live, auto-alternatives if a shop is out/silent, then a **visit plan**.

Chat is **not** the only path. Every flow must be doable with cards, chips, filters and buttons. Chat is a helper that can also drive the same state ("زیر ۳ میلیون" in chat moves the budget slider).

## 3. Non-negotiable UX rules (from the judging brief)
- **Explain every recommendation** ("چرا این؟") and always show the **next step** button.
- Budget, radius, area, installment, open-now must be **changeable in one tap, results update instantly**.
- **Never mix these three things** (this is a scored requirement):
  | Meaning | Visual treatment |
  |---|---|
  | **Listed price**: what the shop registered, with the date | neutral; show "ثبت‌شده ۳ روز پیش" |
  | **Seller-confirmed**: the seller answered our inquiry | green badge "تأیید شده توسط فروشنده · ۱۲ دقیقه پیش" |
  | **Unknown**: no price / no hours / no stock info | gray dashed, text "نامشخص — بپرسید" (never blank, never "0") |
- **Price freshness buckets** (`offer.freshness`): `fresh ≤7d`, `recent ≤30d`, `stale ≤90d` (amber), `very_stale >90d` (red-ish warning), `no_price`, `unknown_age`. `offer.suspicious=true` → "قیمت مشکوک، حتماً استعلام بگیرید".
- **Category-only shops** (`tier: "category_only"`): "در این دسته فعالیت دارد؛ موجودی را بپرسید". The dataset says a category alone does NOT mean the product exists.
- **Installments**: show provider chips (ترب‌پی، اسنپ‌پی، دیجی‌پی، تارا، ازکی‌وام). `confirmed_in_store=true` ("پذیرش حضوری تأییدشده") vs false ("اعلام‌شده؛ نوع پذیرش نامشخص").
- `fast_delivery` is a **tri-state**: true / false / null (unknown). Draw all three.
- **Phone numbers in this dataset are fake** → do NOT show a call button. Contacting happens through the in-app inquiry.
- Shop names are mostly fake placeholders; `name_is_verified=false` → fine to show the name but never imply it's the real brand.

## 4. Persian / RTL rules
- Full RTL; use logical CSS properties (`margin-inline-start`, etc.). Numbers: **Persian digits** in UI (۲٬۸۵۰٬۰۰۰ تومان), thousands separator «٬». Show prices as «تومان»; large ones as "۲٫۸ میلیون" with exact on tap.
- Font: **Vazirmatn** (variable). Body 16px min, line-height ≥1.7. Titles are long Persian product names → allow 2-line clamp.
- Time in 24h «۱۹:۰۰». Week starts شنبه; Friday (جمعه) is mostly closed, so show it clearly.
- Mixed LTR snippets (model names like "JB25", unit "A41") must not break the bidi layout: wrap in `<bdi>`.

## 5. Visual direction
- Friendly, trustworthy, calm, Torob-adjacent but **original** (do not copy Torob's logo/brand). Light theme first; dark theme optional.
- One strong accent color; **status semantics own the colors**: confirmed=green, stale=amber, danger/suspicious=red, unknown=gray-dashed, open=green dot, closing-soon=amber dot, closed=gray.
- Thumb-zone layout: primary actions in the bottom 40% of the screen; bottom sheets over modals; sticky bottom CTA ("استعلام از ۳ فروشگاه").
- Tap targets ≥ 44px. Contrast AA. Skeleton loaders (search ~15 ms, but LLM chat can take seconds → streaming text + tool-status line "در حال یافتن فروشگاه‌ها…").
- Every empty / error / loading / unknown state needs a designed version with good Persian microcopy (see `screens.md`).

## 6. Components to design (props mirror the API, see `fixtures/`)
`ProductCard` · `ProductCompareTable` (differing rows highlighted & first) · `ShopCard` (tier listed|category_only) · `PriceBadge` (4 freshness states + confirmed + suspicious + none) · `OpenStatusChip` (open/closing_soon/closed/unknown) · `InstallmentChips` · `MallLocator` ("پاساژ علاالدین ۲ ← طبقه ۶ ← واحد ۶۲۲", a mini floor diagram) · `FilterBar` (budget slider, radius, installment, open-now, fast-delivery, sort presets) · `LocationChip` · `ClarifyChips` · `InquiryComposer` · `InquiryTimeline` (sent → seen → answered | unavailable | no-reply) · `AlternativesSheet` · `VisitPlan` · `MapSheet` · `ChatBlockRenderer` (renders the typed blocks the agent emits) · `DataSourceNote` ("منبع: ترب · ۴۳ روز پیش").

## 7. Demo scenarios the UI must shine in
1. «یه هندزفری بی‌سیم برای ورزش زیر ۳ میلیون» → chips → 3 models → compare → shops near Jomhouri → installment filter → ask 3 shops → live answers (one price changed, one out of stock, one silent → alternatives) → visit plan.
2. Phone: «گوشی ۱۰ تا ۱۵ میلیون، قسطی».
3. «دوربین مداربسته ۴ کانال» (shop-heavy category; mall directory useful).
