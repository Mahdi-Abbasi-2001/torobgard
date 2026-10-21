"use client";
import { useState } from "react";
import { AREAS, type Place } from "@/lib/geo";
import { useSession } from "@/lib/session";
import { Icon } from "./Icon";
import { Note, Sheet } from "./ui";

export function useLocate(onDone?: () => void) {
  const { update } = useSession();
  const [status, setStatus] = useState<"idle" | "asking" | "denied">("idle");
  const locate = () => {
    if (!("geolocation" in navigator)) { setStatus("denied"); return; }
    setStatus("asking");
    navigator.geolocation.getCurrentPosition(
      (p) => { update((s) => ({ ...s, locationAsked: true, place: { lat: p.coords.latitude, lon: p.coords.longitude, label: "موقعیت فعلی شما", source: "gps" } })); setStatus("idle"); onDone?.(); },
      () => { update((s) => ({ ...s, locationAsked: true })); setStatus("denied"); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 },
    );
  };
  return { status, locate };
}

export function LocationSheet({ open, onClose, denied }: { open: boolean; onClose: () => void; denied?: boolean }) {
  const { state, update } = useSession();
  const { status, locate } = useLocate(onClose);
  const [pick, setPick] = useState<Place>(state.place.source === "gps" ? AREAS[0] : AREAS.find((a) => a.label === state.place.label) ?? AREAS[0]);
  return (
    <Sheet open={open} onClose={onClose} label="انتخاب محدوده">
      <h2>کجا خرید می‌کنید؟</h2>
      <p className="lede" style={{ marginTop: -8 }}>موقعیت فقط برای حساب فاصله و زمان پیاده‌روی استفاده می‌شود.</p>
      {(denied || status === "denied") && <Note tone="warn" icon="pin">به موقعیت شما دسترسی نداریم. محدوده را انتخاب کنید تا فاصله‌ها درست حساب شود.</Note>}
      <div className="wrapr" role="radiogroup" aria-label="محدوده‌ها">
        {AREAS.map((a) => (
          <button key={a.label} type="button" role="radio" aria-checked={pick.label === a.label} className={`chip ${pick.label === a.label ? "on" : ""}`} style={{ minHeight: 44 }} onClick={() => setPick(a)}>
            {pick.label === a.label && <Icon n="check" s />}{a.label}
          </button>
        ))}
      </div>
      <button className="btn sec block" onClick={() => { locate(); }} disabled={status === "asking"}>
        {status === "asking" ? <span className="spin" /> : <Icon n="loc" s />}{status === "asking" ? "در حال یافتن موقعیت…" : "استفاده از موقعیت فعلی من"}
      </button>
      <button className="btn pri block" onClick={() => { update((s) => ({ ...s, locationAsked: true, place: pick })); onClose(); }}>ادامه با «{pick.label}»</button>
    </Sheet>
  );
}
