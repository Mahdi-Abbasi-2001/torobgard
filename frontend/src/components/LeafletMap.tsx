"use client";
// Street map (Leaflet + OpenStreetMap's standard tiles, no key needed; darkened by CSS in dark mode). Price pins for shops that list the
// product, grouped into one pill when they overlap at the current zoom (tap: zoom in, or list them when they share a
// building); dashed dots for shops that only sell this category; walking-time rings around the user.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { ShopCard } from "@/lib/api";
import { daysAgo, fa, mil, money, walk } from "@/lib/fa";
import { useDarkTheme } from "@/lib/media";

export type LeafletMapProps = {
  origin: { lat: number; lon: number; label?: string }; listed: ShopCard[]; cat: ShopCard[]; selected: string[];
  onPick?: (id: string) => void; hover?: string | null; onHover?: (id: string | null) => void;
  className?: string; height: number | string; desk: boolean;
  /** one-trip hubs (a mall where several shops that list the product sit together), drawn as a glowing pill */
  hubs?: Hub[]; onHub?: (key: string) => void;
  /** a pin's text instead of the listed price (the seller-confirmed price, «…» while asking) and its state (asked / confirmed / held / gone) */
  labels?: Record<string, string>; states?: Record<string, string>;
  /** the walk to take: a dashed line through these points; `alt` draws the fallback route fainter */
  routes?: { pts: [number, number][]; alt?: boolean }[];
};
export type Hub = { key: string; lat: number; lon: number; title: string; sub: string; dim?: boolean; shopIds?: string[] };

// CARTO's basemaps now need an API key; OSM's own tiles don't (usage policy: attribution, no bulk downloading)
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const RINGS = [5, 10, 15, 20]; // minutes on foot: 4.5 km/h with +30% for detours, the same model as the walk times on the cards
const ringM = (min: number) => ((min / 60) * 4500) / 1.3;
const esc = (s: string | null | undefined) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const priceLabel = (s: ShopCard) => (s.offer?.price ? mil(s.offer.price) : "بپرسید");
const ST = ["asked", "confirmed", "held", "gone"];

type Group = { shops: ShopCard[]; lat: number; lon: number; px: L.Point };

