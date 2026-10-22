"use client";
// «عکس بگیر، قیمت را بسنج»: a shopper photographs a product in a shop. The vision model reads brand/model/price from the
// photo (shown as «از عکس خوانده شد», editable), the shopper confirms which catalogue product it is, then sees how the price
// they were quoted compares with prices other shops nearby have listed, and can ask the cheaper ones in one tap.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type IdentifyResult, type Product } from "@/lib/api";
import { fa, mil, money, parseNum, walk } from "@/lib/fa";
import { takePhoto } from "@/lib/photo";
import { useSession } from "@/lib/session";
import { useStartMission } from "@/lib/useStartMission";
import { Icon } from "@/components/Icon";
import { ProductCard, ShopCard } from "@/components/cards";
import { ProductReview } from "@/components/ReviewCard";
import { SnapButton } from "@/components/SnapButton";
import { WhereToLook } from "@/components/WhereToLook";
import { AppBar, Bidi, Empty, Note, SkeletonCards, Thumb } from "@/components/ui";

export default function SnapView({ t }: { t?: string }) {
  const [img, setImg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // the photo lives in this tab's sessionStorage (put there by the camera button); read it after mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImg(takePhoto()); setLoaded(true);
  }, [t]);
  const q = useQuery({ queryKey: ["identify", t, img?.length], queryFn: () => api.identify(img!), enabled: !!img, staleTime: Infinity, retry: 0 });

  return (
    <main className="main">
      <div className="lay lay-head"><AppBar title="عکس کالا" sub="مدل و قیمت را با فروشگاه‌های نزدیک بسنجید" back="/" /></div>
      {err && <div className="pad"><Note tone="bad" icon="alert">{err}</Note></div>}
      {loaded && !img && (
        <div style={{ paddingTop: 40 }}>
          <Empty icon="cam" title="از کالا عکس بگیرید" action={<SnapButton className="btn pri" label="عکس گرفتن" onError={setErr}><Icon n="cam" s />عکس گرفتن</SnapButton>}>
            از جعبه، برچسب مدل یا برچسب قیمت عکس بگیرید؛ مدل را می‌خوانیم و قیمت را با فروشگاه‌های اطراف مقایسه می‌کنیم.
          </Empty>
        </div>
      )}
      {img && (
        <div className="pad stack lay-2col" style={{ gap: 14 }}>
          <div className="lay snap-photo">
            <div className="card" style={{ padding: 10, display: "flex", gap: 12, alignItems: "flex-start" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img} alt="عکسی که گرفتید" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 12, flex: "0 0 auto" }} />
              <div className="grow stack" style={{ gap: 6 }}>
                {q.isLoading && <span className="toolline" style={{ alignSelf: "flex-start" }}><span className="spin" />در حال خواندن عکس…</span>}
                {q.data && <ReadSummary r={q.data} />}
                {q.isError && <span className="sm" style={{ color: "var(--bad)" }}>{(q.error as Error).message}</span>}
                <SnapButton className="btn ghost" label="عکس دیگر" onError={setErr}><Icon n="cam" s />عکس دیگر</SnapButton>
              </div>
            </div>
            {q.data && <Refine initial={refineText(q.data)} />}
            <p className="xs faint" style={{ margin: 0 }}>عکس فقط برای همین خواندن به سرور فرستاده می‌شود و ذخیره نمی‌شود.</p>
          </div>
          <div className="lay snap-result">
            {q.isLoading && <SkeletonCards n={2} />}
            {q.isError && <Empty icon="alert" tone="bad" title="عکس خوانده نشد">نام یا مدل کالا را در کادر جستجو بنویسید، یا از برچسب مدل روی جعبه عکس بگیرید.</Empty>}
            {q.data && <Result r={q.data} />}
          </div>
        </div>
      )}
    </main>
  );
}

/** What to prefill in «درست نخواند؟»: the model when it matched; otherwise type + brand (a printed slogan like «SMART TECH» is not a model). */
function refineText(r: IdentifyResult) {
  const x = r.read;
  if (x.model && r.match !== "type_only" && r.match !== "none") return x.model.replace(/[(\[].*?[)\]]/g, "").trim();
  return [x.product_type, x.brand_fa ?? x.brand].filter(Boolean).join(" ") || x.search_query || r.query || "";
}

