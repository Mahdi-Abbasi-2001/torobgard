"use client";
// The bazaar breathing: every shop near you as a dot on the tilted map, and a clock you can slide (or play) from morning to night. Shops that
// declare they are open at that minute glow and pulse; shops that declare they are shut go grey; shops whose hours we do not know stay a hollow
// dot, never counted as either. The night tint follows the clock. Shifts come from /api/pulse (the hours the shops themselves declared).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fa } from "@/lib/fa";
import { Icon } from "@/components/Icon";
import { addBuildings, applyLight, maplibregl, STYLE, type LL } from "@/lib/maplib";
import "maplibre-gl/dist/maplibre-gl.css";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const nowMin = () => { const d = new Date(); return Math.min(1425, Math.max(360, d.getHours() * 60 + d.getMinutes())); };
const DAY_FA: Record<string, string> = { sat: "شنبه", sun: "یکشنبه", mon: "دوشنبه", tue: "سه‌شنبه", wed: "چهارشنبه", thu: "پنجشنبه", fri: "جمعه" };

export default function PulseMap({ origin, mine = [], height, onPick, onUnavailable }: { origin: LL; mine?: string[]; height: number | string; onPick?: (hhmm: string) => void; onUnavailable?: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const raf = useRef(0);
  const [ready, setReady] = useState(false);
  const [minute, setMinute] = useState(nowMin);
  const [playing, setPlaying] = useState(false);
  const { lat: ola, lon: olo } = origin;
  const data = useQuery({ queryKey: ["pulse", ola.toFixed(4), olo.toFixed(4)], staleTime: 10 * 60_000, queryFn: () => api.pulse({ lat: ola, lon: olo, radius_km: 1.4, limit: 900 }) });
  const shops = useMemo(() => data.data?.shops ?? [], [data.data]);

  const states = useMemo(() => shops.map((s) => (s.known ? (s.shifts.some(([a, b]) => minute >= a && minute < b) ? 1 : 0) : 2)), [shops, minute]);
  const open = states.filter((x) => x === 1).length, known = shops.filter((s) => s.known).length;

  useEffect(() => {
    if (!el.current) return;
    let m: maplibregl.Map;
    try { m = new maplibregl.Map({ container: el.current, style: STYLE, center: [olo, ola], zoom: 14.9, pitch: 48, bearing: -10, attributionControl: { compact: true } }); }
    catch { Promise.resolve().then(() => onUnavailable?.()); return; }
    map.current = m;
    m.setPadding({ bottom: 250, top: 10, left: 0, right: 0 }); // the control panel covers the lower part: the centre of the picture sits above it
    m.on("error", (e: maplibregl.ErrorEvent) => { if (!m.isStyleLoaded() && String(e.error?.message ?? "").includes("fetch")) onUnavailable?.(); });
    m.on("load", () => {
      addBuildings(m);
      m.addSource("shops", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "halo", type: "circle", source: "shops", filter: ["==", ["get", "st"], 1], paint: { "circle-color": "#17803d", "circle-radius": 12, "circle-opacity": 0.22, "circle-blur": 0.6 } });
      m.addLayer({ id: "dots", type: "circle", source: "shops", paint: {
        "circle-radius": ["match", ["get", "st"], 1, 5.5, 0, 3.6, 3.2],
        "circle-color": ["match", ["get", "st"], 1, "#17803d", 0, "#b7bcc9", "#ffffff"],
        "circle-stroke-color": ["match", ["get", "st"], 1, "#ffffff", 0, "#ffffff", "#9aa0b0"], "circle-stroke-width": ["match", ["get", "st"], 2, 1.2, 1.5], "circle-opacity": ["match", ["get", "st"], 2, 0.85, 1] } });
      m.addLayer({ id: "mine", type: "circle", source: "shops", filter: ["==", ["get", "mine"], 1], paint: { "circle-radius": 10, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#d73948", "circle-stroke-width": 2.4 } });
      const dot = document.createElement("div"); dot.className = "rm-me";
      new maplibregl.Marker({ element: dot }).setLngLat([olo, ola]).addTo(m);
      setReady(true);
    });
    return () => { cancelAnimationFrame(raf.current); m.remove(); map.current = null; setReady(false); };
  }, [ola, olo]); // eslint-disable-line react-hooks/exhaustive-deps -- rebuilt only when the start moves

  // the map light follows the slider
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => applyLight(box.current, minute), [minute]);

  // the dots follow the clock
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const src = m.getSource("shops") as maplibregl.GeoJSONSource | undefined; if (!src) return;
    src.setData({ type: "FeatureCollection", features: shops.map((s, i) => ({ type: "Feature" as const, properties: { st: states[i], mine: mine.includes(s.shop_id) ? 1 : 0 }, geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] } })) });
  }, [shops, states, ready, mine]);

  // the open shops breathe
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const t0 = performance.now();
    const tick = (now: number) => { const k = (Math.sin((now - t0) / 520) + 1) / 2; if (m.getLayer("halo")) { m.setPaintProperty("halo", "circle-radius", 9 + 9 * k); m.setPaintProperty("halo", "circle-opacity", 0.32 - 0.22 * k); } raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [ready]);

  // play: the day passes in about twenty seconds
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setMinute((x) => { if (x >= 1425) { setPlaying(false); return 1425; } return x + 10; }), 110);
    return () => clearInterval(id);
  }, [playing]);

  return (
    <div className="pm" style={{ height }} ref={box}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {(!ready || data.isLoading) && <div className="sk mm-load" aria-busy="true" />}
      <div className="pm-panel">
        <div className="row between" style={{ alignItems: "baseline" }}>
          <b className="pm-time">{fa(hhmm(minute))}</b>
          <span className="xs muted">{DAY_FA[data.data?.weekday ?? ""] ?? ""}</span>
        </div>
        <div className="pm-count"><b>{fa(open)}</b> فروشگاه باز<span className="xs faint"> از {fa(known)} فروشگاهی که ساعتش را می‌دانیم، از {fa(shops.length)} فروشگاه</span></div>
        <input type="range" className="pm-range" min={360} max={1439} step={15} value={minute} aria-label="ساعت" onChange={(e) => { setPlaying(false); setMinute(+e.target.value); }} />
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn sec" onClick={() => { if (minute >= 1425) setMinute(360); setPlaying((p) => !p); }}><Icon n={playing ? "x" : "walk"} s />{playing ? "توقف" : "پخش روز"}</button>
          {onPick && <button type="button" className="btn pri grow" onClick={() => onPick(hhmm(minute))}>انتخاب همین ساعت</button>}
        </div>
        <span className="xs faint">سبز: بازِ اعلام‌شده، خاکستری: بستهٔ اعلام‌شده، توخالی: ساعتش را نمی‌دانیم. حلقهٔ قرمز: فروشگاه‌هایی که این کالا را دارند.</span>
      </div>
    </div>
  );
}
