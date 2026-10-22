"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { fa, mil, money, walk } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { ProductCard } from "@/components/cards";
import { compareHref, pickAlternatives, useCompare } from "@/components/Compare";
import { PriceBadge, SourceNote } from "@/components/honesty";
import { ProductReview } from "@/components/ReviewCard";
import { AppBar, Bidi, ErrorState, Note, SkeletonCards, Steps, Thumb } from "@/components/ui";
import { FairPriceNote, VariantsStrip } from "@/components/discover";

const KEY_SPECS = ["نوع اتصال", "مناسب برای", "قابلیت های مقاومتی", "عمر باتری هدفون در حالت استندبای", "نسخه بلوتوث", "وزن", "حافظه داخلی", "مقدار RAM", "تعداد کانال", "رزولوشن"];

export default function ProductView({ id }: { id: string }) {
  const { state } = useSession();
  const { openCompare } = useCompare();
  const [all, setAll] = useState(false);
  const [tab, setTab] = useState<"buy" | "specs">("buy");
  const [flash, setFlash] = useState(false);
  // «مشخصات»: open the full list, scroll to it (clear of the top bar) and flash it, so the click visibly does something
  const showSpecs = (e: React.MouseEvent) => {
    e.preventDefault();
    setAll(true); setTab("specs"); setFlash(true);
    requestAnimationFrame(() => document.getElementById("specs")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    setTimeout(() => setFlash(false), 1400);
  };
  const p = useQuery({ queryKey: ["product", id], queryFn: () => api.product(id) });
  const shops = useQuery({ queryKey: ["pshops", id, state.place.lat, state.place.lon], queryFn: () => api.productShops(id, state.place, { sort: "best" }, 40), enabled: !!p.data });
  const single = (p.data?.shop_count ?? 0) <= 1;
  const ins = useQuery({ queryKey: ["insights", id, state.place.lat, state.place.lon, state.when], queryFn: () => api.insights(id, state.place, state.when), enabled: !!p.data });
  const sim = useQuery({ queryKey: ["similar", id, 8], queryFn: () => api.similar(id, 8), enabled: !!p.data }); // shared with the compare picker

  if (p.isLoading) return <main className="main"><AppBar /><SkeletonCards n={3} /></main>;
  if (p.isError || !p.data) return <main className="main"><AppBar /><ErrorState error={p.error} retry={() => p.refetch()} /></main>;
  const d = p.data;
  const ages = (shops.data?.listed ?? []).map((s) => s.offer?.age_days).filter((x): x is number => x != null);
  const near = shops.data?.listed.filter((s) => (s.walk_min ?? 99) <= 15).length ?? 0;
  const specs = (KEY_SPECS.map((k) => d.specs.find((s) => s.key === k)).filter(Boolean) as typeof d.specs);
  const shown = specs.length >= 3 ? specs : d.specs.slice(0, 6);
  const pos = (v: number) => (d.price_max! > d.price_min! ? ((v - d.price_min!) / (d.price_max! - d.price_min!)) * 100 : 50);
  const alts = pickAlternatives(d, sim.data?.items ?? []);
  const nearest = [...(shops.data?.listed ?? [])].sort((a, b) => (a.walk_min ?? 99) - (b.walk_min ?? 99))[0];

  return (
    <main className="main has-cta">
      <div className="lay lay-head">
      <AppBar end={<button className="iconbtn" aria-label="مقایسه با کالای دیگر" onClick={() => openCompare(id)}><Icon n="compare" /></button>} />
      <Steps at={0} />
      </div>
      <div className="tabs" style={{ marginBottom: 12 }}>
        <span className={tab === "buy" ? "on" : undefined} style={{ whiteSpace: "nowrap" }}><Icon n="pin" s />خرید حضوری <span className="cnt">{fa(d.shop_count)}</span></span>
        <a href="#specs" className={tab === "specs" ? "on" : undefined} onClick={showSpecs}>مشخصات</a>
        <button type="button" onClick={() => openCompare(id)}>مقایسهٔ کالا</button>
      </div>
      <div className="pad stack lay-product" style={{ gap: 14 }}>
        <div className="lay pd-main">
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
            <FairPriceNote fp={ins.data?.fair_price} />
            <SourceNote>منبع: ترب · قیمت‌های ثبت‌شده{ages.length ? `، از ${fa(Math.min(...ages))} تا ${fa(Math.max(...ages))} روز پیش` : ""}؛ هنوز هیچ‌کدام تأیید نشده</SourceNote>
          </div>
        )}

        {ins.data?.availability && ins.data.availability.shops > 0 && (
          <div className="truth" aria-label="در دسترس بودن نزدیک شما">
            <span className={`tb ${ins.data.availability.near ? "ok" : "unk"}`}><Icon n="walk" s />{ins.data.availability.near ? `${fa(ins.data.availability.near)} فروشگاه تا ۱۵ دقیقه پیاده` : `نزدیک‌ترین ${fa(ins.data.availability.nearest_min ?? 0)} دقیقه پیاده`}</span>
            <span className={`tb ${ins.data.availability.open ? "ok" : "warn"}`}><Icon n="clock" s />{fa(ins.data.availability.open)} فروشگاه باز ({ins.data.when})</span>
            <span className={`tb ${ins.data.availability.installment ? "ok" : "unk"}`}><Icon n="card" s />{ins.data.availability.installment ? `${fa(ins.data.availability.installment)} فروشندهٔ قسطی` : "فروشندهٔ قسطی ندارد"}</span>
          </div>
        )}
        {ins.data && <VariantsStrip items={ins.data.variants} />}
        {!single && near > 0 && (
          <Note tone="info" icon="spark"><b>چرا این؟ </b>{fa(near)} فروشگاه تا ۱۵ دقیقه پیاده از «{state.place.label}» این کالا را ثبت کرده‌اند{d.price_min ? ` و ارزان‌ترینش ${mil(d.price_min)} تومان است` : ""}.</Note>
        )}
        {alts.length > 0 && (
          <Link className="card row cmp-quick" href={compareHref([id, ...alts.map((a) => a.product_id)])}>
            <span className="cmp-thumbs" aria-hidden="true">{alts.map((a) => <Thumb key={a.product_id} src={a.image} alt="" size={40} brand={a.brand} />)}</span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="sm b" style={{ display: "block" }}>مقایسه با {fa(alts.length)} کالای مشابه</span>
              <span className="xs faint cmp-clamp" style={{ WebkitLineClamp: 1 }}><Bidi text={alts.map((a) => a.title).join(" · ")} /></span>
            </span>
            <Icon n="fwd" s />
          </Link>
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

        <ProductReview id={d.product_id} />
        <div id="specs" className={flash ? "flash" : undefined}>
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
        <div className="lay pd-side">
        <div className="sticky-cta">
          <div className="dk-only">
            <div className="row between"><span className="b">خرید حضوری</span><span className="tag" style={{ background: "var(--sunk)", color: "var(--ink-2)" }}>{fa(d.shop_count)} فروشگاه</span></div>
            {nearest && <>
              <div className="sm muted" style={{ marginBlock: 6 }}>نزدیک‌ترین: <b style={{ color: "var(--ink)" }}>{nearest.name}</b>{nearest.mall ? ` · ${nearest.mall}` : ""} · {walk(nearest.walk_min)} پیاده</div>
              <PriceBadge offer={nearest.offer} />
            </>}
          </div>
          <div className="row">
            <button className="btn sec" onClick={() => openCompare(id)}><Icon n="compare" s />مقایسه با کالای دیگر</button>
            <Link className="btn pri grow" href={`/p/${id}/shops`}><Icon n="map" s />فروشگاه‌های نزدیک</Link>
          </div>
        </div>
        </div>
      </div>
    </main>
  );
}
