"use client";
// Autopilot (the hero): one sentence in, and the errand runs itself. The app picks the model (the leader of the duel, with the model's one-line
// reason), asks the shops the advisor chose, narrates every answer as it arrives, and stops only where the shopper must decide: hold the item
// or go. Everything it does is the same call the manual stages make, so «I'll do it myself» drops into the normal flow at the same point.
// Layout: desktop is mission control (what I did | the market, live | what the sellers said); phone is the map with the story under it.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type ShopCard } from "@/lib/api";
import { fa, mil } from "@/lib/fa";
import { useIsDesktop } from "@/lib/media";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import type { MarketPin } from "@/components/MarketMap";
import { Bidi } from "@/components/ui";
import { useAsk } from "./AskSheet";
import { HoldSheet, NegotiateSheet } from "./ConfirmSheets";
import { shortName } from "./DecideStage";
import { filtersOf, seedPicks } from "./FindStage";
import { BasketStrip } from "./BasketStrip";
import { MissionBar } from "./chrome";
import { slotSummary } from "./slots";
import type { StageProps } from "./stage";

const MarketMap = dynamic(() => import("@/components/MarketMap"), { ssr: false, loading: () => <div className="sk" style={{ height: "100%", minHeight: 240, borderRadius: 22 }} /> });

type Line = { id: string; text: string; tone: "do" | "ok" | "bad" | "ask" };
const BASE = ["stock", "price"];
const STEPS = ["خواسته", "کالا", "پرسیدن", "تصمیم", "رفتن"];
const fixed = (n: number) => fa((n / 1e6).toFixed(2).replace(/0$/, "").replace(".", "٫"));