function ReadSummary({ r }: { r: IdentifyResult }) {
  const x = r.read;
  const conf = { high: "خوانا", medium: "تا حدی خوانا", low: "نامطمئن" }[x.confidence];
  return (
    <>
      <div className="xs faint row" style={{ gap: 6 }}><Icon n="eye" s />از عکس خوانده شد · {conf}</div>
      <div className="wrapr">
        {x.product_type && <span className="tag" style={{ background: "var(--sunk)", color: "var(--ink-2)" }}>{x.product_type}</span>}
        {(x.brand_fa || x.brand) && <span className="tag" style={{ background: "var(--sunk)", color: "var(--ink-2)" }}><Bidi text={x.brand_fa ?? x.brand} /></span>}
        {x.model && <span className="tag" style={{ background: "var(--info-soft)", color: "var(--info-ink)" }}><bdi>{x.model}</bdi></span>}
        {x.price_seen && <span className="tag" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>قیمت روی برچسب: {money(x.price_seen)}</span>}
      </div>
      {!x.model && <span className="xs muted">مدل روی عکس خوانده نشد.</span>}
    </>
  );
}

function Refine({ initial }: { initial: string }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  return (
    <form className="stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) router.push(`/search?q=${encodeURIComponent(text.trim())}`); }}>
      <label htmlFor="snap-q" className="xs faint">درست نخواند؟ اصلاح کنید و جستجو کنید</label>
      <div className="field search">
        <button className="sbtn" type="submit" aria-label="جستجو"><Icon n="search" s /></button>
        <input id="snap-q" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="search" />
      </div>
    </form>
  );
}

function Result({ r }: { r: IdentifyResult }) {
  const [picked, setPicked] = useState<string | null>(null);
  if (r.match === "none" || !r.candidates.length) return (
    <Empty icon="search" title="در فروشگاه‌ها پیدا نشد">{r.read.product_type ? `«${r.read.product_type}» با این مشخصات در فروشگاه‌های ثبت‌شده نیست.` : "کالای داخل عکس را نشناختیم."} نام کالا را بنویسید یا عکس واضح‌تری از برچسب مدل بگیرید.</Empty>
  );
  if (r.match === "related") return (
    <div className="stack" style={{ gap: 10 }}>
      <Note tone="warn" icon="alert"><b>خود این مدل در فروشگاه‌ها ثبت نشده.</b> این‌ها لوازم یا قطعات همین مدل‌اند؛ برای خود کالا از فروشگاه‌های همین دسته بپرسید.</Note>
      {r.candidates.map((p) => <ProductCard key={p.product_id} p={p} />)}
      {r.read.product_type && <WhereToLook q={r.read.product_type} />}
    </div>
  );
  if (r.match === "type_only") return (
    <div className="stack" style={{ gap: 10 }}>
      <Note tone="unk" icon="q">فقط نوع کالا («{r.read.product_type}») مشخص شد. برای مقایسهٔ قیمت، از برچسب مدل روی جعبه عکس بگیرید یا یکی از این‌ها را انتخاب کنید.</Note>
      {r.candidates.map((p) => <ProductCard key={p.product_id} p={p} />)}
      {r.read.product_type && <Link className="btn sec block" href={`/search?q=${encodeURIComponent(r.read.product_type)}`}>همهٔ «{r.read.product_type}»ها</Link>}
    </div>
  );
  const sel = r.candidates.find((p) => p.product_id === picked) ?? r.candidates[0];
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="h4">همین است؟</div>
      <div className="stack" style={{ gap: 8 }} role="radiogroup" aria-label="کالای داخل عکس">
        {r.candidates.map((p) => {
          const on = p.product_id === sel.product_id;
          return (
            <button key={p.product_id} type="button" role="radio" aria-checked={on} className="card row" onClick={() => setPicked(p.product_id)}
              style={{ padding: 10, gap: 10, borderColor: on ? "var(--accent)" : undefined, boxShadow: on ? "0 0 0 3px var(--accent-soft)" : undefined }}>
              <span className={`sel ${on ? "on" : ""}`} style={{ borderRadius: "50%" }}>{on && <Icon n="check" s />}</span>
              <Thumb src={p.image} alt="" size={48} brand={p.brand} />
              <span className="grow"><span className="b sm" style={{ display: "block", lineHeight: 1.5 }}><Bidi text={p.title} /></span>
                <span className="xs faint">{fa(p.shop_count)} فروشگاه{p.price_min ? ` · از ${mil(p.price_min)}` : ""}</span></span>
            </button>
          );
        })}
      </div>
      <PriceCheck key={sel.product_id} p={sel} seen={r.read.price_seen} />
    </div>
  );
}

