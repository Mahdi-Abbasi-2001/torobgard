"use client";
// "When do you arrive?" as something you drag (canvas B / F3): opening hours on every shop are judged for the chosen moment, and travel
// times for the chosen way, so the map redraws as you move it.
import { useRef, useState } from "react";
import type { Mode } from "@/lib/mission";
import { MODE_LABEL, whenText } from "./slots";

export const WHEN_STEPS: [string, string][] = [["now", "الان"], ["1h", "یک ساعت دیگر"], ["evening", "عصر ۱۸:۰۰"], ["20:00", "شب ۲۰:۰۰"], ["tomorrow", "فردا صبح"]];
const clockMin = (w: string) => (/^\d{1,2}:\d{2}$/.test(w) ? Number(w.split(":")[0]) * 60 + Number(w.split(":")[1]) : null);
/** the step a custom time (e.g. 11:00) sits closest to, so the thumb never shows a wrong place */
const nearestStep = (w: string) => {
  const i = WHEN_STEPS.findIndex(([v]) => v === w);
  if (i >= 0) return i;
  const c = clockMin(w);
  if (c == null) return 0;
  if (c >= 22 * 60 || c < 6 * 60) return 4;
  return c < 15 * 60 ? 1 : c < 19 * 60 ? 2 : 3;
};

export function WhenScrubber({ when, onChange, compact = false }: { when: string; onChange: (w: string) => void; compact?: boolean }) {
  const N = WHEN_STEPS.length - 1;
  const idx = nearestStep(when);
  const custom = WHEN_STEPS.findIndex(([v]) => v === when) < 0;
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null); // 0..1 while the thumb is held; released, it glides to the nearest step
  const frac = drag ?? idx / N;
  // RTL: the earliest time is on the right
  const at = (e: React.PointerEvent) => { const r = track.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, (r.right - e.clientX) / r.width)); };
  const commit = (f: number) => { const v = WHEN_STEPS[Math.round(f * N)][0]; if (v !== when) onChange(v); };
  const move = (e: React.PointerEvent) => { const f = at(e); setDrag(f); commit(f); };
  const key = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowLeft" || e.key === "ArrowDown" ? 1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? -1 : 0;
    if (d) { e.preventDefault(); onChange(WHEN_STEPS[Math.min(N, Math.max(0, idx + d))][0]); }
  };
  return (
    <div className="scrub">
      <div className="row between" style={{ alignItems: "baseline" }}>
        <span id="scrub-l" className="xs muted">چه ساعتی می‌رسید؟ بکشید</span>
        <b className="scrub-now">{whenText(when)}</b>
      </div>
      <div ref={track} className="scrub-track" role="slider" tabIndex={0} aria-labelledby="scrub-l" aria-valuemin={0} aria-valuemax={N} aria-valuenow={idx} aria-valuetext={whenText(when)}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); }} onPointerMove={(e) => { if (drag != null) move(e); }}
        onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)} onKeyDown={key}>
        <div className="scrub-rail" />
        {WHEN_STEPS.map(([v], k) => <i key={v} className="scrub-tick" style={{ right: `${(k / N) * 100}%` }} />)}
        <div className={`scrub-fill ${drag == null ? "glide" : ""}`} style={{ width: `${frac * 100}%` }} />
        <div className={`scrub-thumb ${drag == null ? "glide" : "held"}`} style={{ right: `${frac * 100}%` }} />
      </div>
      <div className={`scrub-steps ${compact ? "compact" : ""}`}>
        {WHEN_STEPS.map(([v, l]) => <button key={v} type="button" className={when === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>)}
        {custom && <button type="button" className="on">{whenText(when)}</button>}
      </div>
    </div>
  );
}

export function ModeChips({ mode, onChange, className = "" }: { mode: Mode; onChange: (m: Mode) => void; className?: string }) {
  const [warn] = useState(false);
  void warn;
  return (
    <div className={`modechips ${className}`} role="radiogroup" aria-label="با چه وسیله‌ای">
      {(["walk", "taxi", "car"] as Mode[]).map((k) => <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? "on" : ""} onClick={() => onChange(k)}>{k === "car" ? "ماشین، طرح ترافیک" : MODE_LABEL[k]}</button>)}
    </div>
  );
}
