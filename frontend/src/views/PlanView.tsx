"use client";
// Visit plan, built on the client from seller answers until /api/visit-plan exists (see docs/fixtures/visit_plan_SPEC…).
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type Inquiry, type ShopDetail } from "@/lib/api";
import { clock, fa, floorLabel, hm, walk } from "@/lib/fa";
import { km, walkMin } from "@/lib/geo";
import { useSession } from "@/lib/session";
import { useInquiries, useNow } from "@/lib/useInquiries";
import { Icon } from "@/components/Icon";
import { PriceBadge } from "@/components/honesty";
import { AppBar, Bidi, Empty, Note, SkeletonCards, Steps } from "@/components/ui";

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const tehranMinutes = (ms: number) => { const [h, m] = new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" }).split(":").map(Number); return h * 60 + m; };

interface Stop { q: Inquiry; shop: ShopDetail; closes: string | null; walkFromPrev: number; arrive: number; late: boolean; tight: boolean }

export default function PlanView({ product }: { product?: string }) {
  const { sid, state } = useSession();
  const now = useNow(30_000);
  const inq = useInquiries(sid, { live: false });
  const ok = useMemo(() => {
    const seen = new Set<string>(); // one stop per shop, newest answer wins
    return inq.items.filter((i) => i.status === "answered" && i.answer?.available !== false && i.shop && (!product || i.product?.product_id === product) && !seen.has(i.shop.shop_id) && seen.add(i.shop.shop_id));
  }, [inq.items, product]);
  const details = useQueries({ queries: ok.map((i) => ({ queryKey: ["shop", i.shop!.shop_id, state.place.lat, state.place.lon], queryFn: () => api.shop(i.shop!.shop_id, state.place) })) });
  const [userOrder, setOrder] = useState<string[] | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const loaded = details.every((d) => d.data);

  // default order: whoever closes first goes first; ties broken by distance
  const order = useMemo(() => {
    if (userOrder) return userOrder;
    if (!loaded) return [];
    const withClose = ok.map((q, i) => ({ id: q.id, close: q.answer?.closes_at ?? details[i].data!.open.closes_at ?? "23:59", d: details[i].data!.distance_km ?? 9 }));
    return withClose.sort((a, b) => a.close.localeCompare(b.close) || a.d - b.d).map((x) => x.id);
  }, [userOrder, loaded, ok, details]);

  const stops: Stop[] = useMemo(() => {
    if (!loaded) return [];
    let pos = { lat: state.place.lat, lon: state.place.lon }, t = tehranMinutes(now) + 5;
    return order.map((id) => {
      const i = ok.findIndex((q) => q.id === id);
      if (i < 0) return null;
      const q = ok[i], shop = details[i].data!;
      const w = walkMin(km(pos, shop));
      t += w; pos = shop;
      const closes = q.answer?.closes_at ?? shop.open.closes_at;
      const late = !!closes && t > toMin(closes);
      const tight = !!closes && !late && toMin(closes) - t < 15;
      const s = { q, shop, closes, walkFromPrev: w, arrive: t, late, tight };
      t += 10; // time in the shop
      return s;
    }).filter(Boolean) as Stop[];
  }, [order, loaded, ok, details, state.place, now]);

  if (inq.isLoading || (ok.length && !loaded)) return <main className="main"><AppBar title="برنامهٔ بازدید" /><SkeletonCards n={2} /></main>;
  if (!ok.length) return (
    <main className="main"><AppBar title="برنامهٔ بازدید" />
      <Empty icon="route" title="هنوز فروشگاهی «موجود است» نگفته" action={<Link className="btn sec" href="/track">برگشت به پیگیری</Link>}>وقتی اولین فروشنده موجود بودن را تأیید کند، مسیر رفتن اینجا ساخته می‌شود.</Empty></main>
  );

  const fmt = (m: number) => fa(`${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  const total = stops.reduce((a, s) => a + s.walkFromPrev, 0);
  const malls = new Set(stops.map((s) => s.shop.mall).filter(Boolean));
  const traffic = stops.some((s) => s.shop.in_traffic_zone);
  const first = stops[0]?.shop;
  const moveFirst = (id: string) => setOrder([id, ...order.filter((x) => x !== id)]);
  const tips = ["گارانتی را روی بسته‌بندی چک کنید", "فاکتور رسمی بگیرید", ...stops.filter((s) => s.q.answer?.price).map((s) => `قیمت تأییدشده را نشان دهید: ${s.shop.name}`), "سلامت و اصالت را قبل از پرداخت امتحان کنید"];

  return (
    <main className="main has-cta">
      <AppBar title="برنامهٔ بازدید" sub={`امروز · ${fa(stops.length)} توقف · حدود ${fa(total)} دقیقه پیاده`} />
      <Steps at={3} />
      <div className="pad stack" style={{ gap: 12 }}>
        <div className="row sm muted" style={{ gap: 8 }}><Icon n="loc" s />شروع از {state.place.label} · {clock(new Date(now).toISOString())}</div>
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {stops.map((s, i) => (
            <li key={s.q.id} style={{ display: "grid", gridTemplateColumns: "32px 1fr", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--accent)", color: "var(--on-accent)", display: "grid", placeItems: "center", fontWeight: 800 }}>{fa(i + 1)}</span>
                {i < stops.length - 1 && <span style={{ flex: 1, width: 2, background: "var(--line)", marginTop: 4 }} />}
              </div>
              <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                <div className="row between"><Link href={`/shop/${s.shop.shop_id}`} className="b">{s.shop.name}</Link><span className="xs num muted">رسیدن {fmt(s.arrive)}</span></div>
                <div className="crumb" style={{ fontSize: 13 }}>
                  {s.shop.mall ?? <span className="u">بدون پاساژ</span>}<span className="ar">←</span>
                  {floorLabel(s.shop.floor_label) ?? <span className="u">طبقه نامشخص</span>}<span className="ar">←</span>
                  {s.shop.unit ? `واحد ${fa(s.shop.unit)}` : s.shop.plaque ? `پلاک ${fa(s.shop.plaque)}` : <span className="u">واحد نامشخص</span>}
                </div>
                <div className="xs muted">{walk(s.walkFromPrev)} پیاده از {i ? "توقف قبلی" : "شما"}{s.closes ? ` · بسته می‌شود ${hm(s.closes)}` : " · ساعت بسته شدن نامشخص"}</div>
                {s.q.answer?.price ? <PriceBadge confirmed={{ price: s.q.answer.price, ago: "در استعلام" }} /> : <span className="confirmed"><Icon n="check" s />موجودی تأیید شده</span>}
                {s.late && <Note tone="bad" icon="clock">قبل از رسیدن شما بسته می‌شود.{i > 0 && " اول اینجا بروید؟"}</Note>}
                {s.tight && <Note tone="warn" icon="clock">کمتر از ۱۵ دقیقه قبل از بسته شدن می‌رسید.{i > 0 && " اول اینجا بروید؟"}</Note>}
                {(s.late || s.tight) && i > 0 && <button className="btn sec" style={{ minHeight: 42 }} onClick={() => moveFirst(s.q.id)}>جابه‌جا کن: اول {s.shop.name}</button>}
              </div>
            </li>
          ))}
        </ol>
        {malls.size === 1 && stops.length > 1 && <Note tone="info" icon="layers">همهٔ توقف‌ها در {[...malls][0]} است؛ طبقه‌ها را از پایین به بالا بروید.</Note>}
        {traffic && <Note tone="warn" icon="alert"><b>طرح ترافیک:</b> این مسیر داخل محدودهٔ طرح است. با مترو (ایستگاه‌های حافظ یا امام خمینی) بیایید؛ ورود خودرو بدون مجوز ممکن نیست.</Note>}
        {first && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="h4">مسیریابی تا توقف اول</div>
            <div className="row" style={{ gap: 8 }}>
              <a className="btn sec grow" href={`https://nshn.ir/?lat=${first.lat}&lng=${first.lon}`} target="_blank" rel="noopener">نشان</a>
              <a className="btn sec grow" href={`https://balad.ir/location?latitude=${first.lat}&longitude=${first.lon}`} target="_blank" rel="noopener">بلد</a>
              <a className="btn sec grow" href={`https://maps.google.com/?q=${first.lat},${first.lon}`} target="_blank" rel="noopener">گوگل</a>
            </div>
          </div>
        )}
        <div className="stack" style={{ gap: 6 }}>
          <div className="h4">داخل فروشگاه</div>
          {tips.map((t) => (
            <label key={t} className="card frow" style={{ padding: "0 12px", minHeight: 48, cursor: "pointer" }}>
              <span className="sm" style={{ textDecoration: done[t] ? "line-through" : undefined, color: done[t] ? "var(--ink-3)" : undefined }}><Bidi text={t} /></span>
              <input type="checkbox" className="sr" checked={!!done[t]} onChange={() => setDone((d) => ({ ...d, [t]: !d[t] }))} />
              <span className={`sel ${done[t] ? "on" : ""}`} aria-hidden="true">{done[t] && <Icon n="check" s />}</span>
            </label>
          ))}
        </div>
      </div>
      {first && (
        <div className="sticky-cta">
          <a className="btn pri block" href={`https://nshn.ir/?lat=${first.lat}&lng=${first.lon}`} target="_blank" rel="noopener"><Icon n="route" s />شروع مسیر</a>
        </div>
      )}
    </main>
  );
}
