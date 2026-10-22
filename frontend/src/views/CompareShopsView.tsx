"use client";
// Step 3: compare the shortlisted shops side by side. Ranking follows what the shopper says matters (price, nearness,
// trustworthy info, going right now); every row marks its winner, and a verdict names the best shop per priority.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { api, type Priority, type ShopCard } from "@/lib/api";
import { daysAgo, fa, floorLabel, mil } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { FairChip, OpenChip, PriceBadge, confirmedPrice, travelText } from "@/components/honesty";
import { ScoreBars, WhenChip, whenLabel } from "@/components/discover";
import { AppBar, Bidi, ErrorState, Note, Sheet, SkeletonCards, Steps } from "@/components/ui";
import { PRIORITIES } from "./ShopsView";

type WinKey = "price" | "distance" | "freshness" | "closes" | "warranty" | "trust";

export default function CompareShopsView({ id, ids }: { id: string; ids: string[] }) {
  const router = useRouter();
  const { state, setPicks } = useSession();
  const [priority, setPriority] = useState<Priority>(state.filters.priority ?? "balanced");
  const [adding, setAdding] = useState(false);
  const p = useQuery({ queryKey: ["product", id], queryFn: () => api.product(id) });
  const q = useQuery({
    queryKey: ["scompare", id, ids.join(","), state.place.lat, state.place.lon, priority, state.when],
    queryFn: () => api.compareShops(id, ids, state.place, priority, state.when),
  });
  const more = useQuery({ queryKey: ["pshops", id, state.place.lat, state.place.lon, "add"], queryFn: () => api.productShops(id, state.place, {}, 20), enabled: adding });
  const go = (next: string[]) => { setPicks(id, next.slice(0, 5)); router.replace(`/p/${id}/shops/compare?ids=${next.slice(0, 6).join(",")}`); };

  if (q.isLoading) return <main className="main"><AppBar title="مقایسهٔ فروشگاه‌ها" /><SkeletonCards n={2} /></main>;
  if (q.isError || !q.data) return <main className="main"><AppBar title="مقایسهٔ فروشگاه‌ها" /><ErrorState error={q.error} retry={() => q.refetch()} /></main>;
  const d = q.data, cols = d.shops;
  const win = (k: WinKey, s: ShopCard) => d.winners[k]?.includes(s.shop_id);
  const w = (k: WinKey, s: ShopCard, children: React.ReactNode) =>
    <td className={win(k, s) ? "win" : undefined}>{win(k, s) && <Icon n="check" s />}{children}</td>;

  const rows: [string, (s: ShopCard) => React.ReactNode][] = [
    ["قیمت", (s) => s.tier === "category_only" ? <td><span className="cell-unk">بپرسید</span></td> : (
      w("price", s, <><PriceBadge offer={s.offer} confirmed={confirmedPrice(s.confirmation)} />{s.offer?.fair && <div style={{ marginTop: 4 }}><FairChip fair={s.offer.fair} /></div>}</>))],
    ["تازگی قیمت", (s) => w("freshness", s, <>{s.offer?.updated_by_seller ? "فروشنده به‌روز کرد" : s.offer?.age_days != null ? daysAgo(s.offer.age_days) : <span className="cell-unk">نامشخص</span>}</>)],
    ["رسیدن", (s) => w("distance", s, <>{travelText(s.travel, state.mode) ?? <span className="cell-unk">نامشخص</span>}{state.mode === "car" && s.travel?.car_note && <div className="xs" style={{ color: "var(--warn)" }}>طرح ترافیک</div>}</>)],
    [state.when === "now" ? "الان" : `وقت رسیدن (${whenLabel(state.when)})`, (s) => w("closes", s, <><OpenChip open={s.open} /></>)],
    ["تأیید و سابقه", (s) => w("trust", s, <>
      {s.confirmation && s.confirmation.state !== "expired" ? <div className="xs">{s.confirmation.available === false ? "«ندارم» گفته" : "موجودی تأییدشده"}</div> : <div className="xs faint">تأیید نشده</div>}
      <div className="xs faint">{s.reliability?.known ? fa(s.reliability.label ?? "") : "سابقه‌ای نیست"}</div></>)],
    ["هشدار آگهی", (s) => <td>{s.offer?.flags?.length ? s.offer.flags.map((f) => <div key={f.code} className="xs" style={{ color: f.tone === "bad" ? "var(--bad)" : "var(--warn)" }}>{f.label}</div>) : <span className="xs faint">ندارد</span>}</td>],
    ["محل", (s) => <td>{s.mall ?? "بدون پاساژ"}<br />{floorLabel(s.floor_label) ?? <span className="cell-unk">طبقه نامشخص</span>}</td>],
    ["قسطی", (s) => <td>{s.installment ? s.payments.map((x) => x.provider).join("، ") : "ندارد"}</td>],
    ["گارانتی", (s) => w("warranty", s, <>{s.offer?.warranty ? s.offer.warranty : <span className="cell-unk">نامشخص</span>}</>)],
    ["دلیل رتبه", (s) => <td style={{ minWidth: 130 }}>{s.tier === "listed" ? <ScoreBars s={s} /> : <span className="xs faint">بدون قیمت ثبت‌شده</span>}</td>],
  ];

  return (
    <main className="main has-cta scompare-main">
      <div className="lay lay-head">
      <AppBar title="مقایسهٔ فروشگاه‌ها" sub={p.data ? <Bidi text={p.data.title} /> : undefined} />
      <Steps at={2} />
      </div>
      <div className="pad stack" style={{ gap: 12 }}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="b sm">چه چیزی برایتان مهم‌تر است؟</span>
          <div className="wrapr">{PRIORITIES.map(([v, l]) => <button key={v} type="button" className={`chip ${priority === v ? "on" : ""}`} onClick={() => setPriority(v)}>{l}</button>)}<WhenChip /></div>
        </div>
        {d.verdict.length > 0 && (
          <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="row" style={{ gap: 8 }}><Icon n="spark" s /><b className="sm">خلاصه</b></div>
            {d.verdict.map((v) => (
              <div key={v.for} className="sm row" style={{ gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                <span className="tb info">{v.for}</span><b>{v.name}</b><span className="xs muted">{fa(v.why)}</span>
              </div>
            ))}
            {d.one_trip && <Note tone="info" icon="layers">{fa(d.one_trip.count)} تا از این فروشگاه‌ها در {fa(d.one_trip.mall)} هستند؛ می‌توانید در یک سفر هر کدام را حضوری ببینید.</Note>}
            {d.fair_price && <span className="xs faint">قیمت منصفانهٔ این کالا: {mil(d.fair_price.low)} تا {mil(d.fair_price.high)} تومان</span>}
          </div>
        )}
        <div className="tablewrap">
          <table className="ctab" style={{ minWidth: 110 + cols.length * 130 }}>
            <thead><tr><th />{cols.map((s, i) => (
              <td key={s.shop_id}><span className="tag" style={{ background: i === 0 ? "var(--accent)" : "var(--sunk)", color: i === 0 ? "var(--on-accent)" : "var(--ink-2)" }}>{fa(i + 1)}</span>
                <Link href={`/shop/${s.shop_id}?product=${id}`} className="b sm" style={{ display: "block", marginTop: 4 }}>{s.name}</Link>
                {cols.length > 2 && <button type="button" className="xs faint" style={{ background: "none", border: 0, padding: 0 }} onClick={() => go(ids.filter((x) => x !== s.shop_id))}>حذف</button>}</td>
            ))}</tr></thead>
            <tbody>{rows.map(([k, f]) => <tr key={k}><th>{k}</th>{cols.map((s) => <Fragment key={s.shop_id}>{f(s)}</Fragment>)}</tr>)}</tbody>
          </table>
        </div>
        <span className="xs faint">ترتیب ستون‌ها با اولویت «{d.priority_label}» است. خانهٔ سبز یعنی بهترین در همان ردیف. در «دلیل رتبه» نوار بلندتر یعنی امتیاز بهتر.</span>
        {cols.length < 6 && <button className="btn sec block" onClick={() => setAdding(true)}><Icon n="plus" s />افزودن فروشگاه به مقایسه</button>}
      </div>
      <div className="sticky-cta">
        <Link className="btn pri block" href={`/p/${id}/ask`} onClick={() => setPicks(id, cols.map((s) => s.shop_id).slice(0, 5))}><Icon n="send" s />استعلام از این {fa(Math.min(5, cols.length))} فروشگاه</Link>
      </div>
      <Sheet open={adding} onClose={() => setAdding(false)} label="افزودن فروشگاه">
        <h2>افزودن به مقایسه</h2>
        {more.isLoading && <span className="spin" />}
        {more.data?.listed.filter((s) => !ids.includes(s.shop_id)).slice(0, 10).map((s) => (
          <button key={s.shop_id} className="card row between" style={{ padding: "10px 12px" }} onClick={() => { go([...ids, s.shop_id]); setAdding(false); }}>
            <span className="stack" style={{ gap: 2, alignItems: "flex-start" }}><b className="sm">{s.name}</b><span className="xs faint">{s.mall ?? s.area} · {travelText(s.travel, state.mode)}</span></span>
            <span className="sm b num">{s.offer?.price ? mil(s.offer.price) : "—"}</span>
          </button>
        ))}
      </Sheet>
    </main>
  );
}