export default function LeafletMap({ origin, listed, cat, selected, onPick, hover, onHover, className, height, desk, hubs, onHub, labels, states, routes }: LeafletMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pins = useRef<L.LayerGroup | null>(null);
  const els = useRef(new Map<string, HTMLElement[]>()); // shop id → pin elements (a group pin is listed under every member)
  const fitted = useRef("");
  const [zoom, setZoom] = useState(0);
  const [tick, setTick] = useState(0);
  const dark = useDarkTheme();
  const labelKey = JSON.stringify(labels ?? {}) + JSON.stringify(routes ?? []);
  const stateKey = JSON.stringify(states ?? {});
  const cbs = useRef({ onPick, onHover, onHub });
  useEffect(() => { cbs.current = { onPick, onHover, onHub }; }, [onPick, onHover, onHub]);

  // the map itself, once
  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: false, scrollWheelZoom: desk, attributionControl: true, zoomSnap: 0.5 });
    m.attributionControl.setPrefix(false);
    L.control.zoom({ position: "topright", zoomInTitle: "بزرگ‌نمایی", zoomOutTitle: "کوچک‌نمایی" }).addTo(m);
    pins.current = L.layerGroup().addTo(m);
    fitted.current = ""; // a new map instance (remount, desk/phone switch) has no view yet
    m.on("zoomend", () => setZoom(m.getZoom()));
    map.current = m;
    // the phone map starts hidden (list view): when it gets a size, re-measure and let the fit effect run
    const ro = new ResizeObserver(() => { m.invalidateSize(); setTick((t) => t + 1); });
    ro.observe(el.current!);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, [desk]);

  useEffect(() => {
    const m = map.current; if (!m) return;
    const t = L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR, className: "lm-tiles" }).addTo(m);
    return () => { t.remove(); };
  }, [desk]);

  // frame the user and the nearest shops that list the product (category-only shops only when few list it); refit when
  // the place or the shop set changes, not on every hover/selection
  const nearest = [...listed].sort((a, b) => (a.walk_min ?? 99) - (b.walk_min ?? 99)).slice(0, 12);
  const fitKey = `${origin.lat},${origin.lon}|${nearest.map((s) => s.shop_id).join(",")}|${listed.length < 4 ? cat.length : 0}`;
  useEffect(() => {
    const m = map.current; if (!m || !el.current?.offsetWidth) return;
    if (fitted.current === fitKey) return;
    const pts: L.LatLngExpression[] = [[origin.lat, origin.lon], ...nearest.map((s) => [s.lat, s.lon] as [number, number])];
    if (listed.length < 4) cat.slice(0, 6 - listed.length).forEach((s) => pts.push([s.lat, s.lon]));
    if (pts.length === 1) m.setView(pts[0], 16);
    else m.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [28, desk ? 150 : 64], paddingBottomRight: [28, desk ? 230 : 28], maxZoom: 17, animate: false });
    fitted.current = fitKey;
    setZoom(m.getZoom());
  }, [fitKey, tick]); // eslint-disable-line react-hooks/exhaustive-deps -- the key covers the data it reads

  // pins: rebuilt when the data or the zoom changes; hover and selection only toggle classes (see below)
  useEffect(() => {
    const m = map.current, layer = pins.current; if (!m || !layer || !zoom) return;
    layer.clearLayers(); els.current.clear();
    const z = m.getZoom();
    const track = (id: string, e: HTMLElement) => els.current.set(id, [...(els.current.get(id) ?? []), e]);

    RINGS.forEach((min) => {
      L.circle([origin.lat, origin.lon], { radius: ringM(min), className: "lm-ring", interactive: false }).addTo(layer);
      const top = L.latLng(origin.lat + ringM(min) / 110540, origin.lon);
      L.marker(top, { interactive: false, keyboard: false, icon: L.divIcon({ className: "lm-ring-lbl", html: `<span dir="rtl">${fa(min)} دقیقه پیاده</span>`, iconSize: [0, 0] }) }).addTo(layer);
    });

    cat.forEach((s) => {
      const mk = L.marker([s.lat, s.lon], { keyboard: false, icon: L.divIcon({ className: "lm-cat", html: "<i></i>", iconSize: [14, 14] }) }).addTo(layer);
      mk.bindTooltip(`<div dir="rtl"><b>${esc(s.name)}</b><br><span class="faint">این کالا را ثبت نکرده؛ فقط همین دسته · ${esc(walk(s.walk_min))} پیاده</span></div>`, { direction: "top", offset: [0, -8], className: "lm-tip" });
      mk.on("mouseover", () => cbs.current.onHover?.(s.shop_id)).on("mouseout", () => cbs.current.onHover?.(null));
      const e = mk.getElement(); if (e) track(s.shop_id, e);
    });

    // group listed shops whose pills would overlap at this zoom (cheapest first, so a group shows its lowest price)
    const groups: Group[] = [];
    const inHub = new Set((hubs ?? []).flatMap((h) => h.shopIds ?? []));
    listed.filter((s) => inHub.has(s.shop_id)).forEach((s) => { // shops covered by a hub: a dot, the hub carries the story
      const mk = L.marker([s.lat, s.lon], { icon: L.divIcon({ className: "lm-hubdot", html: "<i></i>", iconSize: [10, 10] }), interactive: false, keyboard: false }).addTo(layer);
      const e = mk.getElement(); if (e) track(s.shop_id, e);
    });
    [...listed].filter((s) => !inHub.has(s.shop_id)).sort((a, b) => (a.offer?.price ?? 9e15) - (b.offer?.price ?? 9e15)).forEach((s) => {
      const px = m.project([s.lat, s.lon], z);
      const g = groups.find((o) => Math.abs(o.px.x - px.x) < 120 && Math.abs(o.px.y - px.y) < 36); // a group pill is ~150 px wide
      if (g) g.shops.push(s); else groups.push({ shops: [s], lat: s.lat, lon: s.lon, px });
    });
    groups.forEach((g) => {
      const one = g.shops.length === 1, s0 = g.shops[0];
      const html = one
        ? `<div class="lm-pin${s0.offer?.flags?.length ? " lm-warn" : ""}" dir="rtl">${s0.offer?.flags?.length ? "⚠ " : ""}${esc(labels?.[s0.shop_id] ?? priceLabel(s0))}</div>`
        : states && g.shops.some((x) => states[x.shop_id] === "confirmed" || states[x.shop_id] === "held")
          ? `<div class="lm-pin lm-grp" dir="rtl"><b>${fa(g.shops.length)}</b> فروشگاه، ${fa(g.shops.filter((x) => states[x.shop_id] === "confirmed" || states[x.shop_id] === "held").length)} تأیید</div>`
          : `<div class="lm-pin lm-grp" dir="rtl"><b>${fa(g.shops.length)}</b> فروشگاه${s0.offer?.price ? ` · از ${esc(mil(s0.offer.price))}` : ""}</div>`;
      const mk = L.marker([g.lat, g.lon], { riseOnHover: true, icon: L.divIcon({ className: "lm-pin-wrap", html, iconSize: [0, 0] }), title: one ? s0.name : `${g.shops.length} فروشگاه` }).addTo(layer);
      if (one) {
        if (desk) mk.bindTooltip(`<div dir="rtl"><b>${esc(s0.name)}</b><br><span class="faint">${esc(s0.mall ?? "بدون پاساژ")} · ${esc(walk(s0.walk_min))} پیاده</span><br>${s0.offer?.price ? `<b>${esc(money(s0.offer.price))}</b> تومان <span class="faint">· ثبت ${esc(daysAgo(s0.offer.age_days))}</span>` : `<span class="faint">قیمت نامشخص؛ بپرسید</span>`}</div>`, { direction: "top", offset: [0, -40], className: "lm-tip" });
        mk.on("click", () => cbs.current.onPick?.(s0.shop_id));
        mk.on("mouseover", () => cbs.current.onHover?.(s0.shop_id)).on("mouseout", () => cbs.current.onHover?.(null));
      } else {
        const b = L.latLngBounds(g.shops.map((s) => [s.lat, s.lon] as [number, number]));
        const sameBuilding = m.distance(b.getSouthWest(), b.getNorthEast()) < 25;
        mk.on("click", () => {
          if (!sameBuilding && m.getZoom() < 18) { m.flyToBounds(b, { padding: [80, 80], maxZoom: 19, duration: 0.5 }); return; }
          mk.bindPopup(groupList(g.shops), { className: "lm-pop", maxWidth: 280, offset: [0, -30] }).openPopup();
        });
      }
      const e = mk.getElement();
      if (e) g.shops.forEach((s) => track(s.shop_id, e));
    });

    (routes ?? []).forEach((r) => L.polyline(r.pts, { className: r.alt ? "lm-route alt" : "lm-route", interactive: false }).addTo(layer));
    (hubs ?? []).forEach((h) => {
      L.circle([h.lat, h.lon], { radius: 120, className: `lm-glow${h.dim ? " dim" : ""}`, interactive: false }).addTo(layer);
      const mk = L.marker([h.lat, h.lon], { zIndexOffset: 800, icon: L.divIcon({ className: "lm-hub-wrap", html: `<div class="lm-hub${h.dim ? " dim" : ""}" dir="rtl"><b>${esc(h.title)}</b><span>${esc(h.sub)}</span></div>`, iconSize: [0, 0] }) }).addTo(layer);
      mk.on("click", () => cbs.current.onHub?.(h.key));
    });

    L.marker([origin.lat, origin.lon], { keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: "lm-me", html: "<i></i>", iconSize: [18, 18] }) })
      .bindTooltip(`<div dir="rtl">شما${origin.label ? ` · ${esc(origin.label)}` : ""}</div>`, { direction: "top", offset: [0, -10], className: "lm-tip" }).addTo(layer);

    function groupList(shops: ShopCard[]) {
      const box = document.createElement("div");
      box.dir = "rtl"; box.className = "lm-list";
      shops.forEach((s) => {
        const b = document.createElement("button");
        b.type = "button"; b.dataset.id = s.shop_id;
        b.innerHTML = `<span><b>${esc(s.name)}</b><br><span class="faint">${esc(walk(s.walk_min))} پیاده${s.offer?.age_days != null ? ` · ثبت ${esc(daysAgo(s.offer.age_days))}` : ""}</span></span><span class="lm-p">${esc(priceLabel(s))}</span>`;
        b.addEventListener("click", () => { cbs.current.onPick?.(s.shop_id); b.classList.toggle("on"); });
        b.addEventListener("mouseenter", () => cbs.current.onHover?.(s.shop_id));
        b.addEventListener("mouseleave", () => cbs.current.onHover?.(null));
        box.appendChild(b);
      });
      return box;
    }
  }, [listed, cat, zoom, origin.lat, origin.lon, origin.label, desk, hubs, labelKey, stateKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the keys cover labels, routes and states

  // hover (from the list or the map) and selection: classes only, so the pin under the mouse is never rebuilt.
  // A grouped pin stands for several shops: it takes the most advanced state among them (held > confirmed > asked > gone).
  useEffect(() => {
    const RANK = ["held", "confirmed", "asked", "gone"];
    const best = new Map<HTMLElement, string>();
    els.current.forEach((list, id) => list.forEach((e) => {
      const st = states?.[id];
      if (st && (!best.has(e) || RANK.indexOf(st) < RANK.indexOf(best.get(e)!))) best.set(e, st);
    }));
    els.current.forEach((list, id) => list.forEach((e) => {
      e.classList.toggle("on", selected.includes(id));
      e.classList.toggle("h", hover === id);
      ST.forEach((k) => e.classList.toggle(`st-${k}`, best.get(e) === k));
      if (hover === id) e.style.zIndex = "2000"; else if (e.classList.contains("lm-pin-wrap")) e.style.zIndex = "";
    }));
    document.querySelectorAll<HTMLButtonElement>(".lm-list button").forEach((b) => b.classList.toggle("on", selected.includes(b.dataset.id!)));
  });

  const cheapest = listed.filter((s) => s.offer?.price).sort((a, b) => a.offer!.price! - b.offer!.price!)[0];
  return (
    <div className={`map lmap${dark ? " lm-dark" : ""}${className ? ` ${className}` : ""}`} style={{ height }}>
      <div ref={el} dir="ltr" className="lm-canvas" role="region" aria-label={`نقشهٔ ${fa(listed.length)} فروشگاه نزدیک شما`} />
      <div className="maplegend">
        <span className="lg"><i />کالا را ثبت کرده · قیمت ثبت‌شده{cheapest?.offer?.price ? ` (از ${mil(cheapest.offer.price)})` : ""}</span>
        {cat.length > 0 && <span className="lg"><i className="c" />فقط در این دسته</span>}
        <span className="lg"><i className="u" />شما · حلقه‌ها: دقیقه پیاده</span>
      </div>
    </div>
  );
}
