"use client";
// Autopilot (the hero): one sentence in, and the errand runs itself. The app picks the model (the leader of the duel, with the model's one-line
// reason), asks the shops the advisor chose, narrates every answer as it arrives, and stops only where the shopper must decide: hold the item
// or go. Everything it does is the same call the manual stages make, so «I'll do it myself» drops into the normal flow at the same point.
// Layout: desktop is mission control (what I did | the market, live | what the sellers said); phone is the map with the story under it.
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type ShopCard } from "@/lib/api";
import { fa, mil, money } from "@/lib/fa";
import { useIsDesktop } from "@/lib/media";
import { fitsNeed } from "@/lib/need";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import type { MarketPin } from "@/components/MarketMap";
import { Bidi } from "@/components/ui";
import { useAsk } from "./AskSheet";
import { HoldSheet, NegotiateSheet } from "./ConfirmSheets";
import { asMissionProduct, matchNeed, shortName } from "./DecideStage";
import { filtersOf, seedPicks } from "./FindStage";
import { BasketStrip } from "./BasketStrip";
import { MissionBar } from "./chrome";
import { slotSummary } from "./slots";
import type { StageProps } from "./stage";

const MarketMap = dynamic(() => import("@/components/MarketMap"), { ssr: false, loading: () => <div className="sk" style={{ height: "100%", minHeight: 240, borderRadius: 22 }} /> });

