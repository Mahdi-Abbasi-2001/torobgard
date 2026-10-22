"use client";
// Step 4a (canvas F5 / D4): the shops are being asked, a few at a time, and each answer ripens its row: listed → asked → confirmed → held.
// A shop that says no is replaced by the next one on its own; the shopper can read the conversation, ask the seller to hold the item,
// ask the others to re-check before leaving, or call a shop that stays silent.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ShopCard } from "@/lib/api";
import { fa } from "@/lib/fa";
import { useIsDesktop } from "@/lib/media";
import { useSession } from "@/lib/session";
import { useNow } from "@/lib/useInquiries";
import type { ShopProgress } from "@/lib/useMissionStatus";
import { Icon } from "@/components/Icon";
import { ShopMap } from "@/components/ShopMap";
import { AltBody } from "@/components/alternatives";
import { CallScript, CampaignBanner, NotifyOptIn } from "@/components/followup";
import { Bidi, Note, Sheet, Toggle } from "@/components/ui";
import { AskSheet } from "./AskSheet";
import { ChatSheet, HoldSheet } from "./ConfirmSheets";
import { QueuedRow, RipeLegend, ShopRow } from "./ShopRow";
import { Shell } from "./chrome";
import type { StageProps } from "./stage";
import { shortName } from "./DecideStage";

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== "0";

