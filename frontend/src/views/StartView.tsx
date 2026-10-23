"use client";
// The first page: the living bazaar. The market around you is the backdrop (open shops glow, the light follows the clock); one floating
// sentence box with a microphone is the way in. Sending it hands the sentence to the intake agent, the map tilts in toward you, and the agent
// card takes the panel. A photo, a basket and «just looking» are small pills; your missions in progress sit just above the box.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ParsedMission, type PulseMatch } from "@/lib/api";
import { fa, mil } from "@/lib/fa";
import { km, walkMin } from "@/lib/geo";
import { useIsDesktop } from "@/lib/media";
import { blankMission, groupMissions, useMissions, type Mission } from "@/lib/mission";
import { useSession } from "@/lib/session";
import { ShopPeek } from "@/components/ShopPeek";
import { Icon } from "@/components/Icon";
import { asGroup, GroupIcon, GROUPS } from "@/lib/groups";
import { VoiceButton } from "@/components/VoiceButton";
import { SnapButton } from "@/components/SnapButton";
import { Bidi, OfflineBanner, Sheet } from "@/components/ui";
import { ThemeToggle } from "@/components/TopBar";
import { UserMenu } from "@/components/UserMenu";
import { missionHref } from "@/components/mission/chrome";
import { MissionCard } from "@/components/mission/MissionCard";
import { IntakeAgent, intakeToMission, type IntakeSeed } from "@/components/mission/IntakeAgent";
import { SlotsSheet, type SlotsPatch } from "@/components/mission/SlotsSheet";
import { type SlotKey } from "@/components/mission/slots";
import type { Place } from "@/lib/geo";

const StartMap = dynamic(() => import("@/components/StartMap"), { ssr: false });