type Line = { id: string; text: string; tone: "do" | "ok" | "bad" | "ask" };
const BASE = ["stock", "price"];
const STEPS = ["جمله", "فهمیدن", "پرسیدن", "تصمیم", "رفتن"];
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
  const ran = useRef({ pick: false, ask: false });
  const pid = m.productId;
  const { items, camp } = status;

  const say = useCallback((id: string, text: string, tone: Line["tone"] = "do") => setLog((l) => (l.some((x) => x.id === id) ? l : [...l, { id, text, tone }])), []);

  // the shops that list the chosen model: first shown as quiet dots, then lit up by their answers
  const shops = useQuery({ queryKey: ["ap-shops", pid, m.place.lat, m.place.lon, m.when, m.cond], enabled: !!pid, staleTime: 60_000, queryFn: () => api.productShops(pid!, m.place, filtersOf(m), 40, m.when) });
  const listed = useMemo(() => shops.data?.listed ?? [], [shops.data]);
  const cardOf = (id: string | undefined): ShopCard | undefined => [...listed, ...(shops.data?.category_only ?? [])].find((s) => s.shop_id === id);

  // 1) pick the model
  useEffect(() => {
    if (m.productId || ran.current.pick || !sid) return;
    ran.current.pick = true;
    (async () => {
      say("pick-0", `دارم برای «${m.query}» در فروشگاه‌ها می‌گردم…`);
      try {
        const pres = m.category ? await api.presets(m.category).catch(() => null) : null;
        const preset = m.presetId === null ? matchNeed(pres?.presets, m.need) : pres?.presets.find((x) => x.id === m.presetId) ?? null;
        const res = await api.search({ q: m.query, category: m.category ?? undefined, price_min: m.budgetMin, price_max: m.budgetMax, limit: 30 }, m.place,
          { prefs: preset?.constraints, near_only: m.cond.near, installment_only: m.cond.installment, open_only: m.cond.open, sort: preset?.sort ?? null, when: m.when });
        const fit = res.items.filter((p) => fitsNeed(p.title, m.need));
        if (!fit.length) { setStuck(res.items.length ? `کالایی مخصوص «${m.need}» پیدا نشد.` : `«${m.query}» را در فروشگاه‌ها پیدا نکردم.`); say("pick-none", res.items.length ? `همهٔ نتیجه‌ها برای جنس دیگری بودند.` : "چیزی پیدا نشد.", "bad"); return; }
        if (res.applied.relaxed) { setStuck(`«${m.query}» را دقیقاً پیدا نکردم؛ نتیجه‌ها حدسی‌اند و خودتان باید انتخاب کنید.`); say("pick-relaxed", "فقط نتیجه‌های نزدیک پیدا شد، نه دقیق.", "bad"); return; }
        const ranked = [...fit].sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0) || (b.near?.near ?? 0) - (a.near?.near ?? 0) || b.shop_count - a.shop_count);
        let top = ranked.find((p) => p.shop_count >= 2) ?? ranked[0];
        const second = ranked.find((p) => p !== top && p.shop_count >= 2);
        let why = "";
        if (second && top.shop_count >= 2) {
          const v = await api.compareVerdict([top.product_id, second.product_id], preset?.label ?? m.need, m.place).catch(() => null);
          if (v) { if (v.pick === second.product_id) top = second; why = v.headline; }
        }
        set({ productId: top.product_id, product: asMissionProduct(top), champion: top.product_id, picks: [], extras: [], category: m.category ?? top.category });
        say("pick-done", `«${shortName(top)}» را انتخاب کردم${why ? `: ${why.replace(/[.۔]+$/, "")}` : `؛ ${fa(top.shop_count)} فروشگاه دارند`}.`, "ok");
      } catch (e) { setStuck((e as Error).message || "در انتخاب مدل مشکلی پیش آمد."); }
    })();
  }, [m.productId, sid]); // eslint-disable-line react-hooks/exhaustive-deps -- runs once per mission

  // 2) ask the shops the advisor chose, all at once, so the answers come in side by side
  useEffect(() => {
    if (!pid || ran.current.ask || !sid || status.loading || status.asked > 0 || camp || !shops.data) return;
    ran.current.ask = true;
    (async () => {
      let ids = seedPicks(listed);
      try {
        const adv = await api.advise({ product_id: pid, lat: m.place.lat, lon: m.place.lon, when: m.when, need: m.need, priority: m.priority, budget_max: m.budgetMax, installment: m.cond.installment });
        if (adv.picks.length) ids = adv.picks.map((p) => p.shop_id);
      } catch { /* the catalogue's own ranking is the fallback */ }
      if (!ids.length) { setStuck("هیچ فروشگاهی نزدیک شما این مدل را ثبت نکرده."); say("ask-none", "فروشگاهی برای پرسیدن پیدا نشد.", "bad"); return; }
      set({ picks: ids });
      say("ask-0", `از ${fa(ids.length)} فروشگاه نزدیک همزمان پرسیدم: موجود است؟ قیمت امروز؟`, "ask");
      const catOnly = ids.some((id) => cardOf(id)?.tier === "category_only");
      ask.mutate({ shopIds: ids, keys: catOnly ? [...BASE, "hours"] : BASE, custom: {}, mode: "direct", timeout: 300 }, { onError: (e) => setStuck((e as Error).message) });
    })();
  }, [pid, sid, status.loading, status.asked, camp, shops.data]); // eslint-disable-line react-hooks/exhaustive-deps -- runs once, when the shops are known

  // 3) every answer is said out loud, once
  const sig = items.map((x) => `${x.q.id}:${x.q.status}:${x.ripeness}:${x.kids.map((k) => k.id + k.status).join(",")}`).join("|");
  useEffect(() => {
    items.forEach((x) => {
      const id = x.q.shop?.shop_id ?? x.q.id, name = x.q.shop?.name ?? "فروشگاه", price = x.q.answer?.price;
      if (x.ripeness === 4) say(`held-${id}`, `${name} قبول کرد برایت نگه دارد.`, "ok");
      else if (x.ripeness === 3) say(`ok-${id}`, `${name} تأیید کرد${price ? `: ${mil(price)} تومان` : ""}.`, "ok");
      else if (x.q.status === "unavailable" || x.gone) say(`gone-${id}`, `${name} ندارد؛ کنارش گذاشتم.`, "bad");
      else if (x.q.status === "no_reply") say(`silent-${id}`, `${name} جواب نداد.`, "bad");
      x.kids.filter((k) => k.kind === "bargain").forEach((k) => {
        if (k.status === "sent" || k.status === "delivered") say(`bg-sent-${k.id}`, `پیشنهاد ${k.target ? mil(k.target) : ""} تومان را برای ${name} فرستادم.`, "ask");
        else if (k.answer?.bargain_accepted) say(`bg-${k.id}`, `${name} با ${mil(k.answer.price ?? k.target ?? 0)} تومان قبول کرد.`, "ok");
        else say(`bg-${k.id}`, `${name} قبول نکرد${k.answer?.price ? `؛ گفت ${mil(k.answer.price)}` : ""}؛ قیمت قبلی سر جایش است.`, "bad");
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
        {!stuck && !deciding && !failed && !status.held && <li className="ap-line wait"><span className="spin" />{!pid ? "دارم می‌فهمم چه می‌خواهی…" : status.asked === 0 ? "دارم فروشگاه‌ها را می‌چینم…" : "منتظر جواب فروشنده‌ها هستم…"}</li>}
      </ol>
    </div>
  );

  const replies = (
    <div className="ap-replies">
      <div className="ap-head">جواب فروشنده‌ها، همان‌طور که رسید</div>
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
  const decision = status.held ? (
    <div className="ap-card dark">
      <span className="xs" style={{ color: "#c9ccd6" }}>برایت نگه داشته شد</span>
      <div className="ap-title">{status.held.q.shop?.name}، کد نگه‌داری: <b className="num">{fa(status.held.hold?.code ?? "")}</b></div>
      <button className="btn pri" onClick={start}>شروع مسیر</button>
    </div>
  ) : deciding && best ? (
    <div className="ap-card dark">
      <span className="xs" style={{ color: "#c9ccd6" }}>فقط همین را باید خودت تصمیم بگیری</span>
      <div className="ap-title"><Bidi text={best.q.shop?.name ?? ""} />{bestCard?.mall ? `، ${bestCard.mall}` : ""} گفت دارد{best.q.answer?.price ? `: ${money(Math.min(best.q.answer.price, best.deal ?? best.q.answer.price))} تومان` : ""}{bestCard?.walk_min != null ? `، ${fa(bestCard.walk_min)} دقیقه پیاده` : ""}. بگویم برایت نگه دارد؟</div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn pri grow" onClick={() => setHoldOpen(true)}><Icon n="hold" s />آره، نگه دارد</button>
        <button className="btn sec" style={{ background: "transparent", color: "#fff", borderColor: "#4a4f60" }} onClick={start}>نه، فقط برو</button>
      </div>
      <button type="button" className="ap-link" onClick={() => setBargain(true)}>اول قیمت بهتر بگیر</button>
    </div>
  ) : failed || stuck ? (
    <div className="ap-card">
      <div className="ap-title">{stuck ?? "هیچ فروشگاهی تأیید نکرد."}</div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {failed && <button className="btn pri" onClick={() => { set({ auto: false }); go("find"); }}>فروشگاه‌های بیشتر را ببین</button>}
        <button className={`btn ${failed ? "sec" : "pri"}`} onClick={manual}>خودم ادامه می‌دهم</button>
      </div>
    </div>
  ) : null;

  const rail = (
    <div className="ap-rail" aria-label="مرحله‌ها">
      {STEPS.map((s, i) => <div key={s}><span className={i < step ? "done" : i === step ? "now" : ""} /><em className={i === step ? "on" : ""}>{s}</em></div>)}
    </div>
  );

  return (
    <div className="mc ap">
      <MissionBar activeId={m.id} />
      <div className="ap-top">
        <div className="ap-said"><span className="xs faint">گفتی:</span><span><Bidi text={m.text || m.query} /></span></div>
        <span className="ap-badge"><Icon n="spark" s />خودکار</span>
        <button type="button" className="ap-manual" onClick={manual}>خودم ادامه می‌دهم</button>
      </div>
      {rail}
      <div style={{ padding: "0 18px 8px" }}><BasketStrip m={m} /></div>
      {desk ? (
        <div className="ap-grid">
          <aside className="ap-col">{story}<div className="mc-slots"><span className="slot"><span className="k">سفر</span>{slotSummary(m) || "—"}</span></div></aside>
          <section className="ap-map">{map}</section>
          <aside className="ap-col">{decision}{replies}</aside>
        </div>
      ) : (
        <div className="ap-phone">
          <section className="ap-map">{map}</section>
          <div className="ap-sheet">{decision}{story}{items.length > 0 && replies}</div>
        </div>
      )}
      <NegotiateSheet open={bargain} onClose={() => setBargain(false)} items={items} title={shortName(m.product ?? { title: m.query, brand: null })} />
      <HoldSheet item={holdOpen ? best : null} onClose={() => setHoldOpen(false)} onGo={() => { setHoldOpen(false); start(); }} />
    </div>
  );
}
