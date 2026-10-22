"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Product, type SearchResult } from "@/lib/api";
import { fa, mil, money } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { ProductCard } from "@/components/cards";
import { WhereToLook } from "@/components/WhereToLook";
import { SnapButton } from "@/components/SnapButton";
import { AppBar, Empty, ErrorState, OfflineBanner, Sheet, SkeletonCards, Steps } from "@/components/ui";

const NO_CAP = 999_999_999_999; // explicit "no budget" so the API ignores a budget phrase inside q
export interface SearchParams { q?: string; category?: string; brand?: string; price_max?: string }

function why(p: Product, cap: number | null) {
  const bits: string[] = [];
  if (cap && p.price_min && p.price_min <= cap) bits.push("در بودجهٔ شما");
  if (p.shop_count >= 5) bits.push(`${fa(p.shop_count)} فروشگاه دارند`);
  else if (p.shop_count === 1) bits.push("فقط ۱ فروشگاه؛ جایگزین هم ببینید");
  if (p.price_min && p.price_max && p.price_max > p.price_min * 1.3) bits.push("اختلاف قیمت بین فروشگاه‌ها زیاد است");
  return bits.join(" · ") || undefined;
}

export default function SearchView({ sp }: { sp: SearchParams }) {
  const router = useRouter();
  const { state, toggleCompare } = useSession();
  const [text, setText] = useState(sp.q ?? "");
  const [open, setOpen] = useState(false);
  const [lastQ, setLastQ] = useState(sp.q);
  if (lastQ !== sp.q) { setLastQ(sp.q); setText(sp.q ?? ""); } // URL changed (back/forward, chip): follow it

  const priceMax = sp.price_max ? Number(sp.price_max) : null;
  const params = { q: sp.q, category: sp.category, brand: sp.brand, price_max: priceMax };
  const res = useInfiniteQuery({
    queryKey: ["search", params],
    queryFn: ({ pageParam }) => api.search({ ...params, offset: pageParam, limit: 20 }),
    initialPageParam: 0,
    getNextPageParam: (last: SearchResult, all) => { const n = all.reduce((a, p) => a + p.items.length, 0); return n < last.total ? n : undefined; },
  });
  const first = res.data?.pages[0];
  const items = res.data?.pages.flatMap((p) => p.items) ?? [];
  const cap = first?.applied.price_max && first.applied.price_max < NO_CAP ? first.applied.price_max : null;

  const set = (patch: Partial<SearchParams>) => {
    const next = { ...sp, ...patch };
    const u = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => v && u.set(k, v));
    router.replace(`/search?${u.toString()}`, { scroll: false });
  };
  const nFilters = (cap ? 1 : 0) + (sp.brand ? 1 : 0) + (sp.category ? 1 : 0);

  return (
    <main className={`main ${state.compare.length ? "has-cta" : ""}`}>
      <div className="lay lay-head">
      <AppBar title="نتایج" back="/" end={<Link href={`/chat?q=${encodeURIComponent(sp.q ?? "")}`} className="iconbtn" aria-label="پرسیدن از دستیار"><Icon n="chat" /></Link>} />
      <OfflineBanner />
      <Steps at={0} />
      </div>
      <form className="pad m-only" onSubmit={(e) => { e.preventDefault(); set({ q: text.trim() || undefined, price_max: undefined }); }}>
        <div className="field search">
          <button className="sbtn" type="submit" aria-label="جستجو"><Icon n="search" s /></button>
          <label htmlFor="q" className="sr">جستجو</label>
          <input id="q" value={text} onChange={(e) => setText(e.target.value)} placeholder="نام کالا یا نیاز خود را بنویسید" enterKeyHint="search" />
          {text && <button type="button" className="iconbtn" style={{ width: 36, height: 36 }} aria-label="پاک کردن" onClick={() => setText("")}><Icon n="x" s /></button>}
          <SnapButton className="iconbtn" label="عکس از کالا: مدل و قیمت را بسنجیم" />
        </div>
      </form>
      <div className="lay lay-search">
      <aside className="dk-only filter-side" aria-label="فیلترها">
        <FilterPanel id="side" first={first} sp={sp} cap={cap} set={set} />
      </aside>
      <div className="lay lay-results">
      <div className="hscroll" style={{ paddingBlock: "10px 4px" }}>
        <button className="chip m-only" onClick={() => setOpen(true)}><Icon n="filter" s />فیلترها{nFilters ? <b>{fa(nFilters)}</b> : null}</button>
        {cap && (
          <button className="chip on" onClick={() => set({ price_max: String(NO_CAP) })} aria-label="حذف بودجه">
            بودجه: تا {mil(cap)}{first?.applied.budget_from_query && !sp.price_max && <span className="xs" style={{ opacity: .75 }}>· از متن شما</span>}<Icon n="x" s className="x" />
          </button>
        )}
        {sp.category && <button className="chip on" onClick={() => set({ category: undefined })}>{sp.category}<Icon n="x" s className="x" /></button>}
        {sp.brand && <button className="chip on" onClick={() => set({ brand: undefined })}>{sp.brand}<Icon n="x" s className="x" /></button>}
        {first?.facets.brands.slice(0, 4).filter((b) => b.name !== sp.brand).map((b) => <button key={b.name} className="chip" onClick={() => set({ brand: b.name })}>{b.name}</button>)}
      </div>

      {res.isLoading && <SkeletonCards n={5} />}
      {res.isError && <ErrorState error={res.error} retry={() => res.refetch()} />}
      {first && (
        <>
          <div className="pad row between" style={{ paddingBlock: 6 }}>
            <span className="sm muted"><b style={{ color: "var(--ink)" }}>{money(first.total)}</b> کالا{cap ? ` تا ${mil(cap)} تومان` : ""}</span>
            <span className="xs faint">فقط کالاهایی که فروشگاه دارند</span>
          </div>
          {first.total === 0 ? <NoResults sp={sp} cap={cap} set={set} /> : (
            <div className="pad stack results-grid" style={{ gap: 10 }}>
              {items.map((p) => <ProductCard key={p.product_id} p={p} why={why(p, cap)} inCompare={state.compare.includes(p.product_id)} onCompare={() => toggleCompare(p.product_id)} />)}
              {res.hasNextPage && <button className="btn sec block" onClick={() => res.fetchNextPage()} disabled={res.isFetchingNextPage}>{res.isFetchingNextPage ? <span className="spin" /> : null}نمایش بیشتر</button>}
            </div>
          )}
        </>
      )}

      {state.compare.length > 0 && (
        <div className="sticky-cta">
          <div className="row">
            <div className="sm grow"><b>{fa(state.compare.length)} کالا</b> برای مقایسه<div className="xs faint">تا ۴ کالا را کنار هم ببینید</div></div>
            <button className="btn pri" disabled={state.compare.length < 2} onClick={() => router.push(`/compare?ids=${state.compare.join(",")}`)}><Icon n="compare" s />مقایسه کن</button>
          </div>
        </div>
      )}
      </div></div>

      <Sheet open={open} onClose={() => setOpen(false)} label="فیلترها">
        <FilterPanel id="sheet" first={first} sp={sp} cap={cap} set={set} />
        <button className="btn pri block" onClick={() => setOpen(false)}>نمایش {first ? money(first.total) : ""} کالا</button>
      </Sheet>
    </main>
  );
}