/** Compare the price the shopper was quoted with prices other shops nearby have listed (listed ≠ confirmed). */
function PriceCheck({ p, seen }: { p: Product; seen: number | null }) {
  const { state } = useSession();
  const startMission = useStartMission();
  const [text, setText] = useState(seen ? money(seen) : "");
  // a price read from the photo is only a guess (BoxAPI once read ۳٬۲۰۰٬۰۰۰ as ۳۲۰٬۰۰۰): no verdict until the shopper confirms it
  const [confirmed, setConfirmed] = useState(false);
  const quoted = text ? parseNum(text) : null;
  const fromPhoto = !!seen && quoted === seen;
  const shops = useQuery({ queryKey: ["pshops-snap", p.product_id, state.place.lat, state.place.lon], queryFn: () => api.productShops(p.product_id, state.place, { sort: "best" }, 60) });
  const listed = (shops.data?.listed ?? []).filter((s) => s.offer?.price);
  const prices = listed.map((s) => s.offer!.price!).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  const cheaper = quoted ? listed.filter((s) => s.offer!.price! < quoted).sort((a, b) => (a.walk_min ?? 99) - (b.walk_min ?? 99)) : [];
  const nearCheap = cheaper.filter((s) => (s.walk_min ?? 99) <= 20);
  const pct = quoted && median ? Math.round(((quoted - median) / median) * 100) : null;
  // far outside what shops list (×4 or more): most likely a dropped/extra zero, in the photo read or in typing
  const ratio = quoted && median ? quoted / median : null;
  const suspicious = ratio !== null && (ratio >= 4 || ratio <= 0.25) && !confirmed;
  const fixes = quoted && median ? [quoted * 10, quoted / 10, quoted * 100, quoted / 100].filter((v) => v / median > 0.4 && v / median < 2.5) : [];
  const needConfirm = fromPhoto && !confirmed;
  const showVerdict = !!quoted && pct !== null && !suspicious && !needConfirm;
  const edit = (v: string) => { setText(v); setConfirmed(false); };
  // the photo becomes a mission: the cheaper shops are already shortlisted, the next screen asks them
  const ask = (ids: string[]) => startMission(p, { picks: ids.slice(0, 5), view: "compare", fresh: true });

  return (
    <section className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }} aria-label="سنجش قیمت">
      <div className="h4"><Icon n="sort" s />سنجش قیمت</div>
      <div className="stack" style={{ gap: 6 }}>
        <label htmlFor="quoted" className="sm b">قیمتی که این فروشگاه گفته (تومان)</label>
        <div className="field" style={{ minHeight: 52 }}>
          <input id="quoted" inputMode="numeric" value={text} onChange={(e) => edit(e.target.value)} placeholder="مثلاً ۳٬۲۰۰٬۰۰۰" style={{ fontSize: 18, fontWeight: 800 }} />
          <span className="xs faint">تومان</span>
        </div>
        {fromPhoto && <span className="xs faint">از برچسب قیمت در عکس خوانده شد{confirmed ? "" : "؛ با برچسب مقایسه کنید"}.</span>}
      </div>
      {shops.isLoading && <div className="sk" style={{ height: 60 }} />}
      {shops.data && !prices.length && <Note tone="unk" icon="q">هیچ فروشگاه نزدیکی برای این کالا قیمت ثبت نکرده؛ مقایسه ممکن نیست.</Note>}
      {shops.data && prices.length > 0 && (
        <>
          <div className="row between xs num" style={{ background: "var(--sunk)", borderRadius: 12, padding: "10px 12px" }}>
            <span><b>{mil(prices[0])}</b><br /><span className="faint">کمترین ثبت‌شده</span></span>
            <span className="center"><b>{mil(median!)}</b><br /><span className="faint">میانه</span></span>
            <span style={{ textAlign: "left" }}><b>{fa(prices.length)}</b><br /><span className="faint">فروشگاه با قیمت</span></span>
          </div>
          {suspicious && (
            <Note tone="warn" icon="alert">
              <b>احتمالاً اشتباه {fromPhoto ? "خوانده شد" : "نوشته شد"}:</b> {money(quoted!)} تومان با قیمت‌های ثبت‌شده (میانه {mil(median!)}) خیلی فاصله دارد؛ شاید یک صفر کم یا زیاد شده.
              <span className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {fixes.map((v) => <button key={v} type="button" className="btn sec" onClick={() => edit(money(v))}>{money(v)} تومان</button>)}
                <button type="button" className="btn ghost" onClick={() => setConfirmed(true)}>همین درست است</button>
              </span>
            </Note>
          )}
          {!suspicious && needConfirm && quoted && (
            <Note tone="unk" icon="q">
              قیمت روی برچسب <b>{money(quoted)} تومان</b> است؟
              <span className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button type="button" className="btn pri" onClick={() => setConfirmed(true)}><Icon n="check" s />بله، درست است</button>
                <button type="button" className="btn ghost" onClick={() => document.getElementById("quoted")?.focus()}>اصلاح می‌کنم</button>
              </span>
            </Note>
          )}
          {showVerdict && (
            pct > 5
              ? <Note tone="warn" icon="alert"><b>{fa(pct)}٪ بالاتر از میانهٔ قیمت‌های ثبت‌شده.</b>{nearCheap.length ? ` ${fa(nearCheap.length)} فروشگاه تا ۲۰ دقیقه پیاده ارزان‌تر ثبت کرده‌اند.` : ""}</Note>
              : pct < -5
                ? nearCheap.length
                  ? <Note tone="info" icon="spark"><b>{fa(-pct)}٪ پایین‌تر از میانه</b>، ولی {fa(nearCheap.length)} فروشگاه تا ۲۰ دقیقه پیاده ارزان‌تر ثبت کرده‌اند.</Note>
                  : <Note tone="ok" icon="check"><b>{fa(-pct)}٪ پایین‌تر از میانه</b> و ارزان‌تر از این در نزدیکی ثبت نشده؛ قیمت خوبی است. اصالت و گارانتی را چک کنید.</Note>
                : <Note tone="info" icon="spark"><b>نزدیک به میانهٔ قیمت‌های ثبت‌شده.</b>{nearCheap.length ? ` ${fa(nearCheap.length)} فروشگاه نزدیک کمی ارزان‌تر ثبت کرده‌اند.` : ""}</Note>
          )}
          {!quoted && <span className="xs muted">قیمتی که فروشنده گفت را بنویسید تا مقایسه کنیم.</span>}
          {showVerdict && nearCheap.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="sm b">ارزان‌تر در نزدیکی</div>
              {nearCheap.slice(0, 3).map((s) => <ShopCard key={s.shop_id} s={s} href={`/shop/${s.shop_id}?product=${p.product_id}`} />)}
              <button className="btn pri block" onClick={() => ask(nearCheap.slice(0, 3).map((s) => s.shop_id))}>
                <Icon n="send" s />از {fa(Math.min(3, nearCheap.length))} فروشگاه بپرس: موجود است؟ قیمت امروز؟
              </button>
            </div>
          )}
          {showVerdict && !nearCheap.length && <Note tone="ok" icon="check">ارزان‌تر از این قیمت، تا ۲۰ دقیقه پیاده ثبت نشده است{cheaper.length ? ` (دورتر: ${fa(cheaper.length)} فروشگاه، نزدیک‌ترین ${walk(cheaper[0].walk_min)})` : ""}.</Note>}
          <span className="xs faint">قیمت‌ها همان ثبت‌شده در ترب‌اند و تأیید نشده‌اند؛ برای قیمت قطعی استعلام بگیرید.</span>
        </>
      )}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Link className="btn sec" href={`/p/${p.product_id}`}>صفحهٔ کالا</Link>
        <button type="button" className="btn sec" onClick={() => startMission(p, { view: "find", fresh: true })}><Icon n="map" s />خرید برای این کالا</button>
      </div>
      <ProductReview id={p.product_id} />
    </section>
  );
}
