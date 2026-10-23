"use client";
// The first page's backdrop: the market around you, alive. Shops that declare they are open right now glow and breathe, shut ones go grey,
// shops whose hours we do not know stay hollow; the light follows the clock and the camera drifts. When the shopper sends their sentence the
// camera tilts in toward them and a sonar spreads: the same motion the autopilot continues. Data: /api/pulse (hours the shops declared).
// The map is the first search result: while the shopper types, shops that list the product light up (those that only declare the category
// show as rings), the rest fade, and the camera flies to the busiest spot. The shopper can pan and zoom it like any map.
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type PulseMatch } from "@/lib/api";
import { addBuildings, applyLight, clockMinute, maplibregl, STYLE, type LL } from "@/lib/maplib";
import { badgeSvg, asGroup, GroupIcon, GROUP_KEYS, GROUPS } from "@/lib/groups";
import "maplibre-gl/dist/maplibre-gl.css";

export type StartMatch = { query: string; category: string | null };
const WALK_KM = (min: number) => (min / 60) * 4.5 / 1.3; // the app's own walking estimate, turned back into a distance
const ring = (lat: number, lon: number, km: number) => Array.from({ length: 73 }, (_, i) => { const a = (i / 72) * 2 * Math.PI; return [lon + (km * Math.sin(a)) / (111 * Math.cos((lat * Math.PI) / 180)), lat + (km * Math.cos(a)) / 111] as [number, number]; });
const AT: { label: string; minute: (now: number) => number | null }[] = [
  { label: "الان", minute: () => null }, { label: "یک ساعت دیگر", minute: (n) => Math.min(1439, n + 60) }, { label: "۱۸:۰۰", minute: () => 18 * 60 }, { label: "۲۰:۰۰", minute: () => 20 * 60 },
];
const HIT = "#6d3df0";
const ICON_Z = 16.2; // from here on each shop wears the icon of what it sells instead of a plain dot // the «found it» colour: not the brand red, not the map's green (open), not the blue «you are here»