/** The same filters as a bottom sheet on phones and a permanent sidebar on desktop; changes apply instantly. */
function FilterPanel({ id, first, sp, cap, set }: { id: string; first?: SearchResult; sp: SearchParams; cap: number | null; set: (p: Partial<SearchParams>) => void }) {
  return (
    <>
      <div className="row between"><h2>فیلترها</h2><button className="btn ghost" onClick={() => set({ price_max: String(NO_CAP), brand: undefined, category: undefined })}>پاک کردن همه</button></div>
      <BudgetSlider id={id} value={cap} onChange={(v) => set({ price_max: v ? String(v) : String(NO_CAP) })} />
      {first && first.facets.brands.length > 0 && (
        <div className="stack" style={{ gap: 6 }}><span className="b sm">برند</span>
          <div className="wrapr">{first.facets.brands.map((b) => <button key={b.name} className={`chip ${sp.brand === b.name ? "on" : ""}`} onClick={() => set({ brand: sp.brand === b.name ? undefined : b.name })}>{b.name} <span className="xs faint">{fa(b.count)}</span></button>)}</div></div>
      )}
      {first && first.facets.categories.length > 1 && (
        <div className="stack" style={{ gap: 6 }}><span className="b sm">دسته</span>
          <div className="wrapr">{first.facets.categories.slice(0, 8).map((c) => <button key={c.name} className={`chip ${sp.category === c.name ? "on" : ""}`} onClick={() => set({ category: sp.category === c.name ? undefined : c.name })}>{c.name} <span className="xs faint">{fa(c.count)}</span></button>)}</div></div>
      )}
      <p className="xs faint" style={{ margin: 0 }}>قسطی، باز بودن، فاصله و ارسال سریع ویژگی فروشگاه‌اند؛ در صفحهٔ فروشگاه‌های هر کالا فیلترشان کنید.</p>
    </>
  );
}

