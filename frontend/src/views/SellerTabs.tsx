"use client";
// The seller app's «Today» (how you are doing, what people want from you) and «Shop» (are you open, how people reach you) tabs.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { fa } from "@/lib/fa";
import { Bidi, Note } from "@/components/ui";

const DAYS: [string, string][] = [["sat", "شنبه"], ["sun", "یکشنبه"], ["mon", "دوشنبه"], ["tue", "سه‌شنبه"], ["wed", "چهارشنبه"], ["thu", "پنجشنبه"], ["fri", "جمعه"]];
const hm = (t: string) => fa(t.slice(0, 5));

function Stat({ n, label, tone }: { n: ReactNode; label: string; tone?: "bad" | "ok" }) {
  return (
    <div className="card seller-stat" style={{ padding: 12 }}>
      <div className="seller-stat-n num" style={tone === "bad" ? { color: "var(--bad)" } : tone === "ok" ? { color: "var(--ok)" } : undefined}>{n}</div>
      <div className="xs muted">{label}</div>
    </div>
  );
}

export function TodayTab({ shop, token }: { shop: string; token: string }) {
  const q = useQuery({ queryKey: ["seller-today", shop, token], queryFn: () => api.sellerToday(shop, token), refetchInterval: 20_000 });
  if (q.isLoading) return <div className="sk" style={{ height: 160 }} />;
  if (!q.data) return <Note tone="bad" icon="alert">{(q.error as Error)?.message ?? "خطا"}</Note>;
  const t = q.data;
  const avg = t.avg_response_s == null ? "—" : t.avg_response_s < 90 ? `${fa(t.avg_response_s)} ثانیه` : `${fa(Math.round(t.avg_response_s / 60))} دقیقه`;
  return (
    <>
      {t.tip && <Note tone={t.missed ? "warn" : "info"} icon="alert">{t.tip}</Note>}
      <div className="seller-stats">
        <Stat n={fa(t.asked)} label="پرسش امروز" />
        <Stat n={fa(t.answered)} label="جواب‌داده‌شده" tone="ok" />
        <Stat n={fa(t.missed)} label="بی‌جواب ماند" tone={t.missed ? "bad" : undefined} />
        <Stat n={avg} label="میانگین زمان پاسخ" />
        <Stat n={fa(t.on_the_way)} label="مشتری در راه / نگه‌داری" />
        <Stat n={fa(t.confirmations)} label="تأیید موجودی امروز" />
      </div>
      <section className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="h4">مشتری‌ها این هفته چه می‌خواستند</div>
        <div className="xs muted">{t.week_asked ? `${fa(t.week_asked)} پرسش در ۷ روز گذشته` : "هنوز پرسشی نیامده."}</div>
        {t.top.map((x) => (
          <div key={x.product_id} className="row between" style={{ gap: 8 }}>
            <span className="sm"><Bidi text={x.title.length > 55 ? `${x.title.slice(0, 55)}…` : x.title} /></span>
            <b className="num">{fa(x.count)}×</b>
          </div>
        ))}
        {t.top.length > 0 && <div className="xs faint">این کالاها را موجود نگه دارید و قیمتشان را به‌روز کنید؛ بیشترین پرسش را دارند.</div>}
      </section>
    </>
  );
}

export function ShopTab({ shop, token, shopId, bale }: { shop: string; token: string; shopId: string; bale: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["seller-shop", shop, token], queryFn: () => api.sellerShop(shop, token) });
  const closed = useMutation({
    mutationFn: (b: { mode: "reopen" | "today" | "hours"; hours?: number }) => api.sellerSetClosed(shop, token, b),
    onSuccess: (r) => qc.setQueryData(["seller-shop", shop, token], r),
  });
  const [callMsg, setCallMsg] = useState<string | null>(null);
  const call = useMutation({
    mutationFn: () => api.demoCallSeller(shopId),
    onSuccess: () => setCallMsg("تماس آزمایشی زنگ می‌خورد؛ همین صفحه را باز نگه دارید."),
    onError: (e) => setCallMsg((e as Error).message),
  });
  if (q.isLoading) return <div className="sk" style={{ height: 160 }} />;
  if (!q.data) return <Note tone="bad" icon="alert">{(q.error as Error)?.message ?? "خطا"}</Note>;
  const s = q.data;
  const shut = !!s.closed_until;
  return (
    <>
      <section className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="h4">الان باز هستید؟</div>
        <div className={`note ${shut ? "bad" : s.open.state === "closed" ? "warn" : "ok"}`} style={{ fontSize: 14, fontWeight: 700 }}>
          {shut ? `به مشتری‌ها گفته‌ایم بسته‌اید (تا ${fa(new Date(s.closed_until!).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }))}).` : s.open.label}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {shut ? <button type="button" className="btn pri" disabled={closed.isPending} onClick={() => closed.mutate({ mode: "reopen" })}>بازم؛ دوباره باز کن</button> : (
            <>
              <button type="button" className="btn sec" disabled={closed.isPending} onClick={() => closed.mutate({ mode: "hours", hours: 1 })}>یک ساعت بسته‌ایم</button>
              <button type="button" className="btn sec" disabled={closed.isPending} onClick={() => closed.mutate({ mode: "hours", hours: 3 })}>۳ ساعت</button>
              <button type="button" className="btn sec" disabled={closed.isPending} onClick={() => closed.mutate({ mode: "today" })}>تا آخر امروز بسته‌ایم</button>
            </>
          )}
        </div>
        <span className="xs faint">وقتی بسته اعلام کنید، خریدار نمی‌آید و دست‌خالی برنمی‌گردد؛ ساعت کاری ثبت‌شده را عوض نمی‌کند.</span>
        {closed.isError && <Note tone="bad" icon="alert">{(closed.error as Error).message}</Note>}
      </section>
      <section className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="h4">ساعت کاری ثبت‌شده</div>
        {s.weekly_hours ? DAYS.map(([k, name]) => {
          const d = s.weekly_hours![k];
          const sh = d?.status === "declared" ? d.shifts.filter((x) => x.start_time !== x.end_time).map((x) => `${hm(x.start_time)}–${hm(x.end_time)}`).join("، ") : "";
          return <div key={k} className="row between sm"><span>{name}</span><span className="muted num">{sh || (d?.status === "closed" ? "تعطیل" : "نامشخص")}</span></div>;
        }) : <div className="xs muted">ساعت کاری‌ای ثبت نشده است.</div>}
        <span className="xs faint">برای اصلاح ساعت‌ها فعلاً با پشتیبانی ترب‌گرد تماس بگیرید.</span>
      </section>
      <section className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="h4">راه‌های ارتباط</div>
        {s.phone && <div className="sm">تلفن فروشگاه: <b className="num" dir="ltr">{s.phone}</b></div>}
        {bale}
        <div className="xs muted">آزمایش تماس صوتی: همین الان یک تماس درون‌برنامه‌ای شبیه‌سازی‌شده می‌گیرید تا ببینید خریدار چطور می‌پرسد.</div>
        <button type="button" className="btn sec" disabled={call.isPending} onClick={() => { setCallMsg(null); call.mutate(); }}>آزمایش تماس</button>
        {callMsg && <div className="xs">{callMsg}</div>}
      </section>
    </>
  );
}