export default function ConfirmStage(sp: StageProps) {
  const { m, status, set, go, patchSlots } = sp;
  const desk = useIsDesktop();
  const { sid, update } = useSession();
  const qc = useQueryClient();
  const now = useNow();
  const pid = m.productId!;
  const [chat, setChat] = useState<string | null>(null);
  const [holdId, setHoldId] = useState<string | null>(null);
  const [altId, setAltId] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [autoAlt, setAutoAlt] = useState<boolean | null>(null);
  const { items, camp } = status;
  const byId = (id: string | null) => items.find((x) => x.q.id === id) ?? null;

  const shops = useQuery({ queryKey: ["pshops-all", pid, m.place.lat], queryFn: () => api.productShops(pid, m.place, { sort: "best" }, 100, m.when) });
  const sess = useQuery({ queryKey: ["session-state", sid], queryFn: () => api.getSession(sid), enabled: !!sid });
  const auto = autoAlt ?? !!sess.data?.auto_alternatives;
  const all: ShopCard[] = useMemo(() => (shops.data ? [...shops.data.listed, ...shops.data.category_only] : []), [shops.data]);
  const cardOf = (id: string | undefined) => all.find((s) => s.shop_id === id);

  const stop = useMutation({ mutationFn: (id: string) => api.stopCampaign(sid, id), onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", sid] }) });
  const recheck = useMutation({
    mutationFn: (p: ShopProgress) => api.recheck(sid, p.q.id, cardOf(p.q.shop?.shop_id)?.walk_min ?? null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inquiries", sid] }),
  });
  const askMore = useMutation({
    mutationFn: (ids: string[]) => api.createInquiries({ session_id: sid, shop_ids: ids, product_id: pid, questions: items[0]?.q.questions.map((q) => q.key) ?? ["stock", "price"] }),
    onSuccess: () => { setAltId(null); qc.invalidateQueries({ queryKey: ["inquiries", sid] }); },
  });
  const setAuto = (v: boolean) => { setAutoAlt(v); api.putSession(sid, { auto_alternatives: v }).catch(() => {}); };

  // a row that just changed state flashes once
  const seen = useRef(new Map<string, string>());
  const [flash, setFlash] = useState<string | null>(null);
  const sig = items.map((x) => `${x.q.id}:${x.q.status}:${x.ripeness}`).join("|");
  useEffect(() => {
    let hit: string | null = null;
    items.forEach((x) => {
      const k = `${x.q.status}:${x.ripeness}`;
      if (seen.current.has(x.q.id) && seen.current.get(x.q.id) !== k) hit = x.q.id;
      seen.current.set(x.q.id, k);
    });
    if (!hit) return;
    const id = hit;
    setFlash(id);
    const t = setTimeout(() => setFlash((f) => (f === id ? null : f)), 1500);
    return () => clearTimeout(t);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps -- sig is items' state

  const best = status.best;
  const unasked = [...all].filter((s) => m.picks.includes(s.shop_id) && !items.some((x) => x.q.shop?.shop_id === s.shop_id));
  const queued = (camp?.status === "running" ? camp.next : []).filter((n) => !items.some((x) => x.q.shop?.shop_id === n.shop_id));
  const simulated = items.some((x) => x.q.answer?.simulated);
  const questionLine = items[0]?.q.questions.map((q) => q.text).join(" ");

  // map (desktop): the pins ripen with the answers
  const labels: Record<string, string> = {}, states: Record<string, string> = {};
  items.forEach((x) => {
    const id = x.q.shop!.shop_id;
    labels[id] = x.ripeness >= 3 && x.q.answer?.price ? `${fa((x.q.answer.price / 1e6).toFixed(2).replace(/0$/, "").replace(".", "٫"))} م` : x.ripeness === 0 ? (x.q.status === "no_reply" ? "بی‌پاسخ" : "تمام شد") : x.ripeness === 2 ? "پرسیدن…" : "";
    states[id] = x.ripeness === 4 ? "held" : x.ripeness === 3 ? "confirmed" : x.ripeness === 2 ? "asked" : "gone";
  });
  Object.keys(labels).forEach((k) => { if (!labels[k]) delete labels[k]; });
  const mapListed = all.filter((s) => items.some((x) => x.q.shop?.shop_id === s.shop_id));

  const wave = camp ? (camp.status === "done" ? `${fa(camp.confirmed)} فروشگاه تأیید کرد؛ بقیه را نپرسیدیم` : camp.status === "running" ? `هر بار از ${fa(camp.wave)} فروشگاه می‌پرسیم` : "پرسیدن تمام شد") : status.headline;

  const rows = (
    <div className="stack" style={{ gap: 10 }}>
      {items.map((x) => (
        <ShopRow key={x.q.id} p={x} listed={cardOf(x.q.shop?.shop_id)} now={now} flash={flash === x.q.id}
          onChat={() => setChat(x.q.id)} onHold={() => setHoldId(x.q.id)} onAlt={() => setAltId(x.kids.find((k) => k.kind === "recheck" && k.status === "unavailable")?.id ?? x.q.id)}
          onCall={() => setCallId(x.q.id)} onRecheck={() => recheck.mutate(x)} />
      ))}
      {queued.map((n) => <QueuedRow key={n.shop_id} name={n.name} why={n.why} listed={cardOf(n.shop_id)} />)}
      {!items.length && !camp && <Note tone="unk" icon="send">هنوز از هیچ فروشگاهی نپرسیده‌اید؛ به مقایسه برگردید و چند فروشگاه را انتخاب کنید.</Note>}
      <RipeLegend />
    </div>
  );

  const head = (
    <div className="mc-pad row between" style={{ alignItems: "flex-start", marginTop: desk ? 0 : 4 }}>
      <div><h2 style={{ margin: 0, fontSize: desk ? 24 : 19, fontWeight: 800 }}>جواب فروشنده‌ها</h2><div className="xs faint">{wave}</div></div>
      <span className={`oc ${status.connected ? "open" : "unknown"}`}>{status.connected ? "زنده" : "در حال اتصال…"}</span>
    </div>
  );
  const extras = (
    <div className="stack" style={{ gap: 10 }}>
      {camp && camp.status === "running" && <CampaignBanner c={camp} onStop={() => stop.mutate(camp.id)} stopping={stop.isPending} />}
      {questionLine && (
        <div className="mc-card" style={{ padding: "10px 14px", gap: 6 }}>
          <span className="xs muted" style={{ lineHeight: 1.7 }}>سؤال: «<Bidi text={questionLine} />»</span>
          {unasked.length > 0 && <button type="button" className="mc-links" style={{ background: "none", border: 0, justifyContent: "flex-start", display: "flex" }} onClick={() => setAskOpen(true)}>از {fa(unasked.length)} فروشگاه دیگرِ فهرست هم بپرسید</button>}
        </div>
      )}
      <div className="card frow" style={{ padding: "10px 12px", gap: 10 }}>
        <div className="grow"><div className="sm b">اگر جایی نداشت، خودکار از فروشگاه بعدی بپرس</div><div className="xs faint">تا ۶ فروشگاه دیگر، فقط همین کالا</div></div>
        <Toggle on={auto} onChange={setAuto} label="پرسیدن خودکار از جایگزین‌ها" />
      </div>
      <NotifyOptIn sid={sid} />
      {(simulated || DEMO) && items.length > 0 && <Note tone="info" icon="spark"><b>این جواب‌ها نمایشی‌اند.</b> فروشندهٔ نمایشی مثل آدم واقعی می‌نویسد؛ ترب‌گرد جوابش را می‌خواند و اگر چیزی کم باشد دوباره می‌پرسد.</Note>}
    </div>
  );

  const start = () => { set({ going: true }); go("go"); };
  const cta = status.held ? (
    <>
      <button className="btn pri" onClick={start}>شروع مسیر</button>
      <div className="hint">{shortName(m.product ?? { title: "", brand: null })} کنار گذاشته شد؛ کد را در فروشگاه بگویید</div>
    </>
  ) : best ? (
    <>
      <button className="btn pri" onClick={() => setHoldId(best.q.id)}><Icon n="hold" s />از {best.q.shop?.name} بخواه نگه دارد</button>
      <div className="mc-links"><button type="button" onClick={start}>بدون نگه داشتن، مسیر را ببین</button><button type="button" onClick={() => go("compare")}>فروشگاه‌های دیگر</button></div>
    </>
  ) : (
    <>
      <button className="btn pri" disabled><span className="spin" style={{ borderTopColor: "var(--on-accent)" }} />منتظر جواب فروشنده‌ها…</button>
      <div className="mc-links"><button type="button" onClick={() => go("compare")}>برگشت به فهرست</button></div>
    </>
  );

  const sheets = (
    <>
      <ChatSheet item={byId(chat)} onClose={() => setChat(null)} />
      <HoldSheet item={byId(holdId)} onClose={() => setHoldId(null)} onGo={() => { setHoldId(null); start(); }} />
      <Sheet open={!!altId} onClose={() => setAltId(null)} label="جایگزین‌ها">
        {altId && (() => { const q = status.items.flatMap((x) => [x.q, ...x.kids]).find((x) => x.id === altId); return q ? <AltBody q={q} onAsk={(ids) => askMore.mutate(ids)} pending={askMore.isPending} /> : null; })()}
      </Sheet>
      <Sheet open={!!callId} onClose={() => setCallId(null)} label="تماس">
        {callId && byId(callId) && <CallScript q={byId(callId)!.q} sid={sid} onDone={() => { setCallId(null); setToast("ثبت شد؛ بقیهٔ خریدارها هم می‌بینند."); setTimeout(() => setToast(null), 4000); qc.invalidateQueries({ queryKey: ["pshops-all"] }); }} />}
      </Sheet>
      <AskSheet open={askOpen} onClose={() => setAskOpen(false)} m={{ ...m, picks: unasked.map((s) => s.shop_id) }} shops={unasked} onSent={() => qc.invalidateQueries({ queryKey: ["inquiries", sid] })} />
      {toast && <div className="toast" role="status"><Icon n="check" /><span>{toast}</span></div>}
    </>
  );
  void update;

  if (desk) {
    return (
      <>
        <Shell {...sp} patch={patchSlots} mapStage
          center={<div className="map-fill">{mapListed.length > 0 ? <ShopMap origin={m.place} listed={mapListed} cat={[]} selected={[]} labels={labels} states={states} height="100%" /> : <div className="sk" style={{ height: "100%", borderRadius: 22 }} />}</div>}
          panel={<div className="stack" style={{ gap: 12 }}>{head}{rows}{extras}</div>}
          cta={cta} />
        {sheets}
      </>
    );
  }
  return (
    <>
      <Shell {...sp} patch={patchSlots}
        center={<div className="mc-main">{head}<div className="mc-pad stack" style={{ gap: 12 }}>{rows}{extras}</div></div>}
        cta={cta} />
      {sheets}
    </>
  );
}
