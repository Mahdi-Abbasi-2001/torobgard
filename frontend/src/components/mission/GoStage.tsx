"use client";
// Step 4b (canvas F8 / D5): the trip. The shop that has your item held (or the best confirmed one) is the stop; the others wait as backups.
// «On my way, ask again» re-confirms the main stop; if it sold out meanwhile, the line reroutes to the next confirmed shop by itself.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, type PlanStop, type ShopCard } from "@/lib/api";
import { clock, fa, floorLabel, money } from "@/lib/fa";
import { useDemo } from "@/lib/demo";
import { useIsDesktop } from "@/lib/media";
import { useSession } from "@/lib/session";
import { useNow } from "@/lib/useInquiries";
import { Icon } from "@/components/Icon";
import dynamic from "next/dynamic";
import { ShopMap } from "@/components/ShopMap";
import { RouteSteps } from "@/components/RouteMap";
import { ArrivalSheet } from "./MallStack";
import { Extras } from "./Extras";
const RouteMap = dynamic(() => import("@/components/RouteMap"), { ssr: false, loading: () => <div className="sk" style={{ height: "100%", minHeight: 220, borderRadius: 22 }} /> });
import { Note } from "@/components/ui";
import { CounterCheck } from "./CounterCheck";
import { FinalSteps } from "./FinalSteps";
import { Shell } from "./chrome";
import type { StageProps } from "./stage";


