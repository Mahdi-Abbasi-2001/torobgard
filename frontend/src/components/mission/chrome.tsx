"use client";
// The frame around every mission screen: the bar (brand, mission tabs on desktop), the four-stage rail, the desktop mission card and
// the layout wrapper stages put their content into (phone: one column; desktop: card | stage | panel).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { fa } from "@/lib/fa";
import { useIsDesktop } from "@/lib/media";
import { groupMissions, STAGE_LABEL, STAGE_OF, STAGE_VIEW, useMissions, type Mission, type View } from "@/lib/mission";
import { useSession } from "@/lib/session";
import { useMissionStatus, type MissionStatus } from "@/lib/useMissionStatus";
import { Icon, Radish } from "@/components/Icon";
import { ThemeToggle } from "@/components/TopBar";
import { Bidi } from "@/components/ui";
import { AgentSheet } from "./AgentSheet";
import { UserMenu } from "@/components/UserMenu";
import { BasketStrip } from "./BasketStrip";
import { SlotsSheet, type SlotsPatch } from "./SlotsSheet";
import { slotsOf, slotSummary, type SlotKey } from "./slots";

export const missionHref = (id: string, view?: View) => `/m/${id}${view ? `?s=${view}` : ""}`;
export const missionTitle = (m: Mission) => m.product?.title ?? (m.query || m.text || "خرید");

/** The bar on every mission screen. Phones: brand and a link to the list. Desktop: brand, one tab per mission, login, theme. */
export function MissionBar({ activeId }: { activeId?: string }) {
  const { missions } = useMissions();
  const { user } = useSession();
  const desk = useIsDesktop();
  return (
    <header className="mc-bar">
      <Link href="/" className="mc-brand" aria-label="ترب‌گرد، خرید تازه"><Radish size={28} />ترب‌گرد</Link>
      <nav className="mc-tabs" aria-label="خریدها">
        {groupMissions(missions).slice(0, 6).map((g) => <TabFor key={g.head.id} m={g.head} count={g.items.length} on={g.items.some((x) => x.id === activeId)} />)}
        <Link href="/" className="mc-tab new">+ خرید تازه</Link>
      </nav>
      {!desk && <><span className="grow" />{user && <UserMenu compact style={{ minHeight: 38 }} />}<Link href="/missions" className="chip" style={{ minHeight: 38 }}>خریدها{missions.length > 0 && <span className="tb-cnt" aria-label={`${fa(missions.length)} خرید`}>{fa(missions.length)}</span>}</Link></>}
      {desk && (
        <>
          <UserMenu className={user ? "chip" : "btn sec"} style={{ minHeight: 40 }} />
          <ThemeToggle />
        </>
      )}
    </header>
  );
}

function TabFor({ m, on, count }: { m: Mission; on: boolean; count: number }) {
  const st = useMissionStatus(m, { live: false });
  return (
    <Link href={missionHref(m.id)} className={`mc-tab ${on ? "on" : ""}`} aria-current={on ? "page" : undefined}>
      <span className="d" style={{ opacity: st.stage === 0 ? 0.45 : 1 }} /><span className="t"><Bidi text={missionTitle(m)} />{count > 1 ? ` +${fa(count - 1)}` : ""}</span>
    </Link>
  );
}

/** Four stages as a bar: done / now / to come. Each stage you have reached is a link. */
export function Rail({ view, reached, id }: { view: View; reached: number; id: string }) {
  const at = STAGE_OF[view];
  return (
    <ol className="mc-rail" aria-label={`مرحله ${fa(at + 1)} از ۴`}>
      {STAGE_LABEL.map((l, i) => {
        const cls = i < at ? "done" : i === at ? "now" : "";
        const inner = <><i className="bar" />{l}</>;
        return <li key={l}>{i <= reached ? <Link href={missionHref(id, STAGE_VIEW[i])} className={cls} aria-current={i === at ? "step" : undefined}>{inner}</Link> : <span className={`st ${cls}`}>{inner}</span>}</li>;
      })}
    </ol>
  );
}

/** Phone: the mission as a card on top of every stage (what, summary of the slots, the four stages, ask the assistant). */
export function MissionHead({ m, view, status, onSlots, onAsk }: { m: Mission; view: View; status: MissionStatus; onSlots: () => void; onAsk: () => void }) {
  return (
    <section className="mc-head" aria-label="خرید">
      <div className="mc-head-top">
        <div style={{ minWidth: 0 }}>
          <div className="mc-title"><Bidi text={missionTitle(m)} /></div>
          <button type="button" className="mc-sum" onClick={onSlots} aria-label="تغییر محدوده، زمان و شرایط">{slotSummary(m) || "محدوده و شرایط را تنظیم کنید"} <Icon n="filter" s /></button>
        </div>
        <button type="button" className="iconbtn soft" onClick={onAsk} aria-label="از ترب‌گرد بپرسید"><Icon n="spark" /></button>
      </div>
      <Rail view={view} reached={status.stage} id={m.id} />
      <BasketStrip m={m} />
    </section>
  );
}

