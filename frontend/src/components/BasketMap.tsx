"use client";
// The basket trip on the tilted map: you, then each stop as a numbered pin carrying the coloured badges of the items bought there, and the
// street route between them drawn leg by leg. Positions are the shops' real coordinates; legs come from /api/route.
import { useEffect, useRef, useState } from "react";
import { addBuildings, applyLight, bearing, clockMinute, keepInView, maplibregl, STYLE, type LL } from "@/lib/maplib";
import "maplibre-gl/dist/maplibre-gl.css";

export type BasketPin = { id: string; n: number; name: string; lat: number; lon: number; badges: { n: string; color: string }[] };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export default function BasketMap({ origin, pins, legs, height, onUnavailable }: { origin: LL; pins: BasketPin[]; legs: [number, number][][]; height: number | string; onUnavailable?: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marks = useRef<maplibregl.Marker[]>([]);
  const raf = useRef(0);
  const [ready, setReady] = useState(false);
  const { lat: ola, lon: olo } = origin;

  useEffect(() => {
    if (!el.current) return;
    let m: maplibregl.Map;
    try { m = new maplibregl.Map({ container: el.current, style: STYLE, center: [olo, ola], zoom: 15, pitch: 55, bearing: -15, attributionControl: { compact: true } }); }
    catch { Promise.resolve().then(() => onUnavailable?.()); return; }
    map.current = m;
    applyLight(el.current?.parentElement ?? null, clockMinute());
    m.on("error", (e: maplibregl.ErrorEvent) => { if (!m.isStyleLoaded() && String(e.error?.message ?? "").includes("fetch")) onUnavailable?.(); });
    m.on("load", () => {
      addBuildings(m);
      m.addSource("legs", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "legs-casing", type: "line", source: "legs", paint: { "line-color": "#fff", "line-width": 9, "line-opacity": 0.9 }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "legs", type: "line", source: "legs", paint: { "line-color": "#d73948", "line-width": 5 }, layout: { "line-cap": "round", "line-join": "round" } });
      const dot = document.createElement("div"); dot.className = "rm-me";
      new maplibregl.Marker({ element: dot }).setLngLat([olo, ola]).addTo(m);
      setReady(true);
    });
    return () => { cancelAnimationFrame(raf.current); marks.current.forEach((x) => x.remove()); marks.current = []; m.remove(); map.current = null; setReady(false); };
  }, [ola, olo]); // eslint-disable-line react-hooks/exhaustive-deps -- rebuilt only when the start moves

  // the stops, as pins with their items' badges
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    marks.current.forEach((x) => x.remove()); marks.current = [];
    pins.forEach((p) => {
      const node = document.createElement("div"); node.className = "bk-pin";
      node.innerHTML = `<div class="bk-in"><span class="bk-t"><b>${p.n}</b>${esc(p.name)}</span><span class="bk-b">${p.badges.map((b) => `<i style="background:${b.color}">${b.n}</i>`).join("")}</span><span class="bk-s"></span></div>`;
      marks.current.push(new maplibregl.Marker({ element: node, anchor: "bottom" }).setLngLat([p.lon, p.lat]).addTo(m));
    });
    if (pins.length) {
      const b = new maplibregl.LngLatBounds([olo, ola], [olo, ola]); pins.forEach((p) => b.extend([p.lon, p.lat]));
      m.fitBounds(b, { padding: { top: 130, bottom: 90, left: 60, right: 60 }, maxZoom: 16.5, pitch: 55, bearing: bearing({ lat: ola, lon: olo }, pins[0]), duration: 1600 });
      keepInView(m, [{ lat: ola, lon: olo }, ...pins], 60, 130);
    }
  }, [pins, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // the legs draw themselves one after the other
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const src = m.getSource("legs") as maplibregl.GeoJSONSource | undefined; if (!src) return;
    const lines = legs.filter((l) => l.length > 1).map((l) => l.map(([la, lo]) => [lo, la] as [number, number]));
    const total = lines.reduce((n, l) => n + l.length, 0); if (!total) { src.setData({ type: "FeatureCollection", features: [] }); return; }
    const t0 = performance.now(), dur = 2200;
    const step = (now: number) => {
      const upto = Math.round(total * Math.min(1, (now - t0) / dur)); let used = 0;
      const feats = lines.map((l) => { const take = Math.max(0, Math.min(l.length, upto - used)); used += l.length; return take > 1 ? { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: l.slice(0, take) } } : null; }).filter((x): x is NonNullable<typeof x> => !!x);
      src.setData({ type: "FeatureCollection", features: feats });
      if (upto < total) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [legs, ready]);

  return <div className="mm" style={{ height }}><div ref={el} style={{ position: "absolute", inset: 0 }} />{!ready && <div className="sk mm-load" aria-busy="true" />}</div>;
}