export default function GoStage(sp: StageProps) {
  const { m, status, set, go, patchSlots } = sp;
  const desk = useIsDesktop();
  const demo = useDemo();
  const { sid } = useSession();
  const qc = useQueryClient();
  const pid = m.productId!;
  const [ticks, setTicks] = useState<Record<number, boolean>>({});
  const [counter, setCounter] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [stack, setStack] = useState(false);
  const [view3d, setView3d] = useState(true); // the 3D route is the default; the flat map is one tap away (and takes over if 3D cannot start)
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
  // a fallback shop more than 45 minutes beyond the first stop is no real fallback: it is not shown
  const stops: PlanStop[] = (plan.data?.stops ?? []).filter((s, i) => i === 0 || s.walk_min_from_previous <= 45);
  const main = stops[0];
  const progressOf = (shopId: string) => status.items.find((x) => x.q.shop?.shop_id === shopId);
  const mainP = main ? progressOf(main.shop_id) : undefined;

  const recheck = useMutation({
    mutationFn: (o: { demo: boolean }) => api.recheck(sid, mainP!.q.id, main ? Math.max(1, main.walk_min_from_previous) : null, o.demo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inquiries", sid] }),
  });
  const kid = mainP?.kids.filter((k) => k.kind === "recheck").sort((a, b) => (b.created_at > a.created_at ? 1 : -1))[0];
  const arriveMut = useMutation({ mutationFn: () => api.arrive(sid, mainP!.q.id), onSuccess: () => qc.invalidateQueries({ queryKey: ["inquiries", sid] }) });
  const here = mainP?.kids.filter((k) => k.kind === "arrive").sort((a, b) => (b.created_at > a.created_at ? 1 : -1))[0];
  const hereWaiting = !!here && (here.status === "sent" || here.status === "delivered");
  const checking = !!kid && (kid.status === "sent" || kid.status === "delivered");
  const okAgain = !!kid && kid.status === "answered" && now - new Date(kid.answered_at ?? kid.created_at).getTime() < 3 * 60_000;
  const rerouted = gone.some((x) => x.gone);

  const banner = checking ? { tone: "info" as const, icon: "clock" as const, t: `دوباره از ${main?.name} می‌پرسیم…` }
    : rerouted && main ? { tone: "warn" as const, icon: "refresh" as const, t: `مسیر عوض شد: ${gone.find((x) => x.gone)?.q.shop?.name} همین حالا گفت تمام شده. فروشگاه بعدی جایش آمد.` }
    : rerouted ? { tone: "bad" as const, icon: "alert" as const, t: "فروشگاهی که تأیید کرده بود تمام شده و فروشگاه تأییدشدهٔ دیگری نداریم. از فروشگاه‌های دیگر بپرسید." }
    : okAgain ? { tone: "ok" as const, icon: "check" as const, t: "هنوز هست. با خیال راحت بروید." } : null;

  const finish = () => go("done");
  const youLabel = m.place.source === "default" ? "مرکز تهران" : m.place.label;
  const tips = plan.data?.checklist ?? [];

  const line = (
    <div className="mc-card trip">
      <div className="trip-stop">
        <div className="trip-rail"><i className="node you" /><i className="tseg on" /></div>
        <div className="trip-body" style={{ paddingBottom: 14 }}><div className="row between"><b>{m.place.source === "gps" ? "شما" : "نقطهٔ شروع"}</b><span className="xs faint">{plan.data?.start.time ? fa(plan.data.start.time) : "الان"}</span></div><div className="xs muted">{youLabel}، {m.mode === "walk" ? "پیاده" : m.mode === "taxi" ? "با تاکسی" : "با ماشین"}</div></div>
      </div>
      {stops.map((s, i) => {
        const p = progressOf(s.shop_id);
        const last = i === stops.length - 1 && gone.length === 0;
        return (
          <div key={s.shop_id} className="trip-stop">
            <div className="trip-rail"><i className={`node ${i === 0 ? "mainstop" : "backup"}`} />{!last && <i className={`tseg ${i === 0 ? "" : "off"}`} />}</div>
            <div className="trip-body">
              <div className="row between" style={{ gap: 8 }}><b style={{ fontSize: 15 }}>{s.name}</b><span className="xs faint">{i === 0 ? `${fa(s.walk_min_from_previous)} دقیقه` : "جایگزین"}</span></div>
              <div className="xs muted">{[s.mall, floorLabel(s.floor_label), s.unit ? `واحد ${fa(s.unit)}` : s.plaque ? `پلاک ${fa(s.plaque)}` : null].filter(Boolean).join("، ")}{`، رسیدن ${fa(s.arrive_at)}`}</div>
              <div className="sm" style={{ lineHeight: 1.6 }}>
                {s.confirmed_price ? `تأیید فروشنده: ${money(s.confirmed_price)} تومان` : "تأیید فروشنده: موجود"}{p?.q.answered_at ? `، ${clock(p.q.answered_at)}` : ""}.
                {s.closes_at ? ` تا ${fa(s.closes_at)} باز است.` : ""}
              </div>
              {s.trip_risk && (() => { const lv = s.trip_risk.level; return (
                <div className={`note ${lv === "low" ? "ok" : lv === "medium" ? "warn" : "bad"}`} style={{ fontSize: 14, fontWeight: 700 }}>
                  <Icon n={lv === "low" ? "check" : "alert"} s />
                  <span>خطر دست‌خالی برگشتن: {s.trip_risk.label}
                    <span className="xs" style={{ display: "block", fontWeight: 550 }}>{lv === "low" ? "احتمالاً کالا آنجاست" : lv === "medium" ? "ممکن است کالا تمام شده باشد؛ جایگزین را در نظر داشته باشید" : "احتمال زیاد کالا آنجا نیست یا مغازه بسته است"}{i > 0 && s.backup_same_mall ? " · همان پاساژ است؛ اگر اولی نداشت، تقریباً راه اضافه‌ای نیست" : ""}</span>
                  </span>
                </div>); })()}
              {s.warnings.map((w) => <div key={w.text} className={`note ${w.level === "bad" ? "bad" : "warn"}`}><Icon n="alert" s /><span>{w.text}</span></div>)}
              {s.hold && <div className="hold-chip hold-big"><Icon n="hold" s /><span>این کد را به فروشنده نشان دهید تا کالا را برایتان نگه دارد<b className="num">{fa(s.hold.code)}</b>{s.hold.until ? <span className="xs">تا {fa(s.hold.until)} نگه می‌دارد</span> : null}</span></div>}
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
      {here && (
        <div className={`arrive-card ${here.status === "answered" ? "ok" : ""}`} role="status">
          {hereWaiting ? <><span className="spin" /><span>به فروشنده خبر دادیم که رسیده‌اید؛ منتظر جواب…</span></>
            : here.status === "answered" ? <><Icon n="check" /><span className="grow"><b>فروشنده منتظر شماست.</b>{main?.hold ? <> کد <b className="num">{fa(main.hold.code)}</b> را بگویید.</> : null}</span></>
            : <><Icon n="clock" /><span>{here.status === "unavailable" ? "فروشنده الان نمی‌تواند پاسخ بدهد؛ چند دقیقه صبر کنید یا سراغ فروشگاه بروید." : "فروشنده جواب نداد؛ مستقیم سراغ فروشگاه بروید."}</span></>}
        </div>
      )}
      <div className="trip-actions">
        <button className="btn pri" disabled={!mainP || hereWaiting || arriveMut.isPending || here?.status === "answered"} onClick={() => arriveMut.mutate()}><Icon n="pin" s />رسیدم؛ به فروشنده خبر بده</button>
        <button className="btn sec" disabled={!mainP || checking || recheck.isPending} onClick={() => recheck.mutate({ demo: false })}><Icon n="walk" s />هنوز موجود است؟ دوباره بپرس</button>
        {demo && <button className="btn ghost demo-btn" disabled={!mainP || checking || recheck.isPending} onClick={() => recheck.mutate({ demo: true })} title="فقط در حالت نمایشی">نمایشی: اگر تمام شده بود</button>}
      </div>
      {arriveMut.isError && <Note tone="bad" icon="alert">{(arriveMut.error as Error).message}</Note>}
      {recheck.isError && <Note tone="bad" icon="alert">{(recheck.error as Error).message}</Note>}
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
  const flat = mapShops.length > 0 ? <ShopMap origin={m.place} listed={mapShops} cat={[]} selected={[]} labels={labels} states={states} routes={routes} height={desk ? "100%" : 220} /> : null;
  // a tilted 3D view of the walk to the first stop (prototype): same trip, seen from above the streets
  const target = stops[0];
  const map = flat && (
    <div className="map3d">
      {target && <div className="map3d-toggle" role="group" aria-label="نوع نقشه">
        <button type="button" className={`chip ${!view3d ? "on" : ""}`} aria-pressed={!view3d} onClick={() => setView3d(false)}>نقشه</button>
        <button type="button" className={`chip ${view3d ? "on" : ""}`} aria-pressed={view3d} onClick={() => setView3d(true)}><Icon n="spark" s />سه‌بعدی</button>
      </div>}
      {view3d && target ? <RouteMap from={{ lat: m.place.lat, lon: m.place.lon }} to={{ lat: target.lat, lon: target.lon }} label={target.name} mode={m.mode} height={desk ? "100%" : 360} onUnavailable={() => setView3d(false)} onArrive={() => setArrived(true)} /> : flat}
    </div>
  );

  const cta = main ? (
    <>
      <button className="btn sec" disabled={!main} onClick={() => setCounter(true)}><Icon n="cam" s />بررسی کالا با عکس، قبل از پرداخت</button>
      <button className="btn pri" onClick={finish}>خریدم؛ ثبت نتیجه</button>
      <div className="hint">بعد از خرید می‌پرسیم بود یا نه؛ جوابتان برای همه قیمت را به‌روز می‌کند.</div>
    </>
  ) : <button className="btn pri" onClick={() => go("confirm")}>برگشت به جواب فروشنده‌ها</button>;

  // what comes first matters on a phone: where I am going, then the map and the next step, then the stops and the details
  const head = (
    <>
      <div className="stack" style={{ gap: 2 }}><div className="xs faint">مسیر امروز</div>
        <h2 style={{ margin: 0, fontSize: desk ? 24 : 20, fontWeight: 800 }}>{plan.isLoading ? "…" : stops.length ? `${fa(stops[0].walk_min_from_previous)} دقیقه تا ${stops[0].name}${stops.length > 1 ? "؛ یک جایگزین هم کنارش هست" : ""}` : "مسیری نداریم"}</h2></div>
      {banner && <Note tone={banner.tone} icon={banner.icon}>{banner.t}</Note>}
      {plan.isError && <Note tone="unk" icon="store">هنوز هیچ فروشگاهی نگفته که کالا موجود است؛ به مرحلهٔ تأیید برگردید.</Note>}
    </>
  );
  const tail = (
    <>
      {line}{main && <details className="mc-card steps-d" style={{ padding: "10px 14px" }}><summary className="b sm" style={{ cursor: "pointer" }}>مسیر قدم‌به‌قدم تا {main.name}</summary><div style={{ marginTop: 10 }}><RouteSteps from={{ lat: m.place.lat, lon: m.place.lon }} to={{ lat: main.lat, lon: main.lon }} mode={m.mode} /></div></details>}{main && <FinalSteps stop={main} card={cardOf(main.shop_id)} onFloors={() => setStack(true)} />}{main && m.productId && <Extras m={m} mallKey={cardOf(main.shop_id)?.mall_key} mall={main.mall} />}{actions}{check}
    </>
  );
  const stepsDetails = main && <details className="mc-card steps-d" style={{ padding: "10px 14px" }}><summary className="b sm" style={{ cursor: "pointer" }}>مسیر قدم‌به‌قدم تا {main.name}</summary><div style={{ marginTop: 10 }}><RouteSteps from={{ lat: m.place.lat, lon: m.place.lon }} to={{ lat: main.lat, lon: main.lon }} mode={m.mode} /></div></details>;
  // phone: the map, then the one thing to do now («I'm here»), then the stops; the long last-100-metres guide stays folded until you reach the mall
  const phoneTail = (
    <>
      {actions}{line}{stepsDetails}
      {main && <details className="mc-card steps-d" style={{ padding: "10px 14px" }} open={arrived || undefined}><summary className="b sm" style={{ cursor: "pointer" }}>آخرین ۱۰۰ متر: از در پاساژ تا فروشگاه</summary><div style={{ marginTop: 10 }}><FinalSteps stop={main} card={cardOf(main.shop_id)} onFloors={() => setStack(true)} /></div></details>}
      {main && m.productId && <Extras m={m} mallKey={cardOf(main.shop_id)?.mall_key} mall={main.mall} />}{check}
    </>
  );
  const body = <div className="stack" style={{ gap: 12 }}>{head}{tail}</div>;

  const mainCard = main ? cardOf(main.shop_id) : undefined;
  const mallQ = useQuery({ queryKey: ["mall", mainCard?.mall_key], queryFn: () => api.mall(mainCard!.mall_key!), enabled: !!mainCard?.mall_key, staleTime: 5 * 60_000 });
  useEffect(() => { if (arrived) Promise.resolve().then(() => setStack(true)); }, [arrived]); // reaching the mall opens the floor-by-floor view
  const arrival = main && <ArrivalSheet open={stack} onClose={() => setStack(false)} mall={mallQ.data} t={{ shopId: main.shop_id, name: main.name, mall: main.mall, floor: mainCard?.floor ?? null, floorLabel: main.floor_label ?? mainCard?.floor_label ?? null, unit: main.unit ?? mainCard?.unit ?? null, plaque: main.plaque ?? mainCard?.plaque ?? null, hold: main.hold }} />;
  const counterSheet = <CounterCheck open={counter} onClose={() => setCounter(false)} m={m} shopId={main?.shop_id ?? null} shopName={main?.name ?? ""} inquiryId={mainP?.q.id ?? null} confirmed={main?.confirmed_price ?? null} />;
  if (desk) {
    return <><Shell {...sp} patch={patchSlots} mapStage center={<div className="map-fill">{map ?? <div className="sk" style={{ height: "100%", borderRadius: 22 }} />}</div>} panel={body} cta={cta} />{counterSheet}{arrival}</>;
  }
  return <><Shell {...sp} patch={patchSlots} center={<div className="mc-main"><div className="mc-pad stack" style={{ gap: 12 }}>{head}{map && <div className="stack">{map}</div>}{phoneTail}</div></div>} cta={cta} />{counterSheet}{arrival}</>;
  void set;
}
