"use client";
// The first page: the living bazaar. The market around you is the backdrop (open shops glow, the light follows the clock); one floating
// sentence box with a microphone is the way in. Sending it hands the sentence to the intake agent, the map tilts in toward you, and the agent
// card takes the panel. A photo, a basket and «just looking» are small pills; your missions in progress sit just above the box.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ParsedMission } from "@/lib/api";
import { fa } from "@/lib/fa";
import { useIsDesktop } from "@/lib/media";
import { blankMission, groupMissions, useMissions, type Mission } from "@/lib/mission";
import { useSession } from "@/lib/session";
import { useInquiries } from "@/lib/useInquiries";
import { Icon } from "@/components/Icon";
import { VoiceButton } from "@/components/VoiceButton";
import { SnapButton } from "@/components/SnapButton";
import { Bidi, OfflineBanner } from "@/components/ui";
import { ThemeToggle } from "@/components/TopBar";
import { UserMenu } from "@/components/UserMenu";
import type { StartStats } from "@/components/StartMap";
import { missionHref } from "@/components/mission/chrome";
import { MissionCard } from "@/components/mission/MissionCard";
import { IntakeAgent, intakeToMission, type IntakeSeed } from "@/components/mission/IntakeAgent";
import { SlotsSheet, type SlotsPatch } from "@/components/mission/SlotsSheet";
import { type SlotKey } from "@/components/mission/slots";
import type { Place } from "@/lib/geo";

const StartMap = dynamic(() => import("@/components/StartMap"), { ssr: false });
const EXAMPLES = [
  "هندزفری گردنی برای ورزش، تا ۳٫۵ میلیون، نزدیک علاالدین، عصر",
  "گوشی سامسونگ ۱۰ تا ۱۵ میلیون، قسطی، فردا ساعت ۱۱",
  "دوربین مداربسته ۴ کانال، اطراف فردوسی",
];