const STEPS_M = [0, 500_000, 1_000_000, 2_000_000, 3_000_000, 5_000_000, 10_000_000, 15_000_000, 20_000_000, 30_000_000, 50_000_000, 100_000_000];
function BudgetSlider({ id, value, onChange }: { id: string; value: number | null; onChange: (v: number | null) => void }) {
  const idx = value == null ? STEPS_M.length : Math.max(1, STEPS_M.findIndex((s) => s >= value));
  const start = idx === -1 ? STEPS_M.length : idx;
  const [i, setI] = useState(start);
  const [lastStart, setLastStart] = useState(start);
  if (lastStart !== start) { setLastStart(start); setI(start); }
  const v = i >= STEPS_M.length ? null : STEPS_M[i];
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="frow" style={{ minHeight: 0 }}><label htmlFor={`budget-${id}`} className="b sm">بودجه</label><span className="sm num">{v ? <>تا <b>{mil(v)}</b> تومان</> : "بدون سقف"}</span></div>
      <input id={`budget-${id}`} type="range" min={1} max={STEPS_M.length} step={1} value={i} dir="rtl"
        onChange={(e) => setI(+e.target.value)} onPointerUp={() => onChange(v)} onKeyUp={() => onChange(v)} />
      <div className="row between xs faint"><span>۵۰۰ هزار</span><span>بدون سقف</span></div>
    </div>
  );
}

function NoResults({ sp, cap, set }: { sp: SearchParams; cap: number | null; set: (p: Partial<SearchParams>) => void }) {
  const relax: { label: string; patch: Partial<SearchParams> }[] = [];
  if (cap) relax.push({ label: "بودجه را بردار", patch: { price_max: String(NO_CAP) } });
  if (sp.brand) relax.push({ label: `برند «${sp.brand}» را بردار`, patch: { brand: undefined } });
  if (sp.category) relax.push({ label: "دسته را بردار", patch: { category: undefined } });
  // The search ANDs every word, so a single extra word ("ورزشی") can empty the list: offer dropping each one
  const words = (sp.q ?? "").split(/\s+/).filter((w) => w.length > 1 && !/^(زیر|تا|کمتر|از|میلیون|هزار|تومان|تومن|[\d۰-۹٫.,]+)$/.test(w));
  if (words.length > 1) words.forEach((w) => relax.push({ label: `بدون کلمهٔ «${w}»`, patch: { q: (sp.q ?? "").split(/\s+/).filter((x) => x !== w).join(" ") } }));
  const counts = useQuery({
    queryKey: ["relax", sp],
    queryFn: () => Promise.all(relax.slice(0, 6).map((r) => api.search({ q: sp.q, category: sp.category, brand: sp.brand, price_max: sp.price_max ? +sp.price_max : null, ...Object.fromEntries(Object.entries(r.patch).map(([k, v]) => [k, k === "price_max" ? (v ? +v : null) : v])), limit: 1 }).then((x) => x.total))),
    enabled: relax.length > 0,
  });
  return (
    <div className="lay lay-noresults">
      <Empty icon="search" title={cap ? "با این بودجه چیزی پیدا نکردیم" : "چیزی پیدا نکردیم"}>
        {cap ? `با این کلمه‌ها و تا ${mil(cap)} تومان کالایی در فروشگاه‌ها ثبت نشده است.` : "کلمهٔ کوتاه‌تری بنویسید یا املای نام مدل را بررسی کنید."}
      </Empty>
      {sp.q && <WhereToLook q={sp.q} className="where-wrap" />}
      <div className="pad stack relax-list" style={{ gap: 8 }}>
        {relax.length > 0 && <span className="xs faint">یکی از این‌ها را امتحان کنید</span>}
        {(counts.data
          ? relax.slice(0, 6).map((r, i) => ({ r, n: counts.data[i] })).filter((x) => x.n > 0).sort((x, y) => y.n - x.n)
          : relax.slice(0, 6).map((r) => ({ r, n: null as number | null }))
        ).map(({ r, n }) => (
          <button key={r.label} className="card row between" style={{ padding: "12px 14px" }} onClick={() => set(r.patch)}>
            <span className="sm">{r.label}</span>
            <span className="sm b row" style={{ color: "var(--accent-ink)", gap: 4 }}>{n != null ? `${money(n)} کالا` : <span className="spin" />}<Icon n="fwd" s /></span>
          </button>
        ))}
        {counts.data && counts.data.every((n) => n === 0) && <p className="sm muted center">با برداشتن فیلترها هم چیزی پیدا نشد. نام کالا را کوتاه‌تر بنویسید.</p>}
      </div>
    </div>
  );
}