export default function StartView() {
  const router = useRouter();
  const desk = useIsDesktop();
  const { state, update } = useSession();
  const { missions, create, ready, remove } = useMissions();
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [over, setOver] = useState<SlotsPatch>({});
  const [agent, setAgent] = useState<IntakeSeed | null>(null); // set when the shopper presses start: the intake agent takes it from here
  const [slots, setSlots] = useState<{ open: boolean; focus: SlotKey | null; only?: "place" }>({ open: false, focus: null });
  
  const [flat, setFlat] = useState(false); // the 3D backdrop could not start: a soft gradient takes over
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(text.trim()), 350); return () => clearTimeout(t); }, [text]);

  const parsed = useQuery({ queryKey: ["mparse", debounced], queryFn: () => api.missionParse(debounced), enabled: debounced.length > 1, staleTime: Infinity, placeholderData: keepPreviousData });
  const p: ParsedMission | undefined = text.trim() ? parsed.data : undefined;
  // what the map looks for while the shopper types: the product words the sentence boils down to
  const [chip, setChip] = useState<string | null>(null); // a category chip the shopper tapped; typing anything else drops it
  const cats = useQuery({ queryKey: ["pulse-cats", state.place.lat.toFixed(4), state.place.lon.toFixed(4)], staleTime: 10 * 60_000, queryFn: () => api.pulseCategories({ lat: state.place.lat, lon: state.place.lon, limit: 8 }) });
  const look = chip && text === chip ? { query: "", category: chip } : p?.query ? { query: p.query, category: p.category ?? null } : null;
  const pickChip = (name: string) => { if (chip === name) { setChip(null); setText(""); } else { setChip(name); setText(name); } setOver({}); };
  const [hit, setHit] = useState<PulseMatch | null>(null);
  const [menu, setMenu] = useState(false); // phone: the places the desktop bar links to
  const [peek, setPeek] = useState<string | null>(null); // the shop whose card is open

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
  const [needPlace, setNeedPlace] = useState(false); // the shopper pressed start before choosing where they are: ask once, then carry on
  const start = () => {
    if (!text.trim()) return;
    if (state.place.source === "default") { setNeedPlace(true); setSlots({ open: true, focus: "place", only: "place" }); return; }
    setPeek(null); setAgent({ text: text.trim(), slots: agentSlots, pinned: pinnedNow });
  };
  useEffect(() => { if (needPlace && !slots.open && state.place.source !== "default") { Promise.resolve().then(() => { setNeedPlace(false); start(); }); } }, [needPlace, slots.open, state.place.source]); // eslint-disable-line react-hooks/exhaustive-deps -- continues once the place is set

  const list = ready ? groupMissions(missions.filter((m) => !m.done)).slice(0, 4) : []; // only trips still in progress

  const sendText = (t: string) => { setText(t); setOver({}); setAgent({ text: t.trim(), slots: {}, pinned: [] }); };
  // the map keeps its shops clear of the panel: measure the real panel instead of guessing
  const panelEl = useRef<HTMLDivElement>(null);
  const [panelH, setPanelH] = useState(0);
  useEffect(() => {
    const el = panelEl.current; if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setPanelH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const padBottom = panelH > 0 ? panelH + 16 : desk ? 120 : agent ? 380 : 300;
  const [listOpen, setListOpen] = useState(false); // «show as list»: the same shops without the map

  return (
    <div className="bz">
      {!flat ? <StartMap origin={state.place} going={!!agent} padBottom={padBottom} match={look} onMatch={setHit} selected={peek} onPick={setPeek} onUnavailable={() => setFlat(true)} /> : <div className="stm-load" />}

      <div className="st-top">
        <Link href="/" className="st-glass st-brand" aria-label="ترب‌گرد"><Icon n="home" s />ترب‌گرد</Link>
        {(() => { const unset = state.place.source === "default"; return (
          <button type="button" className={`st-glass st-loc ${unset ? "ask" : ""}`} onClick={() => setSlots({ open: true, focus: "place", only: "place" })} aria-label={unset ? "انتخاب موقعیت شما" : `موقعیت شما: ${state.place.label}. تغییر`}><Icon n="loc" s /><bdi>{unset ? "موقعیت خود را انتخاب کنید" : fa(state.place.label)}</bdi>{!unset && <span className="st-loc-edit">تغییر</span>}</button>
        ); })()}
        {look && hit && <span className="st-glass st-found" aria-live="polite">{hit.listed.length ? `${fa(hit.listed.length)} فروشگاه نزدیک «${look.query || look.category}» را ثبت کرده‌اند` : hit.maybe.length ? `${fa(hit.maybe.length)} فروشگاه این دسته را دارند؛ ثبت دقیق نشده` : hit.nearest ? `نزدیک شما نیست؛ نزدیک‌ترین «${hit.nearest.name}» حدود ${fa(String(hit.nearest.km).replace(".", "٫"))} کیلومتر دورتر است` : "نزدیک شما فروشگاهی پیدا نشد"}</span>}
        {look && hit && hit.listed.length + hit.maybe.length > 0 && <button type="button" className="st-glass st-listbtn" onClick={() => setListOpen(true)}><Icon n="list" s />فهرست</button>}
        {look && hit && hit.listed.length + hit.maybe.length > 0 && <span className="st-legend" aria-hidden="true"><i className="a" />دارند <i className="b" />فقط این دسته را دارند</span>}
        <span className="grow" />
        {desk && <Link href="/missions" className="st-glass">خریدهای من{missions.length > 0 && <span className="tb-cnt">{fa(missions.length)}</span>}</Link>}
        {desk && <UserMenu className="st-glass" />}
        {desk && <span className="st-glass" style={{ padding: 0, minWidth: 38, justifyContent: "center" }}><ThemeToggle /></span>}
        {!desk && <button type="button" className="st-glass st-menu" onClick={() => setMenu(true)} aria-label="منو: خریدهای من، حساب، حالت نمایش">{missions.length > 0 && <span className="tb-cnt">{fa(missions.length)}</span>}<Icon n="list" s /></button>}
      </div>

      <div className="st-panel" ref={panelEl}>
        <OfflineBanner />
        {!agent && list.length > 0 && (
          <div className="st-missions-wrap"><span className="st-cap">خریدهای در جریان شما</span>
          <div className="st-missions" aria-label="خریدهای در جریان">
            {list.map((g) => (
              <div key={g.head.id} className="st-mc">
                <MissionCard m={g.head} compact count={g.items.length} />
                <button type="button" className="st-x" aria-label="حذف از این دستگاه" title="حذف از این دستگاه" onClick={() => { if (confirm(g.items.length > 1 ? "این خرید و همهٔ کالاهایش از این دستگاه حذف شود؟" : "این خرید از این دستگاه حذف شود؟")) g.items.forEach((x) => remove(x.id)); }}><Icon n="x" s /></button>
              </div>
            ))}
          </div></div>
        )}
        {!agent && list.length === 0 && !peek && <p className="st-intro">هر چه می‌خواهید بنویسید یا بگویید. فروشگاه‌های نزدیکِ دارای آن را پیدا می‌کنیم، موجودی و قیمت را از آن‌ها می‌پرسیم و مسیر را نشان می‌دهیم.</p>}
        {agent ? (
          <>
            <div className="st-agent">
              <IntakeAgent key={agent.text} seed={agent} onEdit={() => setAgent(null)} autoOption
                onReady={(r, gps, auto) => begin({ ...draft, ...intakeToMission(r, gps), text: draft.text, query: r.slots.query ?? (draft.query || draft.text), auto }, r.slots.more ?? [])} />
            </div>
          </>
        ) : (
          <>
            {peek && <ShopPeek id={peek} origin={state.place} query={look?.query || null} category={look?.category ?? null} onClose={() => setPeek(null)} onAsk={() => { if (text.trim()) start(); else { setPeek(null); field.current?.focus(); } }} />}
            {!peek && cats.data && cats.data.items.length > 0 && (
              <div className="st-cats-wrap"><span className="st-cap">دسته‌های پرفروشگاه اطراف؛ بزنید تا روی نقشه ببینید</span>
              <div className="st-cats" role="group" aria-label="دسته‌های پرفروشگاه اطراف">
                {cats.data.items.map((c) => <button key={c.name} type="button" className={`st-cat ${chip === c.name && text === chip ? "on" : ""}`} aria-pressed={chip === c.name && text === chip} onClick={() => pickChip(c.name)}><span style={{ color: chip === c.name && text === chip ? "#fff" : GROUPS[asGroup(c.g)].color, display: "inline-flex" }}><GroupIcon g={c.g} size={15} /></span>{c.name}</button>)}
              </div></div>
            )}
            <div className="st-box">
              <label htmlFor="errand" className="sr">چه می‌خواهید؟</label>
              <textarea id="errand" ref={field} rows={1} value={text} onChange={(e) => { setText(e.target.value); setOver({}); setAgent(null); }} placeholder="چه چیزی می‌خواهید؟"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); start(); } }} />
              <SnapButton className="st-snap" label="جست‌وجو با عکس از کالا، جعبه یا برچسب"><Icon n="cam" /></SnapButton>
              <VoiceButton onText={sendText} />
              <button type="button" className="st-go" disabled={!text.trim()} onClick={start} aria-label="شروع"><Icon n="fwd" /></button>
            </div>
          </>
        )}
      </div>

      <Sheet open={listOpen} onClose={() => setListOpen(false)} label="فهرست فروشگاه‌ها" className="tall">
        {hit && (
          <div className="stack" style={{ gap: 10 }}>
            <div><div className="mc-label">فروشگاه‌ها</div><div className="b" style={{ fontSize: 17 }}>«{look?.query || look?.category}» نزدیک {state.place.source === "default" ? "شما" : state.place.label}</div></div>
            {[{ title: "کالا را ثبت کرده‌اند", items: [...hit.listed].sort((a, b) => (a.price ?? 1e15) - (b.price ?? 1e15)) }, { title: "فقط این دسته را دارند؛ باید بپرسید", items: hit.maybe.map((x) => ({ ...x, price: null as number | null })) }].filter((g) => g.items.length).map((g) => (
              <section key={g.title} className="stack" style={{ gap: 6 }}>
                <b className="sm">{g.title} ({fa(g.items.length)})</b>
                {g.items.slice(0, 40).map((x) => (
                  <button key={x.shop_id} type="button" className="card row between" style={{ padding: "10px 14px", textAlign: "start" }} onClick={() => { setPeek(x.shop_id); setListOpen(false); }}>
                    <span className="row" style={{ gap: 8, minWidth: 0 }}><span style={{ color: GROUPS[asGroup(x.g)].color, display: "inline-flex" }}><GroupIcon g={x.g} size={16} /></span><b className="sm"><Bidi text={x.name} /></b></span>
                    <span className="xs muted" style={{ whiteSpace: "nowrap" }}>{x.price ? `از ${mil(x.price)}` : "قیمت نامشخص"} · {fa(Math.round(walkMin(km(state.place, x))))} دقیقه</span>
                  </button>
                ))}
              </section>
            ))}
          </div>
        )}
      </Sheet>

      <Sheet open={menu} onClose={() => setMenu(false)} label="منو">
        <div className="stack" style={{ gap: 10 }}>
          <Link href="/missions" className="btn sec block" onClick={() => setMenu(false)}>خریدهای من{missions.length > 0 && <span className="tb-cnt">{fa(missions.length)}</span>}</Link>
          <UserMenu className="btn sec block" />
          <div className="row between"><span className="sm">حالت تیره یا روشن</span><span className="st-glass" style={{ padding: 0, minWidth: 38, justifyContent: "center" }}><ThemeToggle /></span></div>
        </div>
      </Sheet>

      <SlotsSheet open={slots.open} onClose={() => setSlots((x) => ({ ...x, open: false }))} value={draft} onChange={(patch) => { if (patch.place) update((x) => ({ ...x, place: patch.place!, locationAsked: true })); setOver((o) => ({ ...o, ...patch, cond: patch.cond ? { ...(o.cond ?? draft.cond), ...patch.cond } : o.cond })); }} focus={slots.focus} only={slots.only} cta="تأیید" />
    </div>
  );
}