export default function StartView() {
  const router = useRouter();
  const desk = useIsDesktop();
  const { state, update, sid } = useSession();
  const { missions, create, ready, remove } = useMissions();
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [over, setOver] = useState<SlotsPatch>({});
  const [agent, setAgent] = useState<IntakeSeed | null>(null); // set when the shopper presses start: the intake agent takes it from here
  const [slots, setSlots] = useState<{ open: boolean; focus: SlotKey | null; only?: "place" }>({ open: false, focus: null });
  const [stats, setStats] = useState<StartStats | null>(null);
  const [flat, setFlat] = useState(false); // the 3D backdrop could not start: a soft gradient takes over
  const [ph, setPh] = useState("");     // the placeholder types example sentences while the box is empty
  const [tick, setTick] = useState(0);  // which fact the ticker shows
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(text.trim()), 350); return () => clearTimeout(t); }, [text]);

  const parsed = useQuery({ queryKey: ["mparse", debounced], queryFn: () => api.missionParse(debounced), enabled: debounced.length > 1, staleTime: Infinity, placeholderData: keepPreviousData });
  const p: ParsedMission | undefined = text.trim() ? parsed.data : undefined;
  const malls = useQuery({ queryKey: ["malls"], queryFn: () => api.malls(5) });
  const inq = useInquiries(sid, { live: false });

  // the draft mission: what was read from the sentence, then the shopper's own edits, then this device's usual place / time / way
  const draft: Mission = useMemo(() => {
    const parsedPlace: Place | null = p?.place ? { label: p.place.label, lat: p.place.lat, lon: p.place.lon, source: "area" } : null;
    return blankMission({
      text: text.trim(), query: p?.query ?? (text.trim() && !p ? text.trim() : ""), category: p?.category ?? null, need: over.need !== undefined ? over.need : p?.need ?? null,
      budgetMin: over.budgetMin !== undefined ? over.budgetMin : p?.budget?.min ?? null, budgetMax: over.budgetMax !== undefined ? over.budgetMax : p?.budget?.max ?? null,
      cond: { installment: over.cond?.installment ?? p?.conditions.installment ?? false, open: over.cond?.open ?? p?.conditions.open ?? false, near: over.cond?.near ?? false },
      place: over.place ?? parsedPlace ?? state.place, when: over.when ?? p?.when ?? state.when, mode: over.mode ?? p?.mode ?? state.mode,
    });
  }, [p, over, text, state.place, state.when, state.mode]);

  const begin = (m: Mission, more: { query: string; category: string | null }[] = []) => {
    const made = create(m);
    // a sentence with several products is one trip with several items: the first is the main one, the rest join the same basket
    more.forEach((x) => create({ spree: made.id, text: m.text, query: x.query, category: x.category, place: made.place, when: made.when, mode: made.mode, cond: made.cond, priority: made.priority, auto: made.auto }));
    update((s) => ({ ...s, place: made.place, when: made.when, mode: made.mode, locationAsked: s.locationAsked || made.place.source !== "default" }));
    router.push(missionHref(made.id));
  };
  // what the shopper set by hand is pinned: the agent may not change it or ask about it
  const pinnedNow = [over.need !== undefined && "need", (over.budgetMin !== undefined || over.budgetMax !== undefined) && "budget", over.place && "place", over.when && "when", over.mode && "mode", over.cond && "conditions"].filter(Boolean) as string[];
  const agentSlots = {
    ...(over.need !== undefined && { need: draft.need }), ...((over.budgetMin !== undefined || over.budgetMax !== undefined) && { budget: { min: draft.budgetMin, max: draft.budgetMax } }),
    ...(over.place && { place: draft.place.label }), ...(over.when && { when: draft.when }), ...(over.mode && { mode: draft.mode }),
    ...(over.cond && { conditions: { installment: draft.cond.installment, open: draft.cond.open } }),
  };
  const start = () => { if (text.trim()) setAgent({ text: text.trim(), slots: agentSlots, pinned: pinnedNow }); };

  const list = ready ? groupMissions(missions.filter((m) => !m.done)).slice(0, 4) : []; // only trips still in progress
  const mine = new Set(missions.map((m) => m.productId).filter(Boolean)); // the ticker only speaks about trips that are still on this device
  const recent = inq.items.filter((i) => i.kind === "ask" && (i.status === "answered" || i.status === "unavailable") && i.shop && i.product && mine.has(i.product.product_id)).slice(0, 3);

  // typewriter placeholder
  useEffect(() => {
    if (text) return;
    let i = 0, k = 0, hold = 0;
    const id = setInterval(() => {
      const full = EXAMPLES[i % EXAMPLES.length];
      if (hold > 0) { hold--; return; }
      k++; setPh(full.slice(0, k));
      if (k >= full.length) { hold = 30; k = 0; i++; }
    }, 70);
    return () => clearInterval(id);
  }, [text]);

  // the ticker only says things we actually know
  const facts = useMemo(() => [
    stats && stats.open > 0 ? { text: `همین حالا ${fa(stats.open)} فروشگاه باز است؛ ${fa(stats.known)} فروشگاه اطراف ساعتش را اعلام کرده` } : null,
    ...(malls.data?.items.slice(0, 3).map((mm) => ({ text: `${mm.mall}: ${fa(mm.shop_count)} فروشگاه`, href: `/mall/${encodeURIComponent(mm.mall_key)}` })) ?? []),
    ...recent.map((i) => ({ text: `${i.shop!.name} ${i.status === "answered" ? "تأیید کرد" : "ندارد"}: ${i.product!.title.slice(0, 26)}` })),
  ].filter((x): x is { text: string; href?: string } => !!x), [stats, malls.data, recent.length]); // eslint-disable-line react-hooks/exhaustive-deps -- recent's contents change with its length here
  useEffect(() => { if (facts.length < 2) return; const id = setInterval(() => setTick((x) => x + 1), 4500); return () => clearInterval(id); }, [facts.length]);
  const fact = facts.length ? facts[tick % facts.length] : null;

  const sendText = (t: string) => { setText(t); setOver({}); setAgent({ text: t.trim(), slots: {}, pinned: [] }); };
  const padBottom = desk ? 120 : agent ? 380 : 300;

  return (
    <div className="bz">
      {!flat ? <StartMap origin={state.place} going={!!agent} padBottom={padBottom} onStats={setStats} onUnavailable={() => setFlat(true)} /> : <div className="stm-load" />}

      <div className="st-top">
        <Link href="/" className="st-glass st-brand" aria-label="ترب‌گرد"><Icon n="home" s />ترب‌گرد</Link>
        <button type="button" className="st-glass" onClick={() => setSlots({ open: true, focus: "place", only: "place" })} aria-label={`محدوده: ${state.place.label}. تغییر`}><Icon n="loc" s /><bdi>{fa(state.place.label)}</bdi></button>
        {stats && stats.open > 0 && <span className="st-glass st-live"><i />{fa(stats.open)} فروشگاه باز</span>}
        <span className="grow" />
        {desk && <Link href="/missions" className="st-glass">خریدهای من{missions.length > 0 && <span className="tb-cnt">{fa(missions.length)}</span>}</Link>}
        {desk && <UserMenu className="st-glass" />}
        {desk && <span className="st-glass" style={{ padding: 0, minWidth: 38, justifyContent: "center" }}><ThemeToggle /></span>}
      </div>
      {fact && !agent && <div className="st-tick" aria-live="polite">{fact.href ? <Link href={fact.href} key={tick} className="st-tick-a">{fact.text}</Link> : <span key={tick}>{fact.text}</span>}</div>}

      <div className="st-panel">
        <OfflineBanner />
        {!agent && list.length > 0 && (
          <div className="st-missions" aria-label="خریدهای در جریان">
            {list.map((g) => (
              <div key={g.head.id} className="st-mc">
                <MissionCard m={g.head} compact count={g.items.length} />
                <button type="button" className="st-x" aria-label="حذف از این دستگاه" title="حذف از این دستگاه" onClick={() => { if (confirm(g.items.length > 1 ? "این سفر و همهٔ کالاهایش از این دستگاه حذف شود؟" : "این خرید از این دستگاه حذف شود؟")) g.items.forEach((x) => remove(x.id)); }}><Icon n="x" s /></button>
              </div>
            ))}
          </div>
        )}
        {agent ? (
          <>
            <div className="st-said"><span className="xs faint">گفتی:</span><span><Bidi text={agent.text} /></span></div>
            <div className="st-agent">
              <IntakeAgent key={agent.text} seed={agent} onEdit={() => setAgent(null)} autoOption
                onReady={(r, gps, auto) => begin({ ...draft, ...intakeToMission(r, gps), text: draft.text, query: r.slots.query ?? (draft.query || draft.text), auto }, r.slots.more ?? [])} />
            </div>
          </>
        ) : (
          <>
            <div className="st-box">
              <label htmlFor="errand" className="sr">چه می‌خواهید؟</label>
              <textarea id="errand" ref={field} rows={1} value={text} onChange={(e) => { setText(e.target.value); setOver({}); setAgent(null); }} placeholder={ph || "فقط بگو چه می‌خواهی…"}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); start(); } }} />
              <SnapButton className="st-snap" label="جست‌وجو با عکس از کالا، جعبه یا برچسب"><Icon n="cam" /></SnapButton>
              <VoiceButton onText={sendText} />
              <button type="button" className="st-go" disabled={!text.trim()} onClick={start} aria-label="شروع"><Icon n="fwd" /></button>
            </div>
          </>
        )}
      </div>

      <SlotsSheet open={slots.open} onClose={() => setSlots((x) => ({ ...x, open: false }))} value={draft} onChange={(patch) => { if (patch.place) update((x) => ({ ...x, place: patch.place!, locationAsked: true })); setOver((o) => ({ ...o, ...patch, cond: patch.cond ? { ...(o.cond ?? draft.cond), ...patch.cond } : o.cond })); }} focus={slots.focus} only={slots.only} cta="تأیید" />
    </div>
  );
}
