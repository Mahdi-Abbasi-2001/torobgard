// Shared by the 3D maps (MapLibre GL + OpenFreeMap's calm «positron» style, plus extruded OpenStreetMap buildings). Client-only: import it
// from components that are loaded with next/dynamic and ssr:false. Building heights are what OpenStreetMap knows.
import * as maplibregl from "maplibre-gl";

// the bundler cannot find MapLibre's worker script by itself; it is served from /public (copied from node_modules/maplibre-gl/dist)
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

export { maplibregl };
export type LL = { lat: number; lon: number };
export const STYLE = "https://tiles.openfreemap.org/styles/positron";

/** Extruded buildings under the labels, tinted warm so the pins and the route stay the loudest things on the map. */
export function addBuildings(m: maplibregl.Map) {
  if (m.getLayer("b3d")) return;
  m.addLayer({
    id: "b3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13.5,
    paint: { "fill-extrusion-color": ["interpolate", ["linear"], ["get", "render_height"], 0, "#e4e1dc", 40, "#d3d0cc", 120, "#c2c0c4"], "fill-extrusion-height": ["get", "render_height"], "fill-extrusion-base": ["get", "render_min_height"], "fill-extrusion-opacity": 0.9 },
  }, "waterway_line_label");
}

const R = Math.PI / 180;
export const bearing = (a: LL, b: LL) => {
  const y = Math.sin((b.lon - a.lon) * R) * Math.cos(b.lat * R);
  const x = Math.cos(a.lat * R) * Math.sin(b.lat * R) - Math.sin(a.lat * R) * Math.cos(b.lat * R) * Math.cos((b.lon - a.lon) * R);
  return ((Math.atan2(y, x) / R) + 360) % 360;
};
export const meters = (a: LL, b: LL) => {
  const dx = (b.lon - a.lon) * 91000, dy = (b.lat - a.lat) * 111000;
  return Math.hypot(dx, dy);
};
export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const mix = (a: LL, b: LL, t: number): LL => ({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });

/** A shallow arc from a to b (quadratic Bézier, `n` points, [lon, lat] for GeoJSON). */
export function arc(a: LL, b: LL, n = 28, lift = 0.22): [number, number][] {
  const mx = (a.lon + b.lon) / 2, my = (a.lat + b.lat) / 2;
  const dx = b.lon - a.lon, dy = b.lat - a.lat;
  const cx = mx - dy * lift, cy = my + dx * lift;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [u * u * a.lon + 2 * u * t * cx + t * t * b.lon, u * u * a.lat + 2 * u * t * cy + t * t * b.lat] as [number, number];
  });
}

/** Cumulative metres along a [lat, lon] polyline. */
export function cumulative(pts: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + meters({ lat: pts[i - 1][0], lon: pts[i - 1][1] }, { lat: pts[i][0], lon: pts[i][1] }));
  return out;
}

/** The point `s` metres along the polyline, and its heading. */
export function along(pts: [number, number][], cum: number[], s: number): { at: LL; head: number } {
  const total = cum[cum.length - 1] || 1;
  const d = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const a = { lat: pts[i - 1][0], lon: pts[i - 1][1] }, b = { lat: pts[i][0], lon: pts[i][1] };
  const seg = cum[i] - cum[i - 1] || 1;
  return { at: mix(a, b, (d - cum[i - 1]) / seg), head: bearing(a, b) };
}

/** A tilted camera sees less ground than a fit assumes: after the camera settles, step back until every point is inside the picture. */
export function keepInView(m: maplibregl.Map, pts: LL[], pad = 46, top = 110) {
  let tries = 0;
  const ok = () => { const c = m.getContainer(); return pts.every((p) => { const q = m.project([p.lon, p.lat]); return q.x > pad && q.x < c.clientWidth - pad && q.y > top && q.y < c.clientHeight - pad; }); };
  const check = () => { if (!ok() && tries++ < 6) { m.once("moveend", check); m.easeTo({ zoom: m.getZoom() - 0.45, duration: 450 }); } };
  m.once("moveend", check);
}

/** How «night» the map should look at a minute of the day (0 day … 1 night): dusk from 17:30, night from 21:30, dawn 05:30–07:30. */
export function nightOf(minute: number): number {
  const h = minute / 60;
  if (h < 5.5 || h >= 22) return 1;
  if (h < 7.5) return 1 - (h - 5.5) / 2;
  if (h < 17.5) return 0;
  if (h < 21.5) return ((h - 17.5) / 4) * 0.75;
  return 0.75 + ((h - 21.5) / 0.5) * 0.25;
}
/** The map's light follows the clock: only the map picture is dimmed and cooled, the pins and the route stay as bright as ever. */
export function applyLight(container: HTMLElement | null, minute: number) {
  if (!container) return;
  const n = nightOf(minute);
  container.style.setProperty("--nb", String(1 - 0.4 * n));
  container.style.setProperty("--ns", String(1 - 0.25 * n));
  container.style.setProperty("--nh", `${(8 * n).toFixed(1)}deg`);
}
export const clockMinute = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
