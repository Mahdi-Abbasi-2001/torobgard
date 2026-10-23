"use client";
// The way to the shop, drawn on our own tilted map (board 2 of the autopilot design): the real street route draws itself, a turn card tells
// you what to do next and how far, «preview» flies a camera along the walk, and «follow me» tracks your position (inside Tehran only)
// and re-routes when you leave the line. Streets and turns come from /api/route; if that is unavailable the line is straight and says so.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useRoute } from "@/lib/useRoute";
import { fa } from "@/lib/fa";
import { outsideTehran } from "@/lib/geo";
import { addBuildings, along, applyLight, bearing, clockMinute, cumulative, ease, keepInView, maplibregl, meters, STYLE, type LL } from "@/lib/maplib";
import "maplibre-gl/dist/maplibre-gl.css";

const TURN_DEG: Record<string, number> = { left: -90, right: 90, "slight left": -45, "slight right": 45, "sharp left": -135, "sharp right": 135, straight: 0, uturn: 180 };
const dist = (m: number) => (m >= 950 ? `${fa((m / 1000).toFixed(1).replace(".", "٫"))} کیلومتر` : `${fa(Math.max(5, Math.round(m / 5) * 5))} متر`);

export default function RouteMap({ from, to, label, mode, height, onUnavailable, onArrive }: { from: LL; to: LL; label: string; mode: "walk" | "taxi" | "car"; height: number | string; onUnavailable?: () => void; onArrive?: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const raf = useRef(0);
  const watch = useRef<number | null>(null);
  const off = useRef(0);
  const [ready, setReady] = useState(false);
  const [origin, setOrigin] = useState<LL>(from);
  const [mode3, setMode3] = useState<"idle" | "preview" | "live">("idle");
  const [travelled, setTravelled] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const { lat: fla, lon: flo } = from, { lat: tla, lon: tlo } = to;

  // a new start point from outside (the shopper changed it) resets the route
  useEffect(() => { Promise.resolve().then(() => setOrigin({ lat: fla, lon: flo })); }, [fla, flo]);
  const route = useRoute(origin, to, mode);
  const plan = route.data;
  const pts = plan?.points;
  const cum = useMemo(() => (pts ? cumulative(pts) : [0]), [pts]);
  const total = cum[cum.length - 1] || 1;
  const scale = (plan?.distance_m ?? total) / total; // routed metres per polyline metre

  // map
  useEffect(() => {
    if (!el.current) return;
    const a = { lat: fla, lon: flo }, b = { lat: tla, lon: tlo };
    const km = meters(a, b) / 1000;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({ container: el.current, style: STYLE, center: [(a.lon + b.lon) / 2, (a.lat + b.lat) / 2], zoom: km > 1.2 ? 14.4 : km > 0.5 ? 15.2 : 16, pitch: 58, bearing: bearing(a, b), attributionControl: { compact: true } });
    } catch { Promise.resolve().then(() => onUnavailable?.()); return; }
    map.current = m;
    applyLight(el.current?.parentElement ?? null, clockMinute());
    m.on("error", (e: maplibregl.ErrorEvent) => { if (!m.isStyleLoaded() && String(e.error?.message ?? "").includes("fetch")) onUnavailable?.(); });
    m.on("load", () => {
      addBuildings(m);
      const empty = { type: "FeatureCollection" as const, features: [] };
      m.addSource("walk", { type: "geojson", data: empty });
      m.addSource("walked", { type: "geojson", data: empty });
      m.addLayer({ id: "walk-casing", type: "line", source: "walk", paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.92 }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "walk", type: "line", source: "walk", paint: { "line-color": "#d73948", "line-width": 6 }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "walked", type: "line", source: "walked", paint: { "line-color": "#9aa0b0", "line-width": 6 }, layout: { "line-cap": "round", "line-join": "round" } });
      const dot = document.createElement("div"); dot.className = "rm-me"; dot.setAttribute("aria-label", "شما");
      meMarker.current = new maplibregl.Marker({ element: dot }).setLngLat([a.lon, a.lat]).addTo(m);
      const pin = document.createElement("div"); const pinIn = document.createElement("div"); pinIn.className = "rm-pin"; pinIn.textContent = label.slice(0, 24); pin.appendChild(pinIn); // the animation sits on the inner element: MapLibre positions the outer one with transform
      new maplibregl.Marker({ element: pin, anchor: "bottom" }).setLngLat([b.lon, b.lat]).addTo(m);
      setReady(true);
    });
    return () => { cancelAnimationFrame(raf.current); if (watch.current != null) navigator.geolocation.clearWatch(watch.current); m.remove(); map.current = null; meMarker.current = null; setReady(false); };
  }, [fla, flo, tla, tlo, label]); // eslint-disable-line react-hooks/exhaustive-deps -- rebuilt only when the two ends change

  // the route draws itself, then the camera frames it
  useEffect(() => {
    const m = map.current; if (!m || !ready || !pts) return;
    const walk = m.getSource("walk") as maplibregl.GeoJSONSource, walked = m.getSource("walked") as maplibregl.GeoJSONSource;
    walked.setData({ type: "FeatureCollection", features: [] });
    meMarker.current?.setLngLat([origin.lon, origin.lat]);
    const lonlat = pts.map(([la, lo]) => [lo, la] as [number, number]);
    const t0 = performance.now(); const dur = 1700;
    const step = (now: number) => {
      const t = ease(Math.min(1, (now - t0) / dur));
      const n = Math.max(2, Math.round(lonlat.length * t));
      walk.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: lonlat.slice(0, n) } });
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    const bnd = new maplibregl.LngLatBounds(lonlat[0], lonlat[0]); lonlat.forEach((p) => bnd.extend(p));
    m.fitBounds(bnd, { padding: { top: 130, bottom: 110, left: 50, right: 50 }, maxZoom: 17, pitch: 58, bearing: bearing({ lat: pts[0][0], lon: pts[0][1] }, { lat: pts[pts.length - 1][0], lon: pts[pts.length - 1][1] }), duration: 1400 });
    keepInView(m, [{ lat: pts[0][0], lon: pts[0][1] }, { lat: pts[pts.length - 1][0], lon: pts[pts.length - 1][1] }], 50, 130);
    return () => cancelAnimationFrame(raf.current);
  }, [pts, ready]); // eslint-disable-line react-hooks/exhaustive-deps -- origin only places the dot; the route's own change redraws

  // the grey «already walked» part follows the progress
  useEffect(() => {
    const m = map.current; if (!m || !ready || !pts || mode3 === "idle") return;
    const src = m.getSource("walked") as maplibregl.GeoJSONSource | undefined; if (!src) return;
    const s = travelled / scale; const here = along(pts, cum, s);
    const done = pts.filter((_, i) => cum[i] <= s).map(([la, lo]) => [lo, la] as [number, number]);
    src.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [...done, [here.at.lon, here.at.lat]] } });
  }, [travelled, mode3, ready, pts, cum, scale]);

  const stop = () => {
    cancelAnimationFrame(raf.current);
    if (watch.current != null) { navigator.geolocation.clearWatch(watch.current); watch.current = null; }
    setMode3("idle"); setNote(null);
  };

  // preview: a camera walks the route at flying speed, low and tilted
  const preview = () => {
    const m = map.current; if (!m || !pts) return;
    stop(); setMode3("preview"); setTravelled(0);
    const dur = Math.min(22000, Math.max(8000, total * 16)), t0 = performance.now(); let lastSet = 0; let head = bearing({ lat: pts[0][0], lon: pts[0][1] }, { lat: pts[1][0], lon: pts[1][1] });
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur), s = total * ease(t);
      const here = along(pts, cum, s), ahead = along(pts, cum, s + 35);
      const target = bearing(here.at, ahead.at); let d = target - head; d = ((d + 540) % 360) - 180; head += d * 0.08;
      m.jumpTo({ center: [here.at.lon, here.at.lat], bearing: head, pitch: 66, zoom: 17.5 });
      meMarker.current?.setLngLat([here.at.lon, here.at.lat]);
      if (now - lastSet > 120 || t >= 1) { lastSet = now; setTravelled(s * scale); }
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else { setMode3("idle"); m.easeTo({ pitch: 58, zoom: 17, duration: 900 }); }
    };
    raf.current = requestAnimationFrame(tick);
  };

  // live: follow the real position (never outside Tehran), re-route if the shopper leaves the line
  const live = () => {
    const m = map.current; if (!m || !pts) return;
    if (!("geolocation" in navigator)) { setNote("به موقعیت شما دسترسی نداریم."); return; }
    stop(); setMode3("live"); setNote("در حال پیدا کردن موقعیت شما…"); off.current = 0;
    watch.current = navigator.geolocation.watchPosition((p) => {
      const here = { lat: p.coords.latitude, lon: p.coords.longitude };
      if (outsideTehran(here)) { stop(); setNote("به نظر می‌رسد در تهران نیستید؛ پیش‌نمایش مسیر را ببینید."); return; }
      setNote(null); meMarker.current?.setLngLat([here.lon, here.lat]);
      let best = 0, bd = Infinity;
      pts.forEach(([la, lo], i) => { const d = meters(here, { lat: la, lon: lo }); if (d < bd) { bd = d; best = i; } });
      if (bd > 70) { off.current += 1; if (off.current >= 2) { off.current = 0; setNote("از مسیر دور شدید؛ مسیر تازه را می‌چینم…"); setOrigin(here); } return; }
      off.current = 0; setTravelled(cum[best] * scale);
      const ahead = along(pts, cum, cum[best] + 35);
      m.easeTo({ center: [here.lon, here.lat], bearing: bearing(here, ahead.at), pitch: 64, zoom: 17.3, duration: 900 });
    }, () => { stop(); setNote("به موقعیت شما دسترسی نداریم؛ پیش‌نمایش مسیر را ببینید."); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  };

  // the turn card
  const steps = plan?.steps ?? [];
  let cur = 0; steps.forEach((s, i) => { if (travelled >= s.at_m - 1) cur = i; });
  const step = steps[cur], next = steps[cur + 1];
  const left = plan ? Math.max(0, plan.distance_m - travelled) : 0;
  const arrived = !!plan && left < 20 && travelled > 0;
  const mins = plan ? Math.max(plan.minutes ? 1 : 0, Math.ceil(plan.minutes * (left / (plan.distance_m || 1)))) : 0;
  // the card tells what to do at the NEXT maneuver and how far it is (the first words are «start walking»)
  const starting = travelled < 15 && step?.type === "depart";
  const upcoming = starting ? step : next;
  const toNext = starting ? (next ? next.at_m : left) : next ? Math.max(0, next.at_m - travelled) : left;
  const text = arrived ? "رسیدید" : starting ? step!.text : next ? (next.type === "arrive" ? `به ${label} می‌رسید` : next.text) : `به ${label} می‌رسید`;
  const deg = arrived || !upcoming || upcoming.type === "arrive" ? 0 : TURN_DEG[upcoming.modifier] ?? 0;
  const ring = plan ? 100 * (1 - left / (plan.distance_m || 1)) : 0;
  const straight = plan?.source === "straight";
  const said = useRef(false);
  useEffect(() => { if (arrived && !said.current) { said.current = true; onArrive?.(); } if (!arrived) said.current = false; }, [arrived]); // eslint-disable-line react-hooks/exhaustive-deps -- fires once per arrival

  return (
    <div className="rm" style={{ height }}>
      <div ref={el} className="rm-map" style={{ position: "absolute", inset: 0 }} />
      {!ready || route.isLoading ? <div className="sk rm-load" aria-busy="true" /> : null}
      {ready && plan && (
        <>
          <div className="rm-card" aria-live="polite">
            <span className="rm-ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: `rotate(${deg}deg)`, transition: "transform .5s" }}><path d="M12 20V5M6 11l6-6 6 6" /></svg></span>
            <div className="rm-txt">
              <span className="rm-sub">{straight ? "مسیر خیابانی در دسترس نبود؛ خط مستقیم تا مقصد" : arrived ? label : `${dist(toNext)} دیگر`}</span>
              <b>{text}</b>
            </div>
            <div className="rm-eta" aria-label={`${fa(mins)} دقیقه`}>
              <svg width="50" height="50" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="3.5" /><circle cx="18" cy="18" r="15" fill="none" stroke="#ff6b78" strokeWidth="3.5" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - ring} transform="rotate(-90 18 18)" style={{ transition: "stroke-dashoffset .4s linear" }} /></svg>
              <span>{fa(mins)}<small>دقیقه</small></span>
            </div>
          </div>
          <div className="rm-bar">
            {mode3 === "idle" ? (
              <>
                {!straight && <button type="button" className="btn pri" onClick={preview}><Icon n="walk" s />پیش‌نمایش مسیر</button>}
                <button type="button" className="btn sec" onClick={live}><Icon n="loc" s />مسیریابی زنده</button>
              </>
            ) : <button type="button" className="btn pri" onClick={stop}><Icon n="x" s />توقف</button>}
          </div>
          {note && <div className="rm-note" role="status">{note}</div>}
        </>
      )}
      {route.isError && ready && <div className="rm-note" role="status">مسیر پیدا نشد؛ نقشهٔ ساده را ببینید.</div>}
    </div>
  );
}

/** The turns as a list (the trip screen's body), from the same cached route. */
export function RouteSteps({ from, to, mode }: { from: LL; to: LL; mode: "walk" | "taxi" | "car" }) {
  const { data } = useRoute(from, to, mode);
  if (!data || data.source !== "osrm" || data.steps.length < 2) return null;
  return (
    <ol className="rs">
      {data.steps.map((s, i) => (
        <li key={i}><span className="rs-n">{fa(i + 1)}</span><span className="grow">{s.text}</span>{s.distance_m > 0 && <span className="xs faint">{dist(s.distance_m)}</span>}</li>
      ))}
    </ol>
  );
}
