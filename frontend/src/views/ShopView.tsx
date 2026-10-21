"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type DayHours, type Weekday } from "@/lib/api";
import { fa, hm } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { MallLocator } from "@/components/cards";
import { FastChip, InstallmentChips, NoCallNote, OpenChip, PriceBadge, ShopName, SourceNote } from "@/components/honesty";
import { AppBar, Bidi, ErrorState, Note, SkeletonCards } from "@/components/ui";

const DAYS: [Weekday, string][] = [["sat", "شنبه"], ["sun", "یکشنبه"], ["mon", "دوشنبه"], ["tue", "سه‌شنبه"], ["wed", "چهارشنبه"], ["thu", "پنجشنبه"], ["fri", "جمعه"]];
const todayKey = (): Weekday => {
  const d = new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Tehran" }).toLowerCase().slice(0, 3);
  return d as Weekday;
};
const realShifts = (d: DayHours) => d.shifts.filter((x) => !(x.start_time === "00:00:00" && x.end_time === "00:00:00"));
const looksWrong = (d: DayHours) => d.status === "unsupported" || (d.status === "declared" && realShifts(d).some((x) => x.start_time < "06:00:00" || x.start_time === x.end_time));

function Hours({ wh }: { wh: Record<Weekday, DayHours> }) {
  const today = todayKey();
  return (
    <table className="hours"><tbody>
      {DAYS.map(([k, l]) => {
        const d = wh[k];
        const sh = d ? realShifts(d) : [];
        const bad = d && looksWrong(d);
        const v = !d ? "نامشخص" : d.status === "closed" ? "تعطیل" : d.status === "unsupported" ? "نامعتبر" : sh.map((x) => `${hm(x.start_time)}–${hm(x.end_time)}`).join("، ") || "تعطیل";
        return (
          <tr key={k} className={`${k === today ? "today" : ""} ${k === "fri" ? "fri" : ""}`}>
            <td>{l}{k === today ? " · امروز" : ""}</td>
            <td>{bad ? <span className="bad">{v} ⚠</span> : v}</td>
          </tr>
        );
      })}
    </tbody></table>
  );
}

export default function ShopView({ id, product }: { id: string; product?: string }) {
  const router = useRouter();
  const { state, togglePick } = useSession();
  const [more, setMore] = useState(false);
  const q = useQuery({ queryKey: ["shop", id, state.place.lat, state.place.lon], queryFn: () => api.shop(id, state.place) });
  if (q.isLoading) return <main className="main"><AppBar title="فروشگاه" /><SkeletonCards n={3} /></main>;
  if (q.isError || !q.data) return <main className="main"><AppBar title="فروشگاه" /><ErrorState error={q.error} retry={() => q.refetch()} /></main>;
  const s = q.data;
  const wrong = s.weekly_hours && Object.values(s.weekly_hours).some(looksWrong);
  const picked = product ? (state.picks[product] ?? []).includes(id) : false;
  const mapsUrl = `https://maps.google.com/?q=${s.lat},${s.lon}`;

  return (
    <main className={`main ${product ? "has-cta" : ""}`}>
      <AppBar title="فروشگاه" sub={s.area ?? undefined} end={s.mall_key ? <Link className="iconbtn" href={`/mall/${encodeURIComponent(s.mall_key)}`} aria-label="راهنمای پاساژ"><Icon n="layers" /></Link> : undefined} />
      <div className="pad stack" style={{ gap: 14 }}>
        <div className="stack" style={{ gap: 6 }}>
          <ShopName shop={s} />
          {!s.name_is_verified && <span className="xs faint">نام از داده‌ها نمایش داده می‌شود؛ ممکن است با تابلوی فروشگاه فرق کند.</span>}
          <div className="wrapr"><OpenChip open={s.open} />{s.open.state === "closed" && s.open.opens_at && <span className="xs faint">باز می‌شود: {fa(s.open.opens_at)}</span>}</div>
          <div className="wrapr"><InstallmentChips shop={s} full /><FastChip v={s.fast_delivery} /></div>
        </div>
        <MallLocator s={s} />
        <div className="row" style={{ gap: 8 }}>
          <a className="btn sec grow" href={`https://nshn.ir/?lat=${s.lat}&lng=${s.lon}`} target="_blank" rel="noopener">نشان</a>
          <a className="btn sec grow" href={`https://balad.ir/location?latitude=${s.lat}&longitude=${s.lon}`} target="_blank" rel="noopener">بلد</a>
          <a className="btn sec grow" href={mapsUrl} target="_blank" rel="noopener">گوگل</a>
        </div>
        {s.website && <a href={s.website} target="_blank" rel="noopener" className="card row" style={{ padding: "12px 14px", gap: 10, color: "var(--accent-ink)" }}><Icon n="link" s /><bdi>{s.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</bdi></a>}

        <div className="stack" style={{ gap: 6 }}>
          <div className="h4">ساعت کاری</div>
          {wrong && <Note tone="warn" icon="alert"><b>ساعت‌ها ممکن است دقیق نباشد.</b> ساعت ثبت‌شده برای چند روز نامعتبر است؛ قبل از رفتن بپرسید.</Note>}
          {s.weekly_hours ? <Hours wh={s.weekly_hours} /> : <Note tone="unk" icon="clock"><b>ساعت کاری ثبت نشده.</b> قبل از رفتن بپرسید؛ در استعلام سؤال ساعت را اضافه کنید.</Note>}
        </div>

        {s.offers.length ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="h4">کالاهای ثبت‌شده <span className="n">{fa(s.offer_count)}</span></div>
            {s.offers.slice(0, more ? 30 : 3).map((o) => (
              <Link key={o.offer_id} href={`/p/${o.product_id}`} className="card" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="sm b" style={{ lineHeight: 1.6 }}><Bidi text={o.title ?? o.seller_title} /></div>
                <PriceBadge offer={o} />
              </Link>
            ))}
            {!more && s.offers.length > 3 && <button className="btn ghost" onClick={() => setMore(true)}>نمایش بیشتر</button>}
          </div>
        ) : <Note tone="unk" icon="store">این فروشگاه هنوز کالایی با قیمت ثبت نکرده است.</Note>}

        {s.categories.length > 0 && (
          <div className="stack" style={{ gap: 6 }}><div className="h4">دسته‌ها</div>
            <div className="wrapr">{s.categories.slice(0, 8).map((c) => <span key={c} className="tag" style={{ background: "var(--sunk)", color: "var(--ink-2)" }}>{c}</span>)}
              {s.categories.length > 8 && <span className="tag" style={{ color: "var(--accent-ink)" }}>+{fa(s.categories.length - 8)} دسته</span>}</div></div>
        )}
        <NoCallNote />
        <SourceNote>منبع: ترب{s.name_is_verified ? " · نام فروشگاه تأییدشده" : ""}{s.in_traffic_zone ? " · داخل محدودهٔ طرح ترافیک" : ""}</SourceNote>
      </div>
      {product && (
        <div className="sticky-cta">
          <button className="btn pri block" onClick={() => { if (!picked) togglePick(product, id); router.push(`/p/${product}/ask`); }}>
            <Icon n="send" s />{picked ? "رفتن به استعلام" : "افزودن به استعلام"}
          </button>
        </div>
      )}
    </main>
  );
}
