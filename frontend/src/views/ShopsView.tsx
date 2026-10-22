"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, type ShopFilters } from "@/lib/api";
import { fa, mil } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { ProductMini, ShopCard } from "@/components/cards";
import { ShopMap } from "@/components/ShopMap";
import { WhereToLook } from "@/components/WhereToLook";
import { AppBar, Empty, ErrorState, Note, OfflineBanner, Seg, Sheet, SkeletonCards, Steps } from "@/components/ui";

const RADII: [number | null, string][] = [[0.5, "۵۰۰ متر"], [1, "۱ کیلومتر"], [3, "۳ کیلومتر"], [null, "همه"]];
const SORTS: [NonNullable<ShopFilters["sort"]>, string][] = [["best", "مناسب‌ترین"], ["price", "ارزان‌ترین"], ["distance", "نزدیک‌ترین"], ["freshness", "تازه‌ترین قیمت"]];

export default function ShopsView({ id }: { id: string }) {
  const router = useRouter();
  const { state, update, togglePick, setPicks, ready } = useSession();
  const f = state.filters;
  const [view, setView] = useState<"map" | "list">("map");
  const [sheet, setSheet] = useState(false);
  const [catMore, setCatMore] = useState(false);
  const [tab, setTab] = useState<0 | 1>(0);
  const [warn, setWarn] = useState("");
  const [hov, setHov] = useState<string | null>(null);
  const catRef = useRef<HTMLDivElement>(null);

  const p = useQuery({ queryKey: ["product", id], queryFn: () => api.product(id) });
  const q = useQuery({
    queryKey: ["pshops", id, state.place.lat, state.place.lon, f],
    queryFn: () => api.productShops(id, state.place, f, 40),
    placeholderData: keepPreviousData, enabled: ready,
  });
  const picks = state.picks[id];
  const d = q.data;

  // Pre-pick the top three open shops the first time this product's shops load
  useEffect(() => {
    if (d && picks === undefined) setPicks(id, d.listed.filter((s) => s.open.state !== "closed").slice(0, 3).map((s) => s.shop_id));
  }, [d, picks, id, setPicks]);

  const setF = (patch: Partial<ShopFilters>) => update((s) => ({ ...s, filters: { ...s.filters, ...patch } }));
  const pick = (sid: string) => { if (!togglePick(id, sid)) { setWarn("حداکثر ۵ فروشگاه. برای افزودن، یکی را بردارید."); setTimeout(() => setWarn(""), 2500); } };
  const chosen = picks ?? [];
  const active = [f.installment, f.open_now, f.fast_delivery, f.radius_km != null].filter(Boolean).length;
  const flashKey = JSON.stringify(f);

  return (
    <main className="main has-cta shops-page">
      <div className="lay lay-head">
      <AppBar title="فروشگاه‌های نزدیک" sub={`نزدیک ${state.place.label}`} end={
        <button className="iconbtn m-only" aria-label={view === "map" ? "نمایش فهرست" : "نمایش نقشه"} onClick={() => setView(view === "map" ? "list" : "map")}><Icon n={view === "map" ? "list" : "map"} /></button>} />
      <OfflineBanner />
      <Steps at={1} />
      </div>
      <div className="lay lay-shops">
      {p.data && <div className="pad shops-prod"><ProductMini p={p.data} sub={d ? `${fa(d.counts.listed)} فروشگاه${p.data.price_min ? ` · از ${mil(p.data.price_min)} تومان` : ""}` : "…"} /></div>}
      <div className="shops-spacer" style={{ height: 10 }} />
      {d && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 0} className={tab === 0 ? "on" : ""} onClick={() => { setTab(0); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Icon n="store" s />این کالا را دارند <span className="cnt">{fa(d.counts.listed)}</span></button>
          <button role="tab" aria-selected={tab === 1} className={tab === 1 ? "on" : ""} onClick={() => { setTab(1); catRef.current?.scrollIntoView({ behavior: "smooth" }); }}><Icon n="q" s />فقط در این دسته <span className="cnt">{fa(d.counts.category_only)}</span></button>
        </div>
      )}
      <div className="hscroll shops-chips" style={{ paddingBlock: 10 }}>
        <button className={`chip ${f.installment ? "on" : ""}`} aria-pressed={!!f.installment} onClick={() => setF({ installment: !f.installment })}><Icon n={f.installment ? "check" : "card"} s />قسطی</button>
        <button className={`chip ${f.open_now ? "on" : ""}`} aria-pressed={!!f.open_now} onClick={() => setF({ open_now: !f.open_now })}>{f.open_now && <Icon n="check" s />}باز است الان</button>
        <button className={`chip ${f.radius_km != null ? "on" : ""}`} onClick={() => setSheet(true)}>{f.radius_km != null ? `تا ${RADII.find((r) => r[0] === f.radius_km)?.[1]}` : "فاصله: همه"}</button>
        <button className={`chip ${f.fast_delivery ? "on" : ""}`} aria-pressed={!!f.fast_delivery} onClick={() => setF({ fast_delivery: !f.fast_delivery })}>{f.fast_delivery && <Icon n="check" s />}ارسال سریع</button>
        <button className="chip" onClick={() => setSheet(true)}><Icon n="sort" s />{SORTS.find((s) => s[0] === (f.sort ?? "best"))?.[1]}</button>
      </div>

      {q.isLoading && <SkeletonCards n={4} />}
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {d && d.listed.length + d.category_only.length > 0 && (
        <ShopMap origin={state.place} listed={d.listed} cat={d.category_only.slice(0, 12)} selected={chosen} onPick={pick}
          hover={hov} onHover={setHov} className={view === "map" ? undefined : "m-hide"} />
      )}
      {d && (
        <div className="stack shops-list" style={{ gap: 10, paddingTop: 12, opacity: q.isFetching ? .6 : 1, transition: "opacity .2s" }}>
          {d.listed.length === 0 ? (
            <ZeroListed id={id} f={f} setF={setF} catCount={d.counts.category_only} />
          ) : (
            <>
              <div className="pad">
                <div className="h4"><Icon n="store" s />این کالا را ثبت کرده‌اند <span className="n">{fa(d.listed.length)} از {fa(d.counts.listed)}</span></div>
                <p className="lede">{f.installment ? "فقط فروشگاه‌هایی که قسط اعلام کرده‌اند. " : ""}قیمت ثبت‌شده توسط خود فروشگاه؛ تاریخ هر قیمت کنارش است.</p>
              </div>
              {d.listed.every((s) => s.open.state === "closed") && <div className="pad"><Note tone="unk" icon="clock">همهٔ این فروشگاه‌ها الان بسته‌اند. استعلام را حالا بفرستید تا وقتی باز شدند جواب بگیرید.</Note></div>}
              <div className="pad stack" style={{ gap: 10 }} key={flashKey}>
                {d.listed.map((s) => <ShopCard key={s.shop_id} s={s} selected={chosen.includes(s.shop_id)} onSelect={() => pick(s.shop_id)} href={`/shop/${s.shop_id}?product=${id}`} flash={q.isPlaceholderData === false && active > 0} hovered={hov === s.shop_id} onHover={setHov} />)}
              </div>
            </>
          )}
          {d.category_only.length > 0 && (
            <>
              <div className="divider" />
              <div className="pad" ref={catRef} style={{ scrollMarginTop: 70 }}>
                <div className="h4" style={{ color: "var(--ink-2)" }}><Icon n="q" s />فقط در این دسته فعالیت دارند <span className="n">{fa(d.counts.category_only)}</span></div>
                <p className="lede">این فروشگاه‌ها در همین دسته کالا می‌فروشند، اما این مدل را ثبت نکرده‌اند. موجودی را باید بپرسید.</p>
              </div>
              <div className="pad stack" style={{ gap: 10 }}>
                {d.category_only.slice(0, catMore ? 20 : 4).map((s) => <ShopCard key={s.shop_id} s={s} selected={chosen.includes(s.shop_id)} onSelect={() => pick(s.shop_id)} hovered={hov === s.shop_id} onHover={setHov} />)}
                {!catMore && d.category_only.length > 4 && <button className="btn sec block" onClick={() => setCatMore(true)}>نمایش فروشگاه‌های بیشتر این دسته</button>}
              </div>
            </>
          )}
        </div>
      )}

      </div>
      {warn && <div className="toast" role="status"><Icon n="alert" />{warn}</div>}
      <div className="sticky-cta">
        {chosen.length > 0 && d && (
          <div className="dk-only">
            <div className="b sm">{fa(chosen.length)} فروشگاه برای استعلام <span className="faint" style={{ fontWeight: 500 }}>· تا ۵</span></div>
            <div className="tray-chips" style={{ marginTop: 6 }}>
              {chosen.map((cid) => { const s = [...d.listed, ...d.category_only].find((x) => x.shop_id === cid); return s ? (
                <button key={cid} type="button" className="chip on" style={{ minHeight: 32 }} onClick={() => pick(cid)} onMouseEnter={() => setHov(cid)} onMouseLeave={() => setHov(null)} aria-label={`حذف ${s.name}`}>{s.name}<Icon n="x" s className="x" /></button>
              ) : null; })}
            </div>
          </div>
        )}
        <div className="row">
          {chosen.length >= 2 && <Link className="btn sec" href={`/p/${id}/shops/compare?ids=${chosen.join(",")}`}><Icon n="compare" s />مقایسه</Link>}
          <button className="btn pri grow" disabled={!chosen.length} onClick={() => router.push(`/p/${id}/ask`)}>
            <Icon n="send" s />{chosen.length ? `استعلام از ${fa(chosen.length)} فروشگاه` : "فروشگاه‌ها را انتخاب کنید"}
          </button>
        </div>
        <div className="xs faint center" style={{ marginTop: 6 }}>موجودی، قیمت امروز و ساعت را یک‌جا می‌پرسیم</div>
      </div>

      <Sheet open={sheet} onClose={() => setSheet(false)} label="فاصله و مرتب‌سازی">
        <h2>فاصله و مرتب‌سازی</h2>
        <div className="stack" style={{ gap: 6 }}><span className="b sm">فاصله از {state.place.label}</span><Seg label="فاصله" value={f.radius_km ?? null} options={RADII} onChange={(v) => setF({ radius_km: v })} /></div>
        <div className="stack" style={{ gap: 6 }}><span className="b sm">مرتب‌سازی</span><Seg label="مرتب‌سازی" value={f.sort ?? "best"} options={SORTS} onChange={(v) => setF({ sort: v })} /></div>
        <button className="btn pri block" onClick={() => setSheet(false)}>نمایش {d ? fa(d.listed.length) : ""} فروشگاه</button>
      </Sheet>
    </main>
  );
}

