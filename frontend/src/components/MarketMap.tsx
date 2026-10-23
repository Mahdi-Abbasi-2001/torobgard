"use client";
// The shops answering, on a tilted 3D map (board 1 of the autopilot design). A sonar spreads from you while the questions are out; each
// shop's pin changes with its answer (asked: pulsing blue, confirmed: green with the price, held, gone: grey and struck out); a confirmed
// shop gets an arc drawn to you; when the best answer is known the camera glides to it. Positions are the shops' real coordinates.
import { useEffect, useRef, useState } from "react";
import { addBuildings, applyLight, arc, bearing, clockMinute, keepInView, maplibregl, STYLE, type LL } from "@/lib/maplib";
import "maplibre-gl/dist/maplibre-gl.css";

export type MarketPin = { id: string; name: string; lat: number; lon: number; state: "idle" | "asked" | "confirmed" | "held" | "gone"; label: string };

type Props = { origin: LL; pins: MarketPin[]; bestId: string | null; asking: boolean; height: number | string; onPick?: (id: string) => void; onUnavailable?: () => void };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export default function MarketMap({ origin, pins, bestId, asking, height, onPick, onUnavailable }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, { m: maplibregl.Marker; node: HTMLElement }>());
  const me = useRef<{ m: maplibregl.Marker; node: HTMLElement } | null>(null);
  const grow = useRef(new Map<string, number>()); // arc progress per shop, 0..1
  const raf = useRef(0);
  const fitted = useRef(false);
  const flown = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const pinsRef = useRef(pins);
  useEffect(() => { pinsRef.current = pins; });
  const { lat: ola, lon: olo } = origin;

  useEffect(() => {
    if (!el.current) return;
    const mk = markers.current;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({ container: el.current, style: STYLE, center: [olo, ola], zoom: 14.8, pitch: 52, bearing: -12, attributionControl: { compact: true } });
    } catch { Promise.resolve().then(() => onUnavailable?.()); return; }
    map.current = m;
    applyLight(el.current?.parentElement ?? null, clockMinute());
    m.on("error", (e: maplibregl.ErrorEvent) => { if (!m.isStyleLoaded() && String(e.error?.message ?? "").includes("fetch")) onUnavailable?.(); });
    m.on("load", () => {
      addBuildings(m);
      m.addSource("arcs", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "arcs-casing", type: "line", source: "arcs", paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.85 }, layout: { "line-cap": "round" } });
      m.addLayer({ id: "arcs", type: "line", source: "arcs", paint: { "line-color": "#17803d", "line-width": 3.5 }, layout: { "line-cap": "round" } });
      const node = document.createElement("div"); node.className = "mk-me"; node.innerHTML = '<span class="mk-sonar"></span><span class="mk-sonar b"></span><span class="mk-medot"></span>';
      me.current = { m: new maplibregl.Marker({ element: node }).setLngLat([olo, ola]).addTo(m), node };
      setReady(true);
    });
    return () => { cancelAnimationFrame(raf.current); mk.forEach((x) => x.m.remove()); mk.clear(); me.current?.m.remove(); me.current = null; m.remove(); map.current = null; fitted.current = false; flown.current = null; setReady(false); };
  }, [ola, olo]); // eslint-disable-line react-hooks/exhaustive-deps -- the map is rebuilt only when the start point moves

  // sonar on while the questions are out
  useEffect(() => { me.current?.node.classList.toggle("on", asking); }, [asking, ready]);

  // pins follow the answers
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const seen = new Set<string>();
    pins.forEach((p) => {
      seen.add(p.id);
      let x = markers.current.get(p.id);
      if (!x) {
        const node = document.createElement("button"); node.type = "button"; node.setAttribute("aria-label", p.name);
        node.innerHTML = '<span class="mk-chip"></span><span class="mk-dot"></span><span class="mk-name"></span>';
        node.addEventListener("click", () => onPick?.(p.id));
        x = { m: new maplibregl.Marker({ element: node }).setLngLat([p.lon, p.lat]).addTo(m), node };
        markers.current.set(p.id, x);
      }
      const cl = x.node.classList; // keep MapLibre's own marker class: it does the positioning
      ["idle", "asked", "confirmed", "held", "gone", "best", "dim"].forEach((c) => cl.remove(c));
      cl.add("mk", p.state); if (p.id === bestId) cl.add("best"); else if (bestId) cl.add("dim");
      (x.node.querySelector(".mk-chip") as HTMLElement).textContent = p.label;
      (x.node.querySelector(".mk-name") as HTMLElement).innerHTML = esc(p.name);
    });
    markers.current.forEach((x, id) => { if (!seen.has(id)) { x.m.remove(); markers.current.delete(id); grow.current.delete(id); } });
    // a confirmed shop gets its arc; the arc grows toward you
    pins.forEach((p) => { if ((p.state === "confirmed" || p.state === "held") && !grow.current.has(p.id)) grow.current.set(p.id, 0); });
    grow.current.forEach((_, id) => { const p = pins.find((q) => q.id === id); if (!p || (p.state !== "confirmed" && p.state !== "held")) grow.current.delete(id); });
    if (!raf.current) {
      const tick = () => {
        raf.current = 0;
        const src = m.getSource("arcs") as maplibregl.GeoJSONSource | undefined;
        if (!src) return;
        let busy = false;
        const feats = [...grow.current.entries()].map(([id, g]) => {
          const p = pinsRef.current.find((q) => q.id === id); const ng = Math.min(1, g + 0.035); if (ng < 1) busy = true; grow.current.set(id, ng);
          const full = p ? arc({ lat: p.lat, lon: p.lon }, { lat: ola, lon: olo }) : [];
          return { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: full.slice(0, Math.max(2, Math.round(full.length * ng))) } };
        });
        src.setData({ type: "FeatureCollection", features: feats });
        if (busy) raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    }
    // first time there is something to show: frame you and the shops
    if (!fitted.current && pins.length) {
      fitted.current = true;
      const b = new maplibregl.LngLatBounds([olo, ola], [olo, ola]);
      pins.forEach((p) => b.extend([p.lon, p.lat]));
      m.fitBounds(b, { padding: { top: 120, bottom: 220, left: 50, right: 50 }, maxZoom: 16.2, pitch: 52, duration: 1400 });
      keepInView(m, [{ lat: ola, lon: olo }, ...pins]);
    }
  }, [pins, bestId, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // the best answer is in: the camera glides to it
  useEffect(() => {
    const m = map.current; if (!m || !ready || !bestId || flown.current === bestId) return;
    const p = pins.find((q) => q.id === bestId); if (!p) return;
    flown.current = bestId;
    // frame you and the winner together, tilted so the camera looks along the way you will walk
    const b = new maplibregl.LngLatBounds([olo, ola], [olo, ola]); b.extend([p.lon, p.lat]);
    m.fitBounds(b, { padding: { top: 150, bottom: 200, left: 80, right: 80 }, maxZoom: 17, pitch: 58, bearing: bearing({ lat: ola, lon: olo }, p), duration: 2600, easing: (t) => 1 - Math.pow(1 - t, 3) });
  }, [bestId, ready, pins, ola, olo]);

  return <div className="mm" style={{ height }}><div ref={el} className="mm-map" style={{ position: "absolute", inset: 0 }} />{!ready && <div className="sk mm-load" aria-busy="true" />}</div>;
}
