"use client";
import Link from "next/link";
import { fa } from "@/lib/fa";
import type { Mission } from "@/lib/mission";
import { useMissionStatus } from "@/lib/useMissionStatus";
import { Thumb, Bidi } from "@/components/ui";
import { missionHref, missionTitle } from "./chrome";
import { slotSummary, whenText } from "./slots";

/** Four-bar progress of a whole mission: stages behind it are solid, the one in progress pulses. */
export function Progress({ stage, finished }: { stage: number; finished: boolean }) {
  const full = finished ? 4 : stage;
  return (
    <div className="ripe" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => <i key={i} style={{ background: i < full ? "var(--accent)" : i === full ? "color-mix(in srgb, var(--accent) 38%, var(--line-2))" : undefined, animation: i === full ? "ripe-pulse 1.3s ease infinite" : undefined }} />)}
    </div>
  );
}

export function MissionCard({ m, compact = false }: { m: Mission; compact?: boolean }) {
  const st = useMissionStatus(m, { live: false });
  const line = st.finished ? (m.done?.found === false ? "رفتید؛ کالا نبود" : "خریدید؛ گزارشتان ثبت شد") : st.held ? `نگه داشته${st.held.hold?.until ? ` تا ${fa(st.held.hold.until)}` : ""}، کد ${fa(st.held.hold?.code ?? "")}` : st.headline;
  return (
    <Link href={missionHref(m.id)} className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row between" style={{ alignItems: "flex-start", gap: 10 }}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          {!compact && m.product && <Thumb src={m.product.image} alt="" size={44} brand={m.product.brand} />}
          <div style={{ minWidth: 0 }}><div className="b" style={{ fontSize: 15, lineHeight: 1.5 }}><Bidi text={missionTitle(m)} /></div>
            <div className="xs faint">{slotSummary(m) || whenText(m.when)}</div></div>
        </div>
      </div>
      <Progress stage={st.stage} finished={st.finished} />
      <div className="xs muted">{line}</div>
    </Link>
  );
}