function ZeroListed({ id, f, setF, catCount }: { id: string; f: ShopFilters; setF: (p: Partial<ShopFilters>) => void; catCount: number }) {
  const { state } = useSession();
  const prod = useQuery({ queryKey: ["product", id], queryFn: () => api.product(id) });
  const relax: { label: string; patch: Partial<ShopFilters> }[] = [];
  if (f.radius_km != null) relax.push({ label: f.radius_km < 3 ? "شعاع را ۳ کیلومتر کن" : "محدودیت فاصله را بردار", patch: { radius_km: f.radius_km < 3 ? 3 : null } });
  if (f.fast_delivery) relax.push({ label: "«ارسال سریع» را بردار", patch: { fast_delivery: false } });
  if (f.open_now) relax.push({ label: "«باز است الان» را بردار", patch: { open_now: false } });
  if (f.installment) relax.push({ label: "«قسطی» را بردار", patch: { installment: false } });
  const counts = useQuery({
    queryKey: ["relaxshops", id, f, state.place.lat],
    queryFn: () => Promise.all(relax.map((r) => api.productShops(id, state.place, { ...f, ...r.patch }, 40).then((x) => x.counts.listed))),
    enabled: relax.length > 0,
  });
  return (
    <>
      <Empty icon="store" title={relax.length ? "هیچ فروشگاهی همهٔ این شرایط را ندارد" : "نزدیک شما فروشگاهی این کالا را ثبت نکرده"}>
        {relax.length ? "یکی از شرط‌ها را بردارید؛ تعداد نتیجهٔ هر کدام کنارش است." : "فروشگاه‌های این دسته را می‌توانید بپرسید."}
      </Empty>
      {!relax.length && prod.data?.category && <WhereToLook q={prod.data.category} category={prod.data.category} />}
      <div className="pad stack" style={{ gap: 8 }}>
        {relax.map((r, i) => (
          <button key={r.label} className="card row between" style={{ padding: "12px 14px" }} onClick={() => setF(r.patch)}>
            <span className="sm">{r.label}</span>
            <span className="sm b" style={{ color: "var(--accent-ink)" }}>{counts.data ? `${fa(counts.data[i])} فروشگاه` : <span className="spin" />} <Icon n="fwd" s /></span>
          </button>
        ))}
        {catCount > 0 && <Note tone="unk" icon="q">{fa(catCount)} فروشگاه در این دسته فعالیت دارند. پایین‌تر چند تا را انتخاب کنید تا بپرسیم این مدل را دارند یا نه.</Note>}
      </div>
    </>
  );
}