export default function StartMap({ origin, going, padBottom, match, onMatch, selected, onPick, onUnavailable }: { origin: LL; going: boolean; padBottom: number; match: StartMatch | null; onMatch?: (r: PulseMatch | null) => void; selected?: string | null; onPick?: (shopId: string) => void; onUnavailable?: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const me = useRef<HTMLElement | null>(null);
  const raf = useRef(0);
  const [ready, setReady] = useState(false);
  const [minute, setMinute] = useState(clockMinute);
  const [at, setAt] = useState(0);            // which «open at…» option is chosen (0 = now)
  const [flat, setFlat] = useState(false);    // 2D view
  const [panel, setPanel] = useState(false);  // legend + time + view options
  const [guide, setGuide] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches); // the icon key: open on a big screen, folded on a phone
  const [icons, setIcons] = useState(false);  // the badge layers exist (they are added once the sprites are drawn)
  const [moved, setMoved] = useState(false);  // the shopper panned away from their own spot
  const { lat: ola, lon: olo } = origin;
  useEffect(() => { const id = setInterval(() => setMinute(clockMinute()), 60_000); return () => clearInterval(id); }, []);
  const data = useQuery({ queryKey: ["pulse", ola.toFixed(4), olo.toFixed(4)], staleTime: 10 * 60_000, queryFn: () => api.pulse({ lat: ola, lon: olo, radius_km: 1.4, limit: 900 }) });
  const shops = useMemo(() => data.data?.shops ?? [], [data.data]);
  const shownMinute = AT[at].minute(minute) ?? minute;
  const states = useMemo(() => shops.map((s) => (s.known ? (s.shifts.some(([a, b]) => shownMinute >= a && shownMinute < b) ? 1 : 0) : 2)), [shops, shownMinute]);
  const hits = useQuery({
    queryKey: ["pulse-match", ola.toFixed(4), olo.toFixed(4), match?.query, match?.category], enabled: !!match, staleTime: 5 * 60_000, placeholderData: keepPreviousData,
    queryFn: () => api.pulseMatch({ lat: ola, lon: olo, q: match!.query || undefined, category: match!.category ?? undefined, radius_km: 1.4 }),
  });
  const hit = match ? hits.data ?? null : null;
  const onPickRef = useRef(onPick);
  useEffect(() => { onPickRef.current = onPick; });
  const touched = useRef(false); // once the shopper moves the map themselves, nothing moves it for them except a new search
  useEffect(() => { onMatch?.(hit); }, [hit]); // eslint-disable-line react-hooks/exhaustive-deps -- reports the result only

  useEffect(() => {
    if (!el.current) return;
    let m: maplibregl.Map;
    try { m = new maplibregl.Map({ container: el.current, style: STYLE, center: [olo, ola], zoom: 14.7, pitch: 50, bearing: -12, interactive: true, dragRotate: false, touchPitch: false, doubleClickZoom: true, attributionControl: false }); }
    catch { Promise.resolve().then(() => onUnavailable?.()); return; }
    map.current = m;
    m.on("error", (e: maplibregl.ErrorEvent) => { if (!m.isStyleLoaded() && String(e.error?.message ?? "").includes("fetch")) onUnavailable?.(); });
    m.on("movestart", (e: { originalEvent?: unknown }) => { if (e.originalEvent) { touched.current = true; setMoved(true); } });
    m.on("load", () => {
      addBuildings(m);
      // calmer 3D: lower, softer buildings so the shops stay the loudest thing on the map
      try { m.setPaintProperty("b3d", "fill-extrusion-height", ["*", 0.55, ["get", "render_height"]]); m.setPaintProperty("b3d", "fill-extrusion-base", ["*", 0.55, ["get", "render_min_height"]]); m.setPaintProperty("b3d", "fill-extrusion-opacity", 0.78); } catch { /* stock buildings are fine */ }
      // 5 / 10 / 15 minutes on foot from the start point
      m.addSource("rings", { type: "geojson", data: { type: "FeatureCollection", features: [5, 10, 15].map((min) => ({ type: "Feature" as const, properties: { t: `${["۵", "۱۰", "۱۵"][[5, 10, 15].indexOf(min)]} دقیقه` }, geometry: { type: "LineString" as const, coordinates: ring(ola, olo, WALK_KM(min)) } })) } });
      m.addLayer({ id: "rings", type: "line", source: "rings", paint: { "line-color": "#6b7488", "line-opacity": 0.4, "line-width": 1.2, "line-dasharray": [2, 3] } });
      m.addLayer({ id: "ring-t", type: "symbol", source: "rings", layout: { "symbol-placement": "line", "text-field": ["get", "t"], "text-font": ["Noto Sans Regular"], "text-size": 11, "symbol-spacing": 600 }, paint: { "text-color": "#6b7488", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } });
      const FONT = ["Noto Sans Regular"], none = ["!", ["has", "point_count"]] as maplibregl.ExpressionSpecification;
      const faNum = (e: maplibregl.ExpressionSpecification) => ["number-format", e, { locale: "fa-IR", "max-fraction-digits": 1 }] as maplibregl.ExpressionSpecification;
      // every shop of the area; nearby dots merge into one numbered bubble until the shopper zooms in (a smear of hundreds of dots helps nobody)
      m.addSource("shops", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 38, clusterMaxZoom: 15.9 });
      m.addLayer({ id: "cl-bg", type: "circle", source: "shops", filter: ["has", "point_count"], paint: { "circle-color": "#5d6a80", "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 23], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2, "circle-opacity": 0.92 } });
      m.addLayer({ id: "cl-n", type: "symbol", source: "shops", filter: ["has", "point_count"], layout: { "text-field": faNum(["get", "point_count"]), "text-font": FONT, "text-size": 12, "text-allow-overlap": true }, paint: { "text-color": "#ffffff" } });
      m.addLayer({ id: "halo", type: "circle", source: "shops", maxzoom: ICON_Z, filter: ["all", none, ["==", ["get", "st"], 1]], paint: { "circle-color": "#17803d", "circle-radius": 12, "circle-opacity": 0.22, "circle-blur": 0.6 } });
      m.addLayer({ id: "dots", type: "circle", source: "shops", maxzoom: ICON_Z, filter: none, paint: {
        "circle-radius": ["match", ["get", "st"], 1, 5.5, 0, 3.6, 3.2], "circle-color": ["match", ["get", "st"], 1, "#17803d", 0, "#b7bcc9", "#ffffff"],
        "circle-stroke-color": ["match", ["get", "st"], 1, "#ffffff", 0, "#ffffff", "#9aa0b0"], "circle-stroke-width": ["match", ["get", "st"], 2, 1.2, 1.5], "circle-opacity": ["match", ["get", "st"], 2, 0.85, 1] } });
      // the shops that carry what was typed: solid = has a listing (its lowest price floats above it), ring = only declares the category
      m.addSource("hits", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 38, clusterMaxZoom: 16 });
      m.addLayer({ id: "hc-bg", type: "circle", source: "hits", filter: ["has", "point_count"], paint: { "circle-color": HIT, "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 50, 24], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
      m.addLayer({ id: "hc-n", type: "symbol", source: "hits", filter: ["has", "point_count"], layout: { "text-field": faNum(["get", "point_count"]), "text-font": FONT, "text-size": 13, "text-allow-overlap": true }, paint: { "text-color": "#ffffff" } });
      m.addLayer({ id: "hit-maybe", type: "circle", source: "hits", filter: ["all", none, ["==", ["get", "k"], 1]], paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": HIT, "circle-stroke-width": 2, "circle-opacity": 0.9 } });
      m.addLayer({ id: "hit-halo", type: "circle", source: "hits", maxzoom: ICON_Z, filter: ["all", none, ["==", ["get", "k"], 2]], paint: { "circle-color": HIT, "circle-radius": 15, "circle-opacity": 0.25, "circle-blur": 0.6 } });
      m.addLayer({ id: "hit-dots", type: "circle", source: "hits", maxzoom: ICON_Z, filter: ["all", none, ["==", ["get", "k"], 2]], paint: { "circle-color": HIT, "circle-radius": 7, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
      const priceLabel = ["concat", faNum(["/", ["get", "price"], 1e6]), " م"] as maplibregl.ExpressionSpecification;
      const label = (id: string, cheap: boolean) => m.addLayer({ id, type: "symbol", source: "hits", minzoom: cheap ? 13 : 15.4,
        filter: ["all", none, ["==", ["get", "k"], 2], ["has", "price"], ["==", ["get", "cheap"], cheap ? 1 : 0]],
        layout: { "text-field": priceLabel, "text-font": FONT, "text-size": cheap ? 12.5 : 11, "text-offset": [0, -1.5], "text-anchor": "bottom", "text-optional": true },
        paint: { "text-color": cheap ? HIT : "#2b2f3b", "text-halo-color": "#ffffff", "text-halo-width": 2 } });
      label("hit-price", false); label("hit-price-cheap", true);
      // close up: a round badge with the kind of goods the shop sells (sprites are drawn from the same SVG glyphs as the chips)
      const sprite = (key: string, svg: string) => new Promise<void>((done) => { const img = new Image(80, 80); img.onload = () => { if (!m.hasImage(key)) m.addImage(key, img, { pixelRatio: 2 }); done(); }; img.onerror = () => done(); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; });
      Promise.all(GROUP_KEYS.flatMap((g) => [sprite(`bd-${g}`, badgeSvg(g)), sprite(`bh-${g}`, badgeSvg(g, true))])).then(() => {
        if (!m.getStyle()) return;
        m.addLayer({ id: "ic-base", type: "symbol", source: "shops", minzoom: ICON_Z, filter: none, layout: { "icon-image": ["concat", "bd-", ["get", "g"]], "icon-size": 1.05, "icon-allow-overlap": true } }, "sel");
        m.addLayer({ id: "ic-hit", type: "symbol", source: "hits", minzoom: ICON_Z, filter: ["all", none, ["==", ["get", "k"], 2]], layout: { "icon-image": ["concat", "bh-", ["get", "g"]], "icon-size": 1.2, "icon-allow-overlap": true } }, "sel");
        for (const id of ["ic-base", "ic-hit"]) {
          m.on("click", id, (e: maplibregl.MapLayerMouseEvent) => { const f = e.features?.[0]; if (f) onPickRef.current?.(String(f.properties?.id)); });
          m.on("mouseenter", id, () => { m.getCanvas().style.cursor = "pointer"; });
          m.on("mouseleave", id, () => { m.getCanvas().style.cursor = ""; });
        }
        setIcons(true);
      });
      for (const id of ["cl-bg", "hc-bg"]) {  // a bubble opens up on tap: zoom in until its shops separate
        m.on("click", id, (e: maplibregl.MapLayerMouseEvent) => {
          const f = e.features?.[0]; if (!f) return;
          const src = m.getSource(id === "cl-bg" ? "shops" : "hits") as maplibregl.GeoJSONSource;
          Promise.resolve(src.getClusterExpansionZoom(Number(f.properties?.cluster_id))).then((z) => { touched.current = true; m.easeTo({ center: (f.geometry as unknown as { coordinates: [number, number] }).coordinates, zoom: Math.min(z + 0.2, 18), duration: 600 }); }).catch(() => {});
        });
        m.on("mouseenter", id, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", id, () => { m.getCanvas().style.cursor = ""; });
      }
      m.addSource("pick", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "sel", type: "circle", source: "pick", paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#1b1d29", "circle-stroke-width": 3 } });
      for (const id of ["dots", "hit-dots", "hit-maybe"]) {
        m.on("click", id, (e: maplibregl.MapLayerMouseEvent) => { const f = e.features?.[0]; if (f) { onPickRef.current?.(String(f.properties?.id)); } });
        m.on("mouseenter", id, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", id, () => { m.getCanvas().style.cursor = ""; });
      }
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
    src.setData({ type: "FeatureCollection", features: shops.map((s, i) => ({ type: "Feature" as const, properties: { st: states[i], id: s.shop_id, g: asGroup(s.g) }, geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] } })) });
  }, [shops, states, ready]);

  // the matching shops light up, everything else steps back; the camera flies to where they are densest
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const src = m.getSource("hits") as maplibregl.GeoJSONSource | undefined; if (!src) return;
    const cheapest = new Set([...(hit?.listed ?? [])].filter((x) => x.price).sort((a, b) => a.price! - b.price!).slice(0, 5).map((x) => x.shop_id));
    const pts = hit ? [...hit.maybe.map((x) => ({ ...x, k: 1, price: null as number | null | undefined })), ...hit.listed.map((x) => ({ ...x, k: 2 }))] : [];
    src.setData({ type: "FeatureCollection", features: pts.map((x) => ({ type: "Feature" as const, properties: { k: x.k, id: x.shop_id, g: asGroup(x.g), cheap: cheapest.has(x.shop_id) ? 1 : 0, ...(x.price ? { price: x.price } : {}) }, geometry: { type: "Point" as const, coordinates: [x.lon, x.lat] } })) });
    const on = pts.length > 0;
    m.setPaintProperty("dots", "circle-opacity", on ? 0.18 : ["match", ["get", "st"], 2, 0.85, 1]);
    m.setPaintProperty("dots", "circle-stroke-opacity", on ? 0.18 : 1);
    m.setPaintProperty("cl-bg", "circle-opacity", on ? 0.2 : 0.92); m.setPaintProperty("cl-bg", "circle-stroke-opacity", on ? 0.2 : 1); m.setPaintProperty("cl-n", "text-opacity", on ? 0.25 : 1);
    if (m.getLayer("halo")) m.setLayoutProperty("halo", "visibility", on ? "none" : "visible");
    if (m.getLayer("ic-base")) m.setPaintProperty("ic-base", "icon-opacity", on ? 0.22 : 1);
  }, [hit, ready, icons]);
  useEffect(() => {
    const m = map.current; if (!m || !ready || going) return;
    if (hit?.hotspot) { touched.current = false; m.easeTo({ center: [hit.hotspot.lon, hit.hotspot.lat], zoom: 15.4, pitch: 50, duration: 1400 }); }
    else if (!match && touched.current === false) m.easeTo({ center: [olo, ola], zoom: 14.7, duration: 1000 });
  }, [hit?.hotspot?.lat, hit?.hotspot?.lon, match, ready]); // eslint-disable-line react-hooks/exhaustive-deps -- flies when the busiest spot changes

  // nothing in reach: show the nearest shop that has it, even if it is far
  useEffect(() => {
    const m = map.current; if (!m || !ready || going || !hit?.nearest || hit.listed.length + hit.maybe.length > 0) return;
    const n = hit.nearest; touched.current = false;
    m.fitBounds([[Math.min(olo, n.lon), Math.min(ola, n.lat)], [Math.max(olo, n.lon), Math.max(ola, n.lat)]], { padding: { top: 120, bottom: padBottom + 40, left: 60, right: 60 }, maxZoom: 15, duration: 1400 });
  }, [hit?.nearest?.shop_id, ready]); // eslint-disable-line react-hooks/exhaustive-deps -- flies once per search
  useEffect(() => { const m = map.current; if (m && ready) m.easeTo({ pitch: flat ? 0 : 50, bearing: flat ? 0 : -12, duration: 700 }); }, [flat, ready]);
  const recenter = () => { const m = map.current; if (!m) return; touched.current = false; setMoved(false); m.easeTo({ center: [olo, ola], zoom: 14.7, duration: 900 }); };

  // the shop whose card is open gets a dark ring and the camera centres on it
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const src = m.getSource("pick") as maplibregl.GeoJSONSource | undefined; if (!src) return;
    const at = selected ? [...shops, ...(hit?.listed ?? []), ...(hit?.maybe ?? [])].find((x) => x.shop_id === selected) : null;
    src.setData({ type: "FeatureCollection", features: at ? [{ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [at.lon, at.lat] } }] : [] });
    if (at) { touched.current = true; m.easeTo({ center: [at.lon, at.lat], zoom: Math.max(m.getZoom(), 16.4), duration: 700 }); }
  }, [selected, ready, padBottom]); // eslint-disable-line react-hooks/exhaustive-deps -- reacts to the choice (and to the card changing the free space), not to data refreshes

  // open shops breathe (stops while the shopper's sentence is being handled); the camera stays put so the shopper can read the map
  useEffect(() => {
    const m = map.current; if (!m || !ready || going) return;
    const t0 = performance.now(); let last = 0;
    const tick = (now: number) => {
      if (now - last > 80) {
        last = now; const k = (Math.sin((now - t0) / 520) + 1) / 2;
        if (m.getLayer("halo")) { m.setPaintProperty("halo", "circle-radius", 9 + 9 * k); m.setPaintProperty("halo", "circle-opacity", 0.32 - 0.22 * k); }
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
    if (going) m.easeTo({ center: [olo, ola], zoom: 16.1, pitch: 62, bearing: -18, duration: 1800, easing: (t) => 1 - Math.pow(1 - t, 3) });
    else if (!hit?.hotspot) m.easeTo({ zoom: 14.7, pitch: 50, duration: 1200 });
  }, [going, ready]); // eslint-disable-line react-hooks/exhaustive-deps -- reacts to the send, not to every result

  return (
    <div ref={box} className="stm">
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {ready && (
        <div className="stm-ctl" style={{ "--pad": `${padBottom}px` } as React.CSSProperties}>
          {panel && (
            <div className="stm-pop" role="dialog" aria-label="راهنما و تنظیمات نقشه">
              <b className="sm">روی نقشه چه می‌بینید؟</b>
              <ul className="stm-key">
                <li><i className="k open" />فروشگاهی که الان باز است</li>
                <li><i className="k shut" />فروشگاه بسته</li>
                <li><i className="k unk" />ساعت کاری‌اش را نمی‌دانیم</li>
                <li><i className="k hit" />کالای جست‌وجوشده را ثبت کرده (قیمت کمترین، بالای آن)</li>
                <li><i className="k decl" />فقط این دسته را دارد؛ باید بپرسید</li>
                <li><i className="k grp">۱۲</i>چند فروشگاه کنار هم؛ بزنید تا باز شود</li>
                <li><i className="k me" />شما</li>
              </ul>
              <div className="xs faint">نزدیک‌تر که شوید، هر فروشگاه با نشان نوع کالایش دیده می‌شود؛ نشان‌ها در گوشهٔ نقشه توضیح داده شده‌اند.</div>
              <b className="sm" style={{ marginTop: 4 }}>باز بودن را برای چه ساعتی ببینم؟</b>
              <div className="wrapr">{AT.map((o, i) => <button key={o.label} type="button" className={`chip ${at === i ? "on" : ""}`} aria-pressed={at === i} onClick={() => setAt(i)}>{o.label}</button>)}</div>
              <div className="wrapr"><button type="button" className={`chip ${!flat ? "on" : ""}`} aria-pressed={!flat} onClick={() => setFlat(false)}>نمای سه‌بعدی</button><button type="button" className={`chip ${flat ? "on" : ""}`} aria-pressed={flat} onClick={() => setFlat(true)}>نمای تخت</button></div>
            </div>
          )}
          {guide && (
            <ul className="stm-guide-list" aria-label="راهنمای نشان‌ها">
              <li className="stm-guide-title">نوع کالای فروشگاه‌ها</li>
              {GROUP_KEYS.map((g) => <li key={g}><i style={{ background: GROUPS[g].color }}><GroupIcon g={g} size={13} /></i>{GROUPS[g].label}</li>)}
              <li className="xs faint stm-guide-note">حلقهٔ بنفش دور نشان: کالای جست‌وجوشده را دارد. «سایر»: نوع کالای فروشگاه مشخص نیست.</li>
            </ul>
          )}
          {moved && <button type="button" className="stm-btn" onClick={recenter}>برگرد به موقعیت من</button>}
          <div className="stm-row">
            <button type="button" className="stm-btn" aria-expanded={guide} onClick={() => setGuide(!guide)}>{guide ? "بستن راهنمای نشان‌ها" : "راهنمای نشان‌ها"}</button>
            <button type="button" className="stm-btn round" onClick={() => setPanel(!panel)} aria-expanded={panel} aria-label="راهنمای نقشه و تنظیمات">{panel ? "×" : "؟"}</button>
          </div>
        </div>
      )}
      {!ready && <div className="stm-load"><span className="stm-load-t"><span className="spin" />در حال بارگذاری نقشه…</span></div>}
    </div>
  );
}
