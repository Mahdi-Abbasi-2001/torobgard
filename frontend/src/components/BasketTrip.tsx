"use client";
// One trip for the whole basket: the fewest stops that cover the items (each bought where it is cheapest among them), the walk between them
// on the map, «ask every stop at once», and then the stops one after another with the in-app route. The items are the trip's basket.
import dynamic from "next/dynamic";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type Inquiry } from "@/lib/api";
import { fa, money } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { useInquiries } from "@/lib/useInquiries";
import { Icon } from "@/components/Icon";
import type { BasketPin } from "@/components/BasketMap";
import { Bidi, Note } from "@/components/ui";
import { shortName } from "@/components/mission/DecideStage";

export const ITEM_COLORS = ["#2F6FED", "#B45309", "#6D28D9", "#17803D", "#C2410C", "#0E7490"];
const BasketMap = dynamic(() => import("@/components/BasketMap"), { ssr: false, loading: () => <div className="sk" style={{ height: 380, borderRadius: 22 }} /> });
const RouteMap = dynamic(() => import("@/components/RouteMap"), { ssr: false, loading: () => <div className="sk" style={{ height: 420, borderRadius: 22 }} /> });
const BASE = ["stock", "price"];
const waiting = (q?: Inquiry) => !q || q.status === "sent" || q.status === "delivered";

