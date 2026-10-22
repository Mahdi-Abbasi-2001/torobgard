"use client";
// Product comparison, one flow everywhere: the picker («مقایسه با کالای دیگر»: similar products of the same category, a
// search box, the current list with ×) opens from the product page, the compare bar and the comparison table; the compare
// bar shows the list on every page (bottom of the screen on phones, a chip in the desktop top bar).
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type Product } from "@/lib/api";
import { fa, mil } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { Icon } from "./Icon";
import { Bidi, Note, Sheet, Thumb } from "./ui";

export const MAX_COMPARE = 4;
const Ctx = createContext<{ openCompare: (base?: string) => void }>({ openCompare: () => {} });
export const useCompare = () => useContext(Ctx);
export const compareHref = (ids: string[]) => `/compare?ids=${ids.slice(0, MAX_COMPARE).join(",")}`;

/** The products in the compare list (titles, images, categories), from the same cache the product page uses. */
export function useCompareItems(ids: string[]) {
  const qs = useQueries({ queries: ids.map((id) => ({ queryKey: ["product", id], queryFn: () => api.product(id), staleTime: 300_000 })) });
  return ids.map((id, i) => {
    const d = qs[i]?.data;
    return { id, p: d ? ({ ...d, image: d.image ?? d.images?.[0] ?? null } as Product) : undefined }; // details keep the photo in images[]
  });
}

/** Two closest alternatives for a one-tap comparison: same category, most shops, nearest price. */
export function pickAlternatives(base: Product | undefined, items: Product[], n = 2): Product[] {
  const ref = base?.price_median ?? base?.price_min ?? null;
  const score = (p: Product) => Math.min(p.shop_count, 10) - (ref && p.price_median ? Math.abs(Math.log(p.price_median / ref)) * 6 : 0);
  return items.filter((p) => p.shop_count > 0 && (!base?.category || p.category === base.category)).sort((a, b) => score(b) - score(a)).slice(0, n);
}

export function CompareProvider({ children }: { children: ReactNode }) {
  const { update } = useSession();
  const [base, setBase] = useState<string | null | undefined>(undefined); // undefined = closed
  // opening from a product puts that product first in the list, so «compare with…» always includes it
  const openCompare = useCallback((b?: string) => {
    if (b) update((s) => (s.compare.includes(b) ? s : { ...s, compare: [b, ...s.compare].slice(0, MAX_COMPARE) }));
    setBase(b ?? null);
  }, [update]);
  const value = useMemo(() => ({ openCompare }), [openCompare]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <CompareBar />
      {base !== undefined && <ComparePicker base={base} onClose={() => setBase(undefined)} />}
    </Ctx.Provider>
  );
}

/** Phones: a bar above the page's own bottom bar. Desktop shows the same list as a chip in the top bar (CompareChip). */
function CompareBar() {
  const path = usePathname();
  const router = useRouter();
  const { state } = useSession();
  const { openCompare } = useCompare();
  const items = useCompareItems(state.compare);
  if (!state.compare.length || path.startsWith("/compare") || path.startsWith("/seller") || path.startsWith("/login")) return null;
  const n = state.compare.length;
  return (
    <div className="cmp-bar" role="region" aria-label="فهرست مقایسه">
      <button type="button" className="cmp-bar-list" onClick={() => openCompare()} aria-label="ویرایش فهرست مقایسه">
        <span className="cmp-thumbs" aria-hidden="true">{items.map(({ id, p }) => <Thumb key={`${id}${p?.image ?? ""}`} src={p?.image} alt="" size={30} brand={p?.brand} />)}</span>
        <span className="grow" style={{ textAlign: "start" }}><b>{fa(n)} کالا</b> برای مقایسه<span className="xs faint" style={{ display: "block" }}>{n < 2 ? "یک کالای دیگر اضافه کنید" : "ویرایش فهرست"}</span></span>
      </button>
      {n < 2
        ? <button type="button" className="btn sec" onClick={() => openCompare()}><Icon n="plus" s />افزودن</button>
        : <button type="button" className="btn pri" onClick={() => router.push(compareHref(state.compare))}><Icon n="compare" s />مقایسه کن</button>}
    </div>
  );
}

/** Desktop top-bar entry to the same list. */
export function CompareChip() {
  const { state } = useSession();
  const { openCompare } = useCompare();
  if (!state.compare.length) return null;
  return (
    <button type="button" className="chip" style={{ minHeight: 40 }} onClick={() => openCompare()} aria-label={`فهرست مقایسه: ${fa(state.compare.length)} کالا`}>
      <Icon n="compare" s />مقایسه<span className="tb-cnt">{fa(state.compare.length)}</span>
    </button>
  );
}