/** Desktop, right column: the mission itself: slots you can change, the four stages with their state, the assistant. */
export function MissionAside({ m, view, status, onSlots, onAsk, children }: { m: Mission; view: View; status: MissionStatus; onSlots: (k?: SlotKey) => void; onAsk: (q?: string) => void; children?: ReactNode }) {
  const [q, setQ] = useState("");
  const at = STAGE_OF[view];
  const notes = [m.product ? m.product.brand ?? "" : "", status.asked ? `${fa(status.asked)} پرسیده` : "", status.confirmed ? `${fa(status.confirmed)} تأیید` : "", status.held ? `کد ${fa(status.held.hold?.code ?? "")}` : ""];
  return (
    <aside className="mc-aside" aria-label="خرید">
      <div className="mc-label">خرید</div>
      <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.45 }}><Bidi text={missionTitle(m)} /></div>
      <div className="slot-rows">
        {slotsOf(m).filter((s) => s.key !== "product").map((s) => (
          <button key={s.key} type="button" className={`slot-row ${s.open ? "open" : ""}`} onClick={() => onSlots(s.key)}>
            <span className="k">{s.label}</span><span className="v">{s.value ? <Bidi text={fa(s.value)} /> : "مشخص نشده"}</span>
          </button>
        ))}
      </div>
      <div className="rail-v" role="list" aria-label="مرحله‌ها">
        {STAGE_LABEL.map((l, i) => {
          const can = i <= status.stage;
          const cls = `${i < at ? "done" : i === at ? "now" : ""}${can ? "" : " off"}`;
          return <Link key={l} role="listitem" href={missionHref(m.id, STAGE_VIEW[i])} className={cls} aria-current={i === at ? "step" : undefined}><span className="d" />{l}<span className="n">{notes[i]}</span></Link>;
        })}
      </div>
      <BasketStrip m={m} />
      {children}
      <div className="grow" />
      <form className="mc-verdict" style={{ display: "flex", flexDirection: "column", gap: 8 }} onSubmit={(e) => { e.preventDefault(); onAsk(q); setQ(""); }}>
        <label htmlFor="mc-ask" style={{ fontWeight: 700, fontSize: 12 }}>از ترب‌گرد بپرسید</label>
        <input id="mc-ask" onFocus={() => onAsk("")} value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثلاً: قسطی کجا می‌دهد؟" style={{ height: 42, borderRadius: 12, border: "1px solid var(--line-2)", padding: "0 12px", background: "var(--card)", fontSize: 13 }} />
      </form>
    </aside>
  );
}

/** Layout for a stage. Phone: mission head, the stage, its panel, the button. Desktop: card | stage | panel (the panel is optional). */
export function Shell({ m, view, status, center, panel, cta, mapStage, patch, slotsCount, aside }: {
  m: Mission; view: View; status: MissionStatus; center: ReactNode; panel?: ReactNode; cta?: ReactNode; mapStage?: boolean;
  patch: (p: SlotsPatch) => void; slotsCount?: number | null; aside?: ReactNode;
}) {
  const desk = useIsDesktop();
  const router = useRouter();
  const [slots, setSlots] = useState<{ open: boolean; focus: SlotKey | null }>({ open: false, focus: null });
  const [agent, setAgent] = useState<{ open: boolean; q: string }>({ open: false, q: "" });
  const openSlots = (k?: SlotKey) => setSlots({ open: true, focus: k ?? null });
  const openAgent = (q = "") => setAgent({ open: true, q });
  void router;
  return (
    <div className="mc">
      <MissionBar activeId={m.id} />
      <div className={`mc-body ${panel ? "" : "two"}`}>
        {desk && <MissionAside m={m} view={view} status={status} onSlots={openSlots} onAsk={openAgent}>{aside}</MissionAside>}
        <section className={`mc-center ${mapStage ? "map-stage" : ""}`}>
          {!desk && <MissionHead m={m} view={view} status={status} onSlots={() => openSlots()} onAsk={() => openAgent()} />}
          {center}
          {!desk && panel}
          {!desk && <div className="mc-cta">{cta}</div>}
        </section>
        {desk && panel && <section className="mc-panel">{panel}{cta && <div className="mc-cta">{cta}</div>}</section>}
        {desk && !panel && cta && <div className="mc-cta" style={{ gridColumn: "2" }}>{cta}</div>}
      </div>
      <SlotsSheet open={slots.open} onClose={() => setSlots({ open: false, focus: null })} value={m} onChange={patch} focus={slots.focus} count={slotsCount} />
      <AgentSheet open={agent.open} initialQ={agent.q} onClose={() => setAgent({ open: false, q: "" })} mission={m} />
    </div>
  );
}
