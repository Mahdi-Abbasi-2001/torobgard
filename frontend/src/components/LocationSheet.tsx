"use client";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { fa } from "@/lib/fa";
import { AREAS, outsideTehran, type Place } from "@/lib/geo";
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
      (p) => { if (outsideTehran({ lat: p.coords.latitude, lon: p.coords.longitude })) { update((s) => ({ ...s, locationAsked: true })); setStatus("denied"); return; } update((s) => ({ ...s, locationAsked: true, place: { lat: p.coords.latitude, lon: p.coords.longitude, label: "موقعیت فعلی شما", source: "gps" } })); setStatus("idle"); onDone?.(); },
      () => { update((s) => ({ ...s, locationAsked: true })); setStatus("denied"); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 },
    );
  };
  return { status, locate };
}

const PinMap = dynamic(() => import("./PinMap"), { ssr: false, loading: () => <div className="map lmap" style={{ height: 240 }} aria-busy="true" /> });

export function LocationSheet({ open, onClose, denied }: { open: boolean; onClose: () => void; denied?: boolean }) {
  const { state, update } = useSession();
  const { status, locate } = useLocate(onClose);
  const areas = useQuery({ queryKey: ["areas"], queryFn: () => api.areas(), staleTime: Infinity, enabled: open });
  const list: (Place & { n?: number })[] = areas.data?.items.length
    ? areas.data.items.map((a) => ({ label: a.label, lat: a.lat, lon: a.lon, source: "area" as const, n: a.shop_count }))
    : AREAS;
  const [pick, setPick] = useState<Place>(state.place.source === "gps" ? AREAS[0] : state.place);
  const [q, setQ] = useState("");
  const [map, setMap] = useState(false);
  const shown = list.filter((a) => !q.trim() || a.label.includes(q.trim())).slice(0, q.trim() ? 30 : 12);
  return (
    <Sheet open={open} onClose={onClose} label="انتخاب محدوده">
      <h2>کجا خرید می‌کنید؟</h2>
      <p className="lede" style={{ marginTop: -8 }}>موقعیت فقط برای حساب فاصله و زمان رسیدن استفاده می‌شود. محدوده‌ها همان‌هایی‌اند که فروشگاه‌های ترب در آن‌ها هستند.</p>
      {(denied || status === "denied") && <Note tone="warn" icon="pin">به موقعیت شما دسترسی نداریم. محدوده را انتخاب کنید یا روی نقشه بزنید.</Note>}
      <button className="btn sec block" onClick={() => { locate(); }} disabled={status === "asking"}>
        {status === "asking" ? <span className="spin" /> : <Icon n="loc" s />}{status === "asking" ? "در حال یافتن موقعیت…" : "استفاده از موقعیت فعلی من"}
      </button>
      <div className="field"><Icon n="search" s /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی محله، مثلاً تجریش" aria-label="جستجوی محله" /></div>
      <div className="wrapr" role="radiogroup" aria-label="محدوده‌ها">
        {shown.map((a) => (
          <button key={a.label} type="button" role="radio" aria-checked={pick.label === a.label} className={`chip ${pick.label === a.label ? "on" : ""}`} style={{ minHeight: 42 }} onClick={() => setPick(a)}>
            {pick.label === a.label && <Icon n="check" s />}{a.label}{a.n ? <span className="xs faint">{fa(a.n)}</span> : null}
          </button>
        ))}
        {!shown.length && <span className="xs faint">محله‌ای با این نام در داده‌ها نیست؛ روی نقشه بزنید.</span>}
      </div>
      <button type="button" className="btn ghost" style={{ alignSelf: "flex-start", paddingInline: 0 }} onClick={() => setMap(!map)}><Icon n="map" s />{map ? "بستن نقشه" : "انتخاب نقطه روی نقشه"}</button>
      {map && <PinMap lat={pick.lat} lon={pick.lon} onPick={(lat, lon) => setPick({ lat, lon, label: "نقطهٔ انتخابی روی نقشه", source: "pin" })} />}
      <button className="btn pri block" onClick={() => { update((s) => ({ ...s, locationAsked: true, place: pick })); onClose(); }}>ادامه با «{pick.label}»</button>
    </Sheet>
  );
}