export default function AutopilotStage(sp: StageProps) {
  const { m, status, set, go } = sp;
  const desk = useIsDesktop();
  const { sid } = useSession();
  const ask = useAsk(m);
  const [log, setLog] = useState<Line[]>([]);
  const [stuck, setStuck] = useState<string | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [bargain, setBargain] = useState(false);
  const [flat, setFlat] = useState(false);
  const qc = useQueryClient();
  const ran = useRef({ plan: false, ask: false });
  const [plan, setPlan] = useState<string[] | null>(null); // the shops it would message: nothing is sent until the shopper says so
  const [approved, setApproved] = useState(false);
  const pid = m.productId;
  const { items, camp } = status;

  const say = useCallback((id: string, text: string, tone: Line["tone"] = "do") => setLog((l) => (l.some((x) => x.id === id) ? l : [...l, { id, text, tone }])), []);

  // the shops that list the chosen model: first shown as quiet dots, then lit up by their answers
  const shops = useQuery({ queryKey: ["ap-shops", pid, m.place.lat, m.place.lon, m.when, m.cond], enabled: !!pid, staleTime: 60_000, queryFn: () => api.productShops(pid!, m.place, filtersOf(m), 40, m.when) });
  const listed = useMemo(() => shops.data?.listed ?? [], [shops.data]);
  const cardOf = (id: string | undefined): ShopCard | undefined => [...listed, ...(shops.data?.category_only ?? [])].find((s) => s.shop_id === id);

  // 2) the advisor chooses the shops to ask; the shopper approves; then all are asked at once so the answers come in side by side
  useEffect(() => {
    if (!pid || ran.current.plan || !sid || status.loading || status.asked > 0 || camp || !shops.data) return;
    ran.current.plan = true;
    (async () => {
      let ids = seedPicks(listed);
      try {
        const adv = await api.advise({ product_id: pid, lat: m.place.lat, lon: m.place.lon, when: m.when, need: m.need, priority: m.priority, budget_max: m.budgetMax, installment: m.cond.installment });
        if (adv.picks.length) ids = adv.picks.map((p) => p.shop_id);
      } catch { /* the catalogue's own ranking is the fallback */ }
      if (!ids.length) { setStuck("هیچ فروشگاهی نزدیک شما این مدل را ثبت نکرده."); say("ask-none", "فروشگاهی برای پرسیدن پیدا نشد.", "bad"); return; }
      set({ picks: ids });
      setPlan(ids);
    })();
  }, [pid, sid, status.loading, status.asked, camp, shops.data]); // eslint-disable-line react-hooks/exhaustive-deps -- runs once, when the shops are known
  useEffect(() => {
    if (!plan || !approved || ran.current.ask) return;
    ran.current.ask = true;
    say("ask-0", `از ${fa(plan.length)} فروشگاه نزدیک همزمان پرسیدم: موجود است؟ قیمت امروز؟`, "ask");
    const catOnly = plan.some((id) => cardOf(id)?.tier === "category_only");
    ask.mutate({ shopIds: plan, keys: catOnly ? [...BASE, "hours"] : BASE, custom: {}, mode: "direct", timeout: 300 }, { onError: (e) => setStuck((e as Error).message) });
  }, [plan, approved]); // eslint-disable-line react-hooks/exhaustive-deps -- sends once, on approval

  // a shop that stayed silent is asked once more on a second channel (an automated call), the same question the shopper already approved
  const called = useRef(new Set<string>());
  useEffect(() => {
    items.forEach((x) => {
      if (x.q.status !== "no_reply" || x.q.via_call || called.current.has(x.q.id)) return;
      called.current.add(x.q.id);
      say(`call-${x.q.id}`, `${x.q.shop?.name ?? "فروشگاه"} به پیام جواب نداد؛ همین سؤال را با تماس خودکار دوباره پرسیدم.`, "ask");
      api.escalate(sid || "anon", x.q.id).then(() => qc.invalidateQueries({ queryKey: ["inquiries", sid] })).catch(() => {});
    });
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps -- once per silent shop

  // 3) every answer is said out loud, once
  const sig = items.map((x) => `${x.q.id}:${x.q.status}:${x.ripeness}:${x.kids.map((k) => k.id + k.status).join(",")}`).join("|");
  useEffect(() => {
    items.forEach((x) => {
      const id = x.q.shop?.shop_id ?? x.q.id, name = x.q.shop?.name ?? "فروشگاه", price = x.q.answer?.price;
      if (x.ripeness === 4) say(`held-${id}`, `${name} قبول کرد برایتان نگه دارد.`, "ok");
      else if (x.ripeness === 3) say(`ok-${id}`, `${name} تأیید کرد${price ? `: ${mil(price)} تومان` : ""}.`, "ok");
      else if (x.q.status === "unavailable" || x.gone) say(`gone-${id}`, `${name} ندارد؛ کنارش گذاشتم.`, "bad");
      else if (x.q.status === "no_reply" && x.q.via_call) say(`silent-${id}`, `${name} به تماس هم جواب نداد؛ کنارش گذاشتم.`, "bad");
      x.kids.filter((k) => k.kind === "bargain").forEach((k) => {
        if (k.status === "sent" || k.status === "delivered") say(`bg-sent-${k.id}`, `پیشنهاد شما${k.target ? ` (${mil(k.target)} تومان)` : ""} را برای ${name} فرستادم.`, "ask");
        else if (k.answer?.bargain_accepted) say(`bg-${k.id}`, `${name} پیشنهاد شما را پذیرفت: ${mil(k.answer.price ?? k.target ?? 0)} تومان.`, "ok");
        else say(`bg-${k.id}`, `${name} پیشنهاد شما را نپذیرفت${k.answer?.price ? `؛ گفت ${mil(k.answer.price)} تومان` : ""}؛ قیمت قبلی سر جایش است.`, "bad");
      });
    });
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps -- sig is items' state

  const settled = status.asked > 0 && status.waiting === 0 && camp?.status !== "running";
  const best = status.best;
  const deciding = !status.held && !!best && (settled || status.confirmed >= 2);
  const failed = settled && !best && !status.held;
  const step = status.held ? 4 : deciding ? 3 : pid ? 2 : 1;

  // pins: quiet dots for the shops that list it, lit by their answers
  const pins: MarketPin[] = useMemo(() => {
    const byShop = new Map(items.map((x) => [x.q.shop?.shop_id, x]));
    const cards = [...listed.slice(0, 10), ...items.map((x) => cardOf(x.q.shop?.shop_id)).filter((c): c is ShopCard => !!c)];
    const seen = new Set<string>();
    return cards.filter((c) => !seen.has(c.shop_id) && seen.add(c.shop_id)).map((c) => {
      const x = byShop.get(c.shop_id);
      const st: MarketPin["state"] = !x ? "idle" : x.ripeness === 4 ? "held" : x.ripeness === 3 ? "confirmed" : x.ripeness === 2 ? "asked" : "gone";
      const label = !x ? "" : x.ripeness >= 3 && x.q.answer?.price ? `${fixed(x.q.answer.price)} م` : x.ripeness === 0 ? (x.q.status === "no_reply" ? "بی‌پاسخ" : "تمام شد") : x.ripeness === 2 ? "پرسیدن…" : "";
      return { id: c.shop_id, name: c.name.split(/\s+/).slice(0, 3).join(" "), lat: c.lat, lon: c.lon, state: st, label };
    });
  }, [listed, items, shops.data]); // eslint-disable-line react-hooks/exhaustive-deps -- cardOf reads shops.data

  const bestId = best && (settled || status.confirmed >= 2) ? best.q.shop?.shop_id ?? null : null;
  const manual = () => { set({ auto: false }); };
  const start = () => { set({ going: true, auto: false }); go("go"); };
  const bestCard = cardOf(best?.q.shop?.shop_id);

  const map = pins.length > 0 && !flat
    ? <MarketMap origin={m.place} pins={pins} bestId={bestId} asking={status.waiting > 0} height="100%" onUnavailable={() => setFlat(true)} />
    : pins.length === 0 && !flat ? <MarketMap origin={m.place} pins={[]} bestId={null} asking={false} height="100%" onUnavailable={() => setFlat(true)} />
    : <div className="ap-flat">نقشهٔ سه‌بعدی بارگذاری نشد؛ جواب‌ها را در فهرست ببینید.</div>;

  const story = (
    <div className="ap-log" aria-live="polite">
      <div className="ap-head"><span className="ap-dot" />کاری که تا اینجا کردم</div>
      <ol>
        {log.map((l) => <li key={l.id} className={`ap-line ${l.tone}`}><span className="d" /><span><Bidi text={l.text} /></span></li>)}
        {!stuck && !deciding && !failed && !status.held && <li className="ap-line wait"><span className="spin" />{!pid ? "دارم می‌فهمم چه می‌خواهید…" : plan && !approved ? "منتظر تأیید شما هستم…" : status.asked === 0 ? "دارم فروشگاه‌ها را می‌چینم…" : "منتظر جواب فروشنده‌ها هستم؛ معمولاً چند دقیقه طول می‌کشد. می‌توانید صفحه را ببندید؛ جواب‌ها در «خریدهای من» می‌ماند و اگر اعلان را اجازه داده باشید، همین که جواب برسد خبرتان می‌کنیم."}</li>}
      </ol>
    </div>
  );

  const replies = (
    <div className="ap-replies">
      <div className="ap-head">جواب فروشنده‌ها</div>
      {items.length === 0 && <div className="xs faint">هنوز سؤالی نفرستاده‌ام.</div>}
      {items.map((x) => {
        const a = x.q.answer; const c = cardOf(x.q.shop?.shop_id);
        const ok = x.ripeness >= 3, gone = x.ripeness === 0;
        return (
          <div key={x.q.id} className={`ap-reply ${ok ? "ok" : gone ? "gone" : ""}`}>
            <div className="row between"><b className="sm"><Bidi text={x.q.shop?.name ?? ""} /></b><span className="xs faint">{c?.walk_min != null ? `${fa(c.walk_min)} دقیقه پیاده` : ""}</span></div>
            <span className="xs muted" style={{ lineHeight: 1.7 }}>{a?.summary ? <Bidi text={a.summary} /> : a?.message ? `«${a.message}»` : x.q.status === "no_reply" ? "جواب نداد" : "منتظر جواب…"}</span>
            <span className={`tb ${ok ? "ok" : gone ? "unk" : "info"}`}>{x.ripeness === 4 ? "نگه داشته" : ok ? `تأیید شد${a?.price ? `، ${mil(a.price)}` : ""}` : gone ? "کنار گذاشته شد" : "پرسیده شد"}</span>
          </div>
        );
      })}
    </div>
  );

  // the decision: the one place the autopilot waits for you
  const confirmAsk = plan && !approved && status.asked === 0 ? (
    <div className="ap-card dark">
      <span className="xs" style={{ color: "#c9ccd6" }}>قبل از اینکه چیزی بفرستم</span>
      <div className="ap-title">از این {fa(plan.length)} فروشگاه می‌پرسم «موجود است؟ قیمت امروز؟»</div>
      <ul className="ap-plan">{plan.map((id) => { const c = cardOf(id); return <li key={id}><b><Bidi text={c?.name ?? "فروشگاه"} /></b><span>{c?.walk_min != null ? `${fa(c.walk_min)} دقیقه پیاده` : ""}{c?.stock && c.stock.level !== "unknown" ? ` · احتمال موجود بودن: ${c.stock.label}` : ""}</span></li>; })}</ul>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn pri grow" onClick={() => { setApproved(true); try { if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission(); } catch { /* no notifications: the page still shows every answer */ } }}>بپرس</button>
        <button className="btn sec" style={{ background: "transparent", color: "#fff", borderColor: "#4a4f60" }} onClick={manual}>خودم انتخاب می‌کنم</button>
      </div>
    </div>
  ) : null;
  const decision = confirmAsk ?? (status.held ? (
    <div className="ap-card dark">
      <span className="xs" style={{ color: "#c9ccd6" }}>برایتان نگه داشته شد</span>
      <div className="ap-title">{status.held.q.shop?.name}، کد نگه‌داری: <b className="num">{fa(status.held.hold?.code ?? "")}</b></div>
      <button className="btn pri" onClick={start}>شروع مسیر</button>
    </div>
  ) : deciding && best ? (
    <div className="ap-card dark">
      <span className="xs" style={{ color: "#c9ccd6" }}>فقط همین تصمیم با شماست</span>
      <div className="ap-title">{(() => {
        const listed = best.q.answer?.price ?? null, deal = best.deal && (!listed || best.deal < listed) ? best.deal : null;
        const where = `${best.q.shop?.name ?? ""}${bestCard?.mall ? `، ${bestCard.mall}` : ""}`, walk = bestCard?.walk_min != null ? ` ${fa(bestCard.walk_min)} دقیقه پیاده است.` : "";
        // with a bargain the shop did not «say it has it at that price»: it accepted the shopper's offer, and the earlier price is worth showing
        return deal
          ? <><Bidi text={where} /> پیشنهاد شما را پذیرفت: {mil(deal)} تومان{listed ? ` (قیمتی که اول گفته بود: ${mil(listed)})` : ""}.{walk} بگویم برایتان نگه دارد؟</>
          : <><Bidi text={where} /> موجود دارد{listed ? ` و قیمتش ${mil(listed)} تومان است` : ""}.{walk} بگویم برایتان نگه دارد؟</>;
      })()}</div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn pri grow" onClick={() => setHoldOpen(true)}><Icon n="hold" s />آره، نگه دارد</button>
        <button className="btn sec" style={{ background: "transparent", color: "#fff", borderColor: "#4a4f60" }} onClick={start}>نه، همین حالا می‌روم</button>
      </div>
      <button type="button" className="ap-link" onClick={() => setBargain(true)}>اول قیمت بهتر بگیر</button>
    </div>
  ) : failed || stuck ? (
    <div className="ap-card">
      <div className="ap-title">{stuck ?? "هیچ فروشگاهی تأیید نکرد."}</div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {failed && <button className="btn pri" onClick={() => { set({ auto: false }); go("find"); }}>فروشگاه‌های بیشتر را ببینید</button>}
        <button className={`btn ${failed ? "sec" : "pri"}`} onClick={manual}>خودم ادامه می‌دهم</button>
      </div>
    </div>
  ) : null);

  const rail = (
    <div className="ap-rail" aria-label="مرحله‌ها">
      {STEPS.map((s, i) => <div key={s}><span className={i < step ? "done" : i === step ? "now" : ""} /><em className={i === step ? "on" : ""}>{s}</em></div>)}
    </div>
  );

  return (
    <div className="mc ap">
      <MissionBar activeId={m.id} />
      <div className="ap-top">
        <span className="ap-badge"><Icon n="spark" s />خودکار</span>
        <span className="xs faint ap-hint">ترب‌گرد از فروشگاه‌ها می‌پرسد؛ فقط تصمیم آخر با شماست</span>
        <button type="button" className="ap-manual" onClick={manual}>خودم ادامه می‌دهم</button>
      </div>
      {rail}
      <div style={{ padding: "0 18px 8px" }}><BasketStrip m={m} /></div>
      {desk ? (
        <div className="ap-grid">
          <aside className="ap-col">{story}<div className="mc-slots"><span className="slot"><span className="k">خرید</span>{slotSummary(m) || "—"}</span></div></aside>
          <section className="ap-map">{map}<span className="ap-cap">فروشگاه‌های نزدیکی که این کالا را ثبت کرده‌اند؛ رنگ هر کدام وضعیت جوابش است</span></section>
          <aside className="ap-col">{decision}{replies}</aside>
        </div>
      ) : (
        <div className="ap-phone">
          <section className="ap-map">{map}</section>
          <div className="ap-sheet">{decision}{story}{items.length > 0 && replies}</div>
        </div>
      )}
      <NegotiateSheet open={bargain} onClose={() => setBargain(false)} items={items} title={shortName(m.product ?? { title: m.query, brand: null })} />
      <HoldSheet item={holdOpen && !status.held ? best : null} onClose={() => setHoldOpen(false)} onGo={() => { setHoldOpen(false); start(); }} />
    </div>
  );
}
