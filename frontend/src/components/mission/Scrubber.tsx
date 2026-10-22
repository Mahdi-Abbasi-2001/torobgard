"use client";
// "When do you arrive?" as something you drag (canvas B / F3): opening hours on every shop are judged for the chosen moment, and travel
// times for the chosen way, so the map redraws as you move it.
import { useState } from "react";
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
  const i = nearestStep(when);
  const custom = WHEN_STEPS.findIndex(([v]) => v === when) < 0;
  return (
    <div className="scrub">
      <div className="row between" style={{ alignItems: "baseline" }}>
        <label htmlFor="scrub" className="xs muted">کی می‌رسید؟ بکشید</label>
        <b className="scrub-now">{whenText(when)}</b>
      </div>
      <input id="scrub" type="range" min={0} max={WHEN_STEPS.length - 1} step={1} value={i} aria-valuetext={whenText(when)} onChange={(e) => onChange(WHEN_STEPS[Number(e.target.value)][0])} />
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