function ComparePicker({ base, onClose }: { base: string | null; onClose: () => void }) {
  const router = useRouter();
  const { state, update, toggleCompare } = useSession();
  const ids = state.compare;
  const baseId = base ?? ids[0] ?? null;
  const items = useCompareItems(ids);
  const baseP = items.find((x) => x.id === baseId)?.p;
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const sim = useQuery({ queryKey: ["similar", baseId, 8], queryFn: () => api.similar(baseId!, 8), enabled: !!baseId });
  const found = useQuery({ queryKey: ["cmp-search", q], queryFn: () => api.search({ q, limit: 8 }), enabled: q.length >= 2 });
  const full = ids.length >= MAX_COMPARE;
  const otherCat = baseP?.category ? items.filter((x) => x.p && x.p.category !== baseP.category) : [];
  const list = q.length >= 2 ? found.data?.items ?? [] : sim.data?.items ?? [];
  const alts = pickAlternatives(baseP, sim.data?.items ?? []);
  const go = (next: string[]) => { onClose(); router.push(compareHref(next)); };

  return (
    <Sheet open onClose={onClose} label="مقایسه با کالای دیگر">
      <div className="row between"><h2>مقایسه با کالای دیگر</h2><button type="button" className="iconbtn" onClick={onClose} aria-label="بستن"><Icon n="x" /></button></div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="xs faint">فهرست مقایسه · {fa(ids.length)} از {fa(MAX_COMPARE)}</div>
        {ids.length === 0 && <span className="sm muted">هنوز کالایی انتخاب نشده.</span>}
        <div className="cmp-sel">
          {items.map(({ id, p }) => (
            <div key={id} className="cmp-sel-item">
              <Thumb key={p?.image ?? "-"} src={p?.image} alt="" size={44} brand={p?.brand} />  {/* remount once the details (and photo) load */}
              <span className="xs b cmp-clamp"><Bidi text={p?.title ?? "…"} /></span>
              <button type="button" className="cmp-x" onClick={() => toggleCompare(id)} aria-label={`حذف ${p?.title ?? ""} از مقایسه`}><Icon n="x" s /></button>
            </div>
          ))}
        </div>
        {otherCat.length > 0 && baseId && (
          <Note tone="warn" icon="alert">
            {fa(otherCat.length)} کالا از دستهٔ دیگری است؛ مشخصاتشان کمتر قابل مقایسه است.
            <button type="button" className="btn ghost" style={{ minHeight: 32, paddingInline: 6 }} onClick={() => update((s) => ({ ...s, compare: [baseId] }))}>فقط همین کالا بماند</button>
          </Note>
        )}
      </div>

      {baseId && ids.length <= 1 && alts.length >= 1 && (
        <button type="button" className="btn sec block" onClick={() => go([baseId, ...alts.map((a) => a.product_id)])}>
          <Icon n="spark" s />مقایسهٔ سریع با {fa(alts.length)} کالای مشابه
        </button>
      )}

      <div className="field search">
        <span className="sbtn" aria-hidden="true" style={{ background: "none", color: "var(--ink-3)" }}><Icon n="search" s /></span>
        <label htmlFor="cmp-q" className="sr">جستجوی کالا برای مقایسه</label>
        <input id="cmp-q" value={text} onChange={(e) => setText(e.target.value)} placeholder="جستجوی کالای دیگر…" enterKeyHint="search" />
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="sm b">{q.length >= 2 ? "نتیجهٔ جستجو" : baseP?.category ? <>مشابه در «{baseP.category}»</> : "مشابه"}</div>
        {(q.length >= 2 ? found.isLoading : sim.isLoading) && <div className="sk" style={{ height: 64, borderRadius: 14 }} />}
        {!(q.length >= 2 ? found.isLoading : sim.isLoading) && list.length === 0 && (
          <span className="sm muted">{q.length >= 2 ? "چیزی پیدا نشد." : "کالای مشابهی با فروشنده پیدا نشد؛ با جستجو اضافه کنید."}</span>
        )}
        {list.filter((p) => p.product_id !== baseId).map((p) => {
          const on = ids.includes(p.product_id);
          const diffCat = !!baseP?.category && !!p.category && p.category !== baseP.category;
          return (
            <div key={p.product_id} className="cmp-row">
              <Link href={`/p/${p.product_id}`} onClick={onClose}><Thumb src={p.image} alt="" size={52} brand={p.brand} /></Link>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="sm b cmp-clamp"><Bidi text={p.title} /></div>
                <div className="xs faint">{p.price_min != null ? `از ${mil(p.price_min)} تومان` : "قیمت نامشخص"} · {fa(p.shop_count)} فروشگاه{diffCat && <span className="tag" style={{ marginInlineStart: 6, background: "var(--warn-soft)", color: "var(--warn)" }}>دستهٔ دیگر</span>}</div>
              </div>
              <button type="button" className={`btn ${on ? "pri" : "sec"}`} style={{ minHeight: 38, paddingInline: 12 }} aria-pressed={on}
                disabled={!on && full} title={!on && full ? `حداکثر ${fa(MAX_COMPARE)} کالا` : undefined} onClick={() => toggleCompare(p.product_id)}>
                {on ? <><Icon n="check" s />اضافه شد</> : <><Icon n="plus" s />افزودن</>}
              </button>
            </div>
          );
        })}
        {full && <span className="xs faint">حداکثر {fa(MAX_COMPARE)} کالا؛ برای افزودن، یکی را از فهرست بالا حذف کنید.</span>}
      </div>

      <div className="cmp-foot">
        <button type="button" className="btn pri block" disabled={ids.length < 2} onClick={() => go(ids)}>
          <Icon n="compare" s />{ids.length < 2 ? "دست‌کم ۲ کالا انتخاب کنید" : `مقایسه کن (${fa(ids.length)} کالا)`}
        </button>
        {ids.length > 0 && <button type="button" className="btn ghost" onClick={() => update((s) => ({ ...s, compare: [] }))}>پاک کردن فهرست</button>}
      </div>
    </Sheet>
  );
}