export function BasketTrip({ items }: { items: { productId: string; title: string }[] }) {
  const { sid, state } = useSession();
  const qc = useQueryClient();
  const [flat, setFlat] = useState(false);
  const [leg, setLeg] = useState<number | null>(null); // the stop being walked to
  const place = state.place;
  const ids = items.map((i) => i.productId);
  const idx = (pid: string) => Math.max(0, ids.indexOf(pid));
  const color = (pid: string) => ITEM_COLORS[idx(pid) % ITEM_COLORS.length];

  const plan = useQuery({ queryKey: ["bk-plan", ids.join(), place.lat, place.lon, state.when], enabled: ids.length > 0, staleTime: 60_000,
    queryFn: () => api.basketPlan({ product_ids: ids, lat: place.lat, lon: place.lon, when: state.when }) });
  const stops = useMemo(() => plan.data?.stops ?? [], [plan.data]);
  const legsQ = useQueries({ queries: stops.map((s, i) => ({ queryKey: ["bk-leg", i === 0 ? `${place.lat},${place.lon}` : stops[i - 1].shop_id, s.shop_id], staleTime: 10 * 60_000,
    queryFn: () => api.route(i === 0 ? place : stops[i - 1], s, "walk") })) });
  const legsKey = legsQ.map((l) => l.dataUpdatedAt).join(); // a leg changes when its route lands
  const legs = useMemo(() => legsQ.map((l) => l.data?.points ?? []), [legsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const pins: BasketPin[] = stops.map((s, i) => ({ id: s.shop_id, n: i + 1, name: s.name.split(/\s+/).slice(0, 3).join(" "), lat: s.lat, lon: s.lon, badges: s.items.map((it) => ({ n: fa(idx(it.product_id) + 1), color: color(it.product_id) })) }));

  const inq = useInquiries(sid);
  const answer = (shop: string, pid: string) => inq.items.filter((i) => i.kind === "ask" && i.shop?.shop_id === shop && i.product?.product_id === pid).sort((a, b) => (b.created_at > a.created_at ? 1 : -1))[0];
  const asked = stops.length > 0 && stops.every((s) => s.items.every((it) => !!answer(s.shop_id, it.product_id)));
  const askAll = useMutation({
    mutationFn: async () => { for (const s of stops) for (const it of s.items) if (!answer(s.shop_id, it.product_id)) await api.createInquiries({ session_id: sid, shop_ids: [s.shop_id], product_id: it.product_id, questions: BASE, timeout_s: 300 }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inquiries", sid] }),
  });
  const allIn = asked && stops.every((s) => s.items.every((it) => !waiting(answer(s.shop_id, it.product_id))));
  const from = leg == null ? null : leg === 0 ? place : stops[leg - 1];
  const stop = leg == null ? null : stops[leg];

  if (!ids.length) return <Note tone="unk" icon="bag">هنوز کالایی در سبد نیست.</Note>;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {items.map((it, i) => <span key={it.productId} className="bk-chip"><i style={{ background: ITEM_COLORS[i % ITEM_COLORS.length] }}>{fa(i + 1)}</i><Bidi text={it.title} /></span>)}
      </div>
      {plan.isLoading && <div className="sk" style={{ height: 120, borderRadius: 18 }} />}
      {plan.data && plan.data.uncovered.length > 0 && <Note tone="unk" icon="store">{plan.data.uncovered.map((u) => u.title).join("، ")}: هیچ فروشگاهی این را با قیمت ثبت نکرده؛ برای این‌ها باید جداگانه بگردی.</Note>}
      {stops.length > 0 && (
        <>
          <div className="row between" style={{ alignItems: "flex-end" }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{fa(stops.length)} توقف{stops.length === 1 ? "، همه‌چیز یک‌جا" : ""}، حدود {fa(plan.data!.total_walk_min)} دقیقه راه</h3>
            <span className="xs faint">جمع قیمت‌های ثبت‌شده: {money(plan.data!.total_price)} تومان</span>
          </div>
          {leg == null ? (flat ? <div className="ap-flat" style={{ height: 120 }}>نقشهٔ سه‌بعدی بارگذاری نشد؛ توقف‌ها را در فهرست ببینید.</div> : <BasketMap origin={place} pins={pins} legs={legs} height={360} onUnavailable={() => setFlat(true)} />)
            : from && stop && <RouteMap key={leg} from={from} to={stop} label={stop.name} mode="walk" height={400} />}
          <div className="stack" style={{ gap: 10 }}>
            {stops.map((s, i) => (
              <div key={s.shop_id} className="bk-stop" style={leg === i ? { borderColor: "var(--accent)" } : undefined}>
                <div className="row between"><b>توقف {fa(i + 1)}: <Bidi text={s.name} /></b><span className="xs faint">{fa(s.walk_min_from_prev)} دقیقه {i === 0 ? "از اینجا" : "از توقف قبل"}</span></div>
                <span className="xs muted">{[s.mall, s.floor_label && fa(s.floor_label), s.unit ? `واحد ${fa(s.unit)}` : s.plaque ? `پلاک ${fa(s.plaque)}` : null].filter(Boolean).join("، ")}{s.open ? `، ${s.open}` : ""}</span>
                {s.items.map((it) => {
                  const a = answer(s.shop_id, it.product_id);
                  return (
                    <div key={it.product_id} className="bk-row"><i style={{ background: color(it.product_id) }}>{fa(idx(it.product_id) + 1)}</i><span className="grow"><Bidi text={shortName({ title: it.title, brand: null })} /></span>
                      <span className="sm b">{money(a?.answer?.price ?? it.price)}</span>
                      {a && <span className={`tb ${a.status === "answered" && a.answer?.available !== false ? "ok" : a.status === "unavailable" ? "unk" : "info"}`}>{a.status === "answered" && a.answer?.available !== false ? "تأیید شد" : a.status === "unavailable" ? "ندارد" : a.status === "no_reply" ? "بی‌پاسخ" : "پرسیده شد"}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {!asked && <button type="button" className="btn pri" disabled={askAll.isPending || !sid} onClick={() => askAll.mutate()}>{askAll.isPending ? <span className="spin" style={{ borderTopColor: "var(--on-accent)" }} /> : <Icon n="send" s />}از همهٔ توقف‌ها بپرس</button>}
            {asked && !allIn && <span className="toolline"><span className="spin" />منتظر جواب فروشنده‌ها…</span>}
            {allIn && leg == null && <button type="button" className="btn pri" onClick={() => setLeg(0)}><Icon n="walk" s />شروع مسیر</button>}
            {leg != null && leg < stops.length - 1 && <button type="button" className="btn pri" onClick={() => setLeg(leg + 1)}>رسیدم؛ توقف بعدی</button>}
            {leg != null && leg === stops.length - 1 && <button type="button" className="btn pri" onClick={() => setLeg(null)}>همه را گرفتم</button>}
            {leg != null && <button type="button" className="btn sec" onClick={() => setLeg(null)}>برگشت به نقشهٔ سفر</button>}
          </div>
          {askAll.isError && <Note tone="bad" icon="alert">{(askAll.error as Error).message}</Note>}
        </>
      )}
    </div>
  );
}
