"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { fa, mil, money } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { ProductCard } from "@/components/cards";
import { SourceNote } from "@/components/honesty";
import { AppBar, Bidi, ErrorState, Note, SkeletonCards, Steps, Thumb } from "@/components/ui";

const KEY_SPECS = ["نوع اتصال", "مناسب برای", "قابلیت های مقاومتی", "عمر باتری هدفون در حالت استندبای", "نسخه بلوتوث", "وزن", "حافظه داخلی", "مقدار RAM", "تعداد کانال", "رزولوشن"];

export default function ProductView({ id }: { id: string }) {
  const { state, toggleCompare } = useSession();
  const [all, setAll] = useState(false);
  const p = useQuery({ queryKey: ["product", id], queryFn: () => api.product(id) });
  const shops = useQuery({ queryKey: ["pshops", id, state.place.lat, state.place.lon], queryFn: () => api.productShops(id, state.place, { sort: "best" }, 40), enabled: !!p.data });
  const single = (p.data?.shop_count ?? 0) <= 1;
  const sim = useQuery({ queryKey: ["similar", id], queryFn: () => api.similar(id, 4), enabled: !!p.data && single });

  if (p.isLoading) return <main className="main"><AppBar /><SkeletonCards n={3} /></main>;
  if (p.isError || !p.data) return <main className="main"><AppBar /><ErrorState error={p.error} retry={() => p.refetch()} /></main>;
  const d = p.data;
  const ages = (shops.data?.listed ?? []).map((s) => s.offer?.age_days).filter((x): x is number => x != null);
  const near = shops.data?.listed.filter((s) => (s.walk_min ?? 99) <= 15).length ?? 0;
  const specs = (KEY_SPECS.map((k) => d.specs.find((s) => s.key === k)).filter(Boolean) as typeof d.specs);
  const shown = specs.length >= 3 ? specs : d.specs.slice(0, 6);
  const pos = (v: number) => (d.price_max! > d.price_min! ? ((v - d.price_min!) / (d.price_max! - d.price_min!)) * 100 : 50);
  const inCmp = state.compare.includes(id);

  return (
    <main className="main has-cta">
      <AppBar end={<button className="iconbtn" aria-pressed={inCmp} aria-label="افزودن به مقایسه" onClick={() => toggleCompare(id)} style={{ color: inCmp ? "var(--accent)" : undefined }}><Icon n="compare" /></button>} />
      <Steps at={0} />
      <div className="tabs" style={{ marginBottom: 12 }}>
        <span className="on" style={{ whiteSpace: "nowrap" }}><Icon n="pin" s />خرید حضوری <span className="cnt">{fa(d.shop_count)}</span></span>
        <a href="#specs">مشخصات</a>
        <Link href={`/compare?ids=${[...new Set([id, ...state.compare])].slice(0, 4).join(",")}`}>مقایسه</Link>
      </div>
      <div className="pad stack" style={{ gap: 14 }}>
        <Thumb src={d.images[0] ?? d.image} alt={d.title} size="100%" h={220} brand={d.brand} />
        <div>
          <div className="xs faint">{d.brand ?? "برند نامشخص"} · {d.category}</div>
          <h2 style={{ margin: "2px 0 0", fontSize: 19, lineHeight: 1.6, fontWeight: 800 }}><Bidi text={d.title} /></h2>
        </div>

        {d.price_min != null && d.price_max != null && d.price_median != null && (
          <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="row between" style={{ alignItems: "baseline" }}>
              <span className="price" style={{ fontSize: 20 }}>{d.price_min === d.price_max ? money(d.price_min) : `از ${mil(d.price_min)}`}<small>تومان</small></span>
              <span className="sm muted">{fa(d.shop_count)} فروشگاه</span>
            </div>
            {d.price_min !== d.price_max && (
              <>
                <div style={{ position: "relative", height: 30 }} aria-hidden="true">
                  <div style={{ position: "absolute", insetInline: 0, top: 12, height: 6, borderRadius: 3, background: "linear-gradient(to left, var(--ok-soft), var(--sunk))" }} />
                  {[[d.price_min, "var(--ok)"], [d.price_median, "var(--ink-3)"], [d.price_max, "var(--ink-3)"]].map(([v, c], i) => (
                    <span key={i} style={{ position: "absolute", top: 8, insetInlineStart: `calc(${pos(v as number)}% - 7px)`, width: 14, height: 14, borderRadius: "50%", background: "var(--card)", border: `2.5px solid ${c}` }} />
                  ))}
                </div>
                <div className="row between xs num">
                  <span><b>{mil(d.price_min)}</b><br /><span className="faint">کمترین</span></span>
                  <span className="center"><b>{mil(d.price_median)}</b><br /><span className="faint">میانه</span></span>
                  <span style={{ textAlign: "left" }}><b>{mil(d.price_max)}</b><br /><span className="faint">بیشترین</span></span>
                </div>
              </>
            )}
            <SourceNote>منبع: ترب · قیمت‌های ثبت‌شده{ages.length ? `، از ${fa(Math.min(...ages))} تا ${fa(Math.max(...ages))} روز پیش` : ""}؛ هنوز هیچ‌کدام تأیید نشده</SourceNote>
          </div>
        )}

        {!single && near > 0 && (
          <Note tone="info" icon="spark"><b>چرا این؟ </b>{fa(near)} فروشگاه تا ۱۵ دقیقه پیاده از «{state.place.label}» این کالا را ثبت کرده‌اند{d.price_min ? ` و ارزان‌ترینش ${mil(d.price_min)} تومان است` : ""}.</Note>
        )}
        {single && (
          <>
            <Note tone="warn" icon="alert"><b>فقط ۱ فروشگاه این کالا را دارد.</b> اگر ناموجود باشد گزینهٔ دیگری نمی‌ماند؛ جایگزین‌ها را ببینید.</Note>
            {sim.data?.items.length ? (
              <div className="stack" style={{ gap: 8 }}><div className="h4">مشابه با فروشندهٔ بیشتر</div>
                {sim.data.items.slice(0, 2).map((x) => <ProductCard key={x.product_id} p={x} />)}</div>
            ) : null}
          </>
        )}

        <div id="specs">
          <div className="h4" style={{ marginBottom: 6 }}>مشخصات کلیدی</div>
          {d.specs.length === 0
            ? <Note tone="unk" icon="q">مشخصات فنی برای این کالا ثبت نشده. از فروشنده دربارهٔ اصالت و گارانتی بپرسید.</Note>
            : (
              <>
                <table className="ctab"><tbody>{(all ? d.specs : shown).map((s, i) => <tr key={s.key + i}><th>{s.key}</th><td>{fa(s.value)}</td></tr>)}</tbody></table>
                {!all && d.specs.length > shown.length && <button className="btn ghost" style={{ paddingInline: 0 }} onClick={() => setAll(true)}>همهٔ {fa(d.specs.length)} مشخصه <Icon n="fwd" s /></button>}
              </>
            )}
        </div>
      </div>
      <div className="sticky-cta">
        <div className="row">
          <button className="btn sec" onClick={() => toggleCompare(id)} aria-pressed={inCmp}><Icon n={inCmp ? "check" : "compare"} s />{inCmp ? "در مقایسه" : "مقایسه"}</button>
          <Link className="btn pri grow" href={`/p/${id}/shops`}><Icon n="map" s />فروشگاه‌های نزدیک</Link>
        </div>
      </div>
    </main>
  );
}
