"use client";
// How long the seller will keep your item: a ring that empties toward the «until» time while you walk.
import { fa } from "@/lib/fa";
import { useNow } from "@/lib/useInquiries";

export function HoldRing({ until, size = 40 }: { until: string | null | undefined; size?: number }) {
  const now = useNow(15_000);
  const m = /^(\d{1,2}):(\d{2})/.exec(until ?? "");
  if (!m) return null;
  const end = new Date(now); end.setHours(+m[1], +m[2], 0, 0);
  const left = Math.round((end.getTime() - now) / 60_000);
  const frac = Math.max(0, Math.min(1, left / 60));
  const r = 15, c = 2 * Math.PI * r;
  return (
    <span className="hr" style={{ width: size, height: size }} role="img" aria-label={left > 0 ? `${fa(left)} دقیقه تا پایان نگه‌داری` : "نگه‌داری تمام شد"}>
      <svg viewBox="0 0 36 36" width={size} height={size} aria-hidden="true">
        <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="3.5" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={left <= 10 ? "#d73948" : "currentColor"} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 18 18)" style={{ transition: "stroke-dashoffset 1s linear, stroke .4s" }} />
      </svg>
      <b>{left > 0 ? fa(left) : "۰"}</b>
    </span>
  );
}
