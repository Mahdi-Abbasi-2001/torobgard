"use client";
// Step 4b (canvas F8 / D5): the trip. The shop that has your item held (or the best confirmed one) is the stop; the others wait as backups.
// «On my way, ask again» re-confirms the main stop; if it sold out meanwhile, the line reroutes to the next confirmed shop by itself.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type PlanStop, type ShopCard } from "@/lib/api";
import { clock, fa, floorLabel, money } from "@/lib/fa";
import { useIsDesktop } from "@/lib/media";
import { useSession } from "@/lib/session";
import { useNow } from "@/lib/useInquiries";
import { Icon } from "@/components/Icon";
import { ShopMap } from "@/components/ShopMap";
import { Note } from "@/components/ui";
import { Shell } from "./chrome";
import type { StageProps } from "./stage";

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== "0";

export default function GoStage(sp: StageProps) {
  const { m, status, set, go, patchSlots } = sp;
  const desk = useIsDesktop();
  const { sid } = useSession();
  const qc = useQueryClient();
  const pid = m.productId!;
  const [ticks, setTicks] = useState<Record<number, boolean>>({});
  const now = useNow(15_000);

  // who goes first: the shop that holds it, else the cheapest confirmed one; the rest follow as backups
  const live = useMemo(() => status.items.filter((x) => x.ripeness >= 3).sort((a, b) =>
    Number(b.ripeness === 4) - Number(a.ripeness === 4) || (a.q.answer?.price ?? 9e12) - (b.q.answer?.price ?? 9e12)), [status.items]);
  const gone = status.items.filter((x) => x.gone || x.q.status === "unavailable");
  const order = live.map((x) => x.q.shop!.shop_id);
  const sig = status.items.map((x) => `${x.q.id}${x.q.status}${x.ripeness}`).join();
  const plan = useQuery({
    queryKey: ["plan", sid, pid, order.join(), sig, m.place.lat, m.place.lon], placeholderData: keepPreviousData, retry: 0, enabled: order.length > 0,
    queryFn: () => api.visitPlan({ session_id: sid, product_id: pid, lat: m.place.lat, lon: m.place.lon, order }),
  });
  const shops = useQuery({ queryKey: ["pshops-all", pid, m.place.lat], queryFn: () => api.productShops(pid, m.place, { sort: "best" }, 100, m.when) });
  const cardOf = (id: string): ShopCard | undefined => [...(shops.data?.listed ?? []), ...(shops.data?.category_only ?? [])].find((s) => s.shop_id === id);
  const stops: PlanStop[] = plan.data?.stops ?? [];
  const main = stops[0];
  const progressOf = (shopId: string) => status.items.find((x) => x.q.shop?.shop_id === shopId);
  const mainP = main ? progressOf(main.shop_id) : undefined;

  const recheck = useMutation({
    mutationFn: (o: { demo: boolean }) => api.recheck(sid, mainP!.q.id, main ? Math.max(1, main.walk_min_from_previous) : null, o.demo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inquiries", sid] }),
  });
  const kid = mainP?.kids.filter((k) => k.kind === "recheck").sort((a, b) => (b.created_at > a.created_at ? 1 : -1))[0];
  const checking = !!kid && (kid.status === "sent" || kid.status === "delivered");
  const okAgain = !!kid && kid.status === "answered" && now - new Date(kid.answered_at ?? kid.created_at).getTime() < 3 * 60_000;
  const rerouted = gone.some((x) => x.gone);

  const banner = checking ? { tone: "info" as const, icon: "clock" as const, t: `دارم از ${main?.name} دوباره می‌پرسم…` }
    : rerouted && main ? { tone: "warn" as const, icon: "refresh" as const, t: `مسیر عوض شد: ${gone.find((x) => x.gone)?.q.shop?.name} همین الان تمام کرد. توقف بعدی جایش آمد.` }
    : rerouted ? { tone: "bad" as const, icon: "alert" as const, t: "فروشگاهی که تأیید کرده بود تمام کرد و فروشگاه تأییدشدهٔ دیگری نمانده. از فروشگاه‌های دیگر بپرسید." }
    : okAgain ? { tone: "ok" as const, icon: "check" as const, t: "هنوز هست. با خیال راحت بروید." } : null;

  const finish = () => go("done");
  const youLabel = plan.data?.start.label ?? m.place.label;
  const tips = plan.data?.checklist ?? [];

  const line = (
    <div className="mc-card trip">
      <div className="trip-stop">
        <div className="trip-rail"><i className="node you" /><i className="tseg on" /></div>
        <div className="trip-body" style={{ paddingBottom: 14 }}><div className="row between"><b>شما</b><span className="xs faint">{plan.data?.start.time ? fa(plan.data.start.time) : "الان"}</span></div><div className="xs muted">{youLabel}، {m.mode === "walk" ? "پیاده" : m.mode === "taxi" ? "با تاکسی" : "با ماشین"}</div></div>
      </div>
      {stops.map((s, i) => {
        const p = progressOf(s.shop_id);
        const last = i === stops.length - 1 && gone.length === 0;
        return (
          <div key={s.shop_id} className="trip-stop">
            <div className="trip-rail"><i className={`node ${i === 0 ? "mainstop" : "backup"}`} />{!last && <i className={`tseg ${i === 0 ? "" : "off"}`} />}</div>
            <div className="trip-body">
              <div className="row between" style={{ gap: 8 }}><b style={{ fontSize: 15 }}>{s.name}</b><span className="xs faint">{i === 0 ? `${fa(s.walk_min_from_previous)} دقیقه` : "پشتیبان"}</span></div>
              <div className="xs muted">{[s.mall, floorLabel(s.floor_label), s.unit ? `واحد ${fa(s.unit)}` : s.plaque ? `پلاک ${fa(s.plaque)}` : null].filter(Boolean).join("، ")}{`، رسیدن ${fa(s.arrive_at)}`}</div>
              <div className="sm" style={{ lineHeight: 1.6 }}>
                {s.confirmed_price ? `تأیید فروشنده: ${money(s.confirmed_price)} تومان` : "تأیید فروشنده: موجود"}{p?.q.answered_at ? `، ${clock(p.q.answered_at)}` : ""}.
                {s.closes_at ? ` تا ${fa(s.closes_at)} باز است.` : ""}
              </div>
              {s.warnings.map((w) => <div key={w.text} className={`note ${w.level === "bad" ? "bad" : "warn"}`}><Icon n="alert" s /><span>{w.text}</span></div>)}
              {s.hold && <div className="hold-chip"><Icon n="hold" s />کد نگه‌داری: <b className="num">{fa(s.hold.code)}</b>{s.hold.until ? <span className="xs">، تا {fa(s.hold.until)}</span> : null}</div>}
            </div>
          </div>
        );
      })}
      {gone.map((x, i) => (
        <div key={x.q.id} className="trip-stop" style={{ opacity: 0.6 }}>
          <div className="trip-rail"><i className="node gone" />{i < gone.length - 1 && <i className="tseg off" />}</div>
          <div className="trip-body"><div className="row between"><b style={{ textDecoration: "line-through" }}>{x.q.shop?.name}</b><span className="xs faint">حذف شد</span></div>
            <div className="xs muted">{x.gone ? "وقتی دوباره پرسیدیم گفت آخری را فروخته." : "ندارد."}</div></div>
        </div>
      ))}
    </div>
  );

  const actions = (
    <div className="stack" style={{ gap: 8 }}>
      <div className="trip-actions">
        <button className="btn sec" disabled={!mainP || checking || recheck.isPending} onClick={() => recheck.mutate({ demo: false })}><Icon n="walk" s />راه افتادم؛ دوباره بپرس</button>
        {DEMO && <button className="btn ghost demo-btn" disabled={!mainP || checking || recheck.isPending} onClick={() => recheck.mutate({ demo: true })} title="فقط در حالت نمایشی">نمایش: اگر تمام کرده بود</button>}
      </div>
      {recheck.isError && <Note tone="bad" icon="alert">{(recheck.error as Error).message}</Note>}
      {plan.data?.deep_links && main && (
        <div className="row" style={{ gap: 8 }}>
          <a className="btn sec grow" href={`https://nshn.ir/?lat=${main.lat}&lng=${main.lon}`} target="_blank" rel="noopener">مسیریابی با نشان</a>
          <a className="btn sec grow" href={`https://balad.ir/location?latitude=${main.lat}&longitude=${main.lon}`} target="_blank" rel="noopener">با بلد</a>
        </div>
      )}
      {plan.data?.transport.suggestion && <Note tone="warn" icon="alert">{plan.data.transport.suggestion}</Note>}
    </div>
  );

  const check = tips.length > 0 && (
    <div className="mc-card" style={{ padding: 14, gap: 8 }}>
      <div className="b sm">در مغازه چک کنید</div>
      {tips.map((t, i) => (
        <button key={t} type="button" className="check-row" onClick={() => setTicks((x) => ({ ...x, [i]: !x[i] }))} aria-pressed={!!ticks[i]}>
          <span className={`sel ${ticks[i] ? "on" : ""}`} style={{ width: 22, height: 22, borderRadius: 6 }}>{ticks[i] && <Icon n="check" s />}</span><span className="xs" style={{ textAlign: "start", lineHeight: 1.6 }}>{fa(t)}</span>
        </button>
      ))}
    </div>
  );

  const labels: Record<string, string> = {}, states: Record<string, string> = {};
  stops.forEach((s, i) => {
    labels[s.shop_id] = i === 0 && s.hold ? `کد ${fa(s.hold.code)}` : s.confirmed_price ? `${fa((s.confirmed_price / 1e6).toFixed(2).replace(/0$/, "").replace(".", "٫"))} م` : "موجود";
    states[s.shop_id] = i === 0 ? (s.hold ? "held" : "confirmed") : "confirmed";
  });
  gone.forEach((x) => { labels[x.q.shop!.shop_id] = "تمام شد"; states[x.q.shop!.shop_id] = "gone"; });
  const mapShops = [...stops.map((s) => cardOf(s.shop_id)), ...gone.map((x) => cardOf(x.q.shop!.shop_id))].filter((s): s is ShopCard => !!s);
  const routes = stops.length ? [{ pts: [[m.place.lat, m.place.lon], ...stops.slice(0, 1).map((s) => [s.lat, s.lon])] as [number, number][] }, ...(stops.length > 1 ? [{ pts: stops.slice(0, 2).map((s) => [s.lat, s.lon]) as [number, number][], alt: true }] : [])] : [];
  const map = mapShops.length > 0 ? <ShopMap origin={m.place} listed={mapShops} cat={[]} selected={[]} labels={labels} states={states} routes={routes} height={desk ? "100%" : 220} /> : null;

  const cta = main ? (
    <>
      <button className="btn pri" onClick={finish}>رسیدم و خریدم</button>
      <div className="hint">بعد از خرید می‌پرسیم بود یا نه؛ جوابتان برای همه قیمت را به‌روز می‌کند.</div>
    </>
  ) : <button className="btn pri" onClick={() => go("confirm")}>برگرد به تأیید فروشنده‌ها</button>;

  const body = (
    <div className="stack" style={{ gap: 12 }}>
      <div className="stack" style={{ gap: 2 }}><div className="xs faint">مسیر امروز</div>
        <h2 style={{ margin: 0, fontSize: desk ? 24 : 20, fontWeight: 800 }}>{plan.isLoading ? "…" : stops.length ? `${fa(stops.length)} توقف، ${fa(plan.data!.total_walk_min)} دقیقه راه` : "مسیری نیست"}</h2></div>
      {banner && <Note tone={banner.tone} icon={banner.icon}>{banner.t}</Note>}
      {plan.isError && <Note tone="unk" icon="store">هنوز فروشگاهی «موجود است» نگفته. به مرحلهٔ تأیید برگردید.</Note>}
      {line}{actions}{check}
    </div>
  );

  if (desk) {
    return <Shell {...sp} patch={patchSlots} mapStage center={<div className="map-fill">{map ?? <div className="sk" style={{ height: "100%", borderRadius: 22 }} />}</div>} panel={body} cta={cta} />;
  }
  return <Shell {...sp} patch={patchSlots} center={<div className="mc-main"><div className="mc-pad stack" style={{ gap: 12 }}>{body}{map && <div className="stack">{map}</div>}</div></div>} cta={cta} />;
  void set;
}
