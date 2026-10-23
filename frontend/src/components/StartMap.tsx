"use client";
// The first page's backdrop: the market around you, alive. Shops that declare they are open right now glow and breathe, shut ones go grey,
// shops whose hours we do not know stay hollow; the light follows the clock and the camera drifts. When the shopper sends their sentence the
// camera tilts in toward them and a sonar spreads: the same motion the autopilot continues. Data: /api/pulse (hours the shops declared).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { addBuildings, applyLight, clockMinute, maplibregl, STYLE, type LL } from "@/lib/maplib";
import "maplibre-gl/dist/maplibre-gl.css";

export type StartStats = { open: number; known: number; total: number };

export default function StartMap({ origin, going, padBottom, onStats, onUnavailable }: { origin: LL; going: boolean; padBottom: number; onStats?: (s: StartStats) => void; onUnavailable?: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const me = useRef<HTMLElement | null>(null);
  const raf = useRef(0);
  const [ready, setReady] = useState(false);
  const [minute, setMinute] = useState(clockMinute);
  const { lat: ola, lon: olo } = origin;
  useEffect(() => { const id = setInterval(() => setMinute(clockMinute()), 60_000); return () => clearInterval(id); }, []);
  const data = useQuery({ queryKey: ["pulse", ola.toFixed(4), olo.toFixed(4)], staleTime: 10 * 60_000, queryFn: () => api.pulse({ lat: ola, lon: olo, radius_km: 1.4, limit: 900 }) });
  const shops = useMemo(() => data.data?.shops ?? [], [data.data]);
  const states = useMemo(() => shops.map((s) => (s.known ? (s.shifts.some(([a, b]) => minute >= a && minute < b) ? 1 : 0) : 2)), [shops, minute]);
  const open = states.filter((x) => x === 1).length, known = shops.filter((s) => s.known).length;
  useEffect(() => { if (shops.length) onStats?.({ open, known, total: data.data?.total ?? shops.length }); }, [open, known, shops.length]); // eslint-disable-line react-hooks/exhaustive-deps -- reports counts only

  useEffect(() => {
    if (!el.current) return;
    let m: maplibregl.Map;
    try { m = new maplibregl.Map({ container: el.current, style: STYLE, center: [olo, ola], zoom: 14.7, pitch: 50, bearing: -12, interactive: false, attributionControl: false }); }
    catch { Promise.resolve().then(() => onUnavailable?.()); return; }
    map.current = m;
    m.on("error", (e: maplibregl.ErrorEvent) => { if (!m.isStyleLoaded() && String(e.error?.message ?? "").includes("fetch")) onUnavailable?.(); });
    m.on("load", () => {
      addBuildings(m);
      m.addSource("shops", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "halo", type: "circle", source: "shops", filter: ["==", ["get", "st"], 1], paint: { "circle-color": "#17803d", "circle-radius": 12, "circle-opacity": 0.22, "circle-blur": 0.6 } });
      m.addLayer({ id: "dots", type: "circle", source: "shops", paint: {
        "circle-radius": ["match", ["get", "st"], 1, 5.5, 0, 3.6, 3.2], "circle-color": ["match", ["get", "st"], 1, "#17803d", 0, "#b7bcc9", "#ffffff"],
        "circle-stroke-color": ["match", ["get", "st"], 1, "#ffffff", 0, "#ffffff", "#9aa0b0"], "circle-stroke-width": ["match", ["get", "st"], 2, 1.2, 1.5], "circle-opacity": ["match", ["get", "st"], 2, 0.85, 1] } });
      const node = document.createElement("div"); node.className = "mk-me"; node.innerHTML = '<span class="mk-sonar"></span><span class="mk-sonar b"></span><span class="mk-medot"></span>';
      me.current = node;
      new maplibregl.Marker({ element: node }).setLngLat([olo, ola]).addTo(m);
      setReady(true);
    });
    return () => { cancelAnimationFrame(raf.current); m.remove(); map.current = null; me.current = null; setReady(false); };
  }, [ola, olo]); // eslint-disable-line react-hooks/exhaustive-deps -- rebuilt only when the start moves

  useEffect(() => { const m = map.current; if (m && ready) m.setPadding({ bottom: padBottom, top: 30, left: 0, right: 0 }); }, [padBottom, ready]);
  useEffect(() => applyLight(box.current, minute), [minute]);

  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const src = m.getSource("shops") as maplibregl.GeoJSONSource | undefined; if (!src) return;
    src.setData({ type: "FeatureCollection", features: shops.map((s, i) => ({ type: "Feature" as const, properties: { st: states[i] }, geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] } })) });
  }, [shops, states, ready]);

  // open shops breathe; the camera drifts a few degrees (stops while the shopper's sentence is being handled)
  useEffect(() => {
    const m = map.current; if (!m || !ready || going) return;
    const t0 = performance.now(); let last = 0;
    const tick = (now: number) => {
      if (now - last > 80) {
        last = now; const k = (Math.sin((now - t0) / 520) + 1) / 2;
        if (m.getLayer("halo")) { m.setPaintProperty("halo", "circle-radius", 9 + 9 * k); m.setPaintProperty("halo", "circle-opacity", 0.32 - 0.22 * k); }
        m.setBearing(-12 + 6 * Math.sin((now - t0) / 9000));
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [ready, going]);

  // the sentence is sent: tilt in toward you, sonar on
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    me.current?.classList.toggle("on", going);
    if (going) m.easeTo({ zoom: 16.1, pitch: 62, bearing: -18, duration: 1800, easing: (t) => 1 - Math.pow(1 - t, 3) });
    else m.easeTo({ zoom: 14.7, pitch: 50, duration: 1200 });
  }, [going, ready]);

  return (
    <div ref={box} className="stm" aria-hidden="true">
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {!ready && <div className="stm-load" />}
    </div>
  );
}
