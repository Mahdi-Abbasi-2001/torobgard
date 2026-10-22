"use client";
// Schematic map: shops projected around the user with real distances, no tile server needed (fast on poor signal).
// A tile map (Neshan / Leaflet) can replace the background later; pins and legend stay the same.
import { useEffect, useRef, useState } from "react";
import type { ShopCard } from "@/lib/api";
import { daysAgo, fa, mil, money, walk } from "@/lib/fa";
import { useIsDesktop } from "@/lib/media";

type MapProps = {
  origin: { lat: number; lon: number }; listed: ShopCard[]; cat: ShopCard[]; selected: string[]; height?: number; onPick?: (id: string) => void;
  hover?: string | null; onHover?: (id: string | null) => void; className?: string;
};

export function ShopMap(props: MapProps) {
  const desk = useIsDesktop();
  return desk ? <DeskMap {...props} /> : <PhoneMap {...props} />;
}

function PhoneMap({ origin, listed, cat, selected, height = 240, onPick, className }: MapProps) {
  const W = 360, H = height;
  const all = [...listed, ...cat];
  const k = Math.cos((origin.lat * Math.PI) / 180) * 111320;
  const pts = all.map((s) => ({ s, x: (s.lon - origin.lon) * k, y: (s.lat - origin.lat) * 110540 }));
  // fit: keep the user and the nearest shops in view
  const xs = [0, ...pts.slice(0, 30).map((p) => p.x)], ys = [0, ...pts.slice(0, 30).map((p) => p.y)];
  const spanX = Math.max(200, Math.max(...xs) - Math.min(...xs)), spanY = Math.max(160, Math.max(...ys) - Math.min(...ys));
  const sc = Math.min((W - 60) / spanX, (H - 60) / spanY);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const P = (x: number, y: number) => [W / 2 + (x - cx) * sc, H / 2 - (y - cy) * sc];
  const [ux, uy] = P(0, 0);
  const cheapest = listed.filter((s) => s.offer?.price).sort((a, b) => a.offer!.price! - b.offer!.price!)[0];
  // group listed shops in the same mall into one badge
  const malls = new Map<string, ShopCard[]>();
  listed.forEach((s) => { const key = s.mall_key ?? s.shop_id; malls.set(key, [...(malls.get(key) ?? []), s]); });
  const big = [...malls.values()].sort((a, b) => b.length - a.length)[0];
  const head = big && big.length > 1 ? pts.find((p) => p.s === big[0]) : undefined;
  const bigXY = head ? P(head.x, head.y) : null;

  return (
    <div className={className ? `map ${className}` : "map"} style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`نقشهٔ ${fa(listed.length)} فروشگاه نزدیک شما`}>
        <rect width={W} height={H} fill="var(--map-bg)" />
        {[[20, 20, 90, 60], [130, 15, 70, 50], [225, 25, 110, 55], [18, 140, 95, 80], [128, 150, 80, 70], [230, 150, 110, 80]].map(([x, y, w, h], i) =>
          <rect key={i} x={x} y={y} width={w} height={h} rx={6} fill="var(--map-block)" />)}
        <path d={`M-10 ${uy + 8} L${W + 10} ${uy - 4}`} stroke="var(--map-major)" strokeWidth={14} />
        <path d={`M${ux - 14} -10 L${ux - 4} ${H + 10}`} stroke="var(--map-road)" strokeWidth={10} />
        <path d={`M-10 70 L${W + 10} 64`} stroke="var(--map-road)" strokeWidth={6} />
        {pts.filter((p) => p.s.tier === "category_only").map(({ s, x, y }) => {
          const [px, py] = P(x, y);
          return <circle key={s.shop_id} cx={px} cy={py} r={6} fill="var(--card)" stroke="var(--ink-3)" strokeWidth={1.5} strokeDasharray="2.5 2" />;
        })}
        {pts.filter((p) => p.s.tier !== "category_only").map(({ s, x, y }) => {
          const [px, py] = P(x, y), on = selected.includes(s.shop_id);
          return (
            <g key={s.shop_id} onClick={() => onPick?.(s.shop_id)} style={{ cursor: onPick ? "pointer" : undefined }}>
              <circle cx={px} cy={py} r={14} fill="transparent" />
              <circle cx={px} cy={py} r={6} fill={on ? "var(--accent)" : "var(--card)"} stroke="var(--accent)" strokeWidth={2} />
            </g>
          );
        })}
        {bigXY && cheapest && (
          <g>
            <rect x={bigXY[0] - 78} y={bigXY[1] - 46} width={156} height={26} rx={13} fill="var(--accent)" />
            <text x={bigXY[0]} y={bigXY[1] - 29} textAnchor="middle" className="pin-lbl" fill="var(--on-accent)">
              {fa(big!.length)} فروشگاه · {big![0].mall ?? ""}
            </text>
          </g>
        )}
        <circle cx={ux} cy={uy} r={14} fill="var(--info)" opacity={0.18} />
        <circle cx={ux} cy={uy} r={6.5} fill="var(--info)" stroke="var(--card)" strokeWidth={2.5} />
      </svg>
      <div className="maplegend">
        <span className="lg"><i />کالا را ثبت کرده{cheapest?.offer?.price ? ` · از ${mil(cheapest.offer.price)}` : ""}</span>
        <span className="lg"><i className="c" />فقط در این دسته</span>
        <span className="lg"><i className="u" />شما</span>
      </div>
    </div>
  );
}

/* ---------- desktop: fills its pane, price pins, hover linked with the list ---------- */
const PIN_W = 66, PIN_H = 26;
function DeskMap({ origin, listed, cat, selected, onPick, hover, onHover, className }: MapProps) {
  const box = useRef<HTMLDivElement>(null);
  const [[W, H], setSize] = useState<[number, number]>([800, 640]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { const r = e.contentRect; if (r.width > 0 && r.height > 0) setSize([Math.round(r.width), Math.round(r.height)]); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const k = Math.cos((origin.lat * Math.PI) / 180) * 111320;
  const pts = [...listed, ...cat].map((s) => ({ s, x: (s.lon - origin.lon) * k, y: (s.lat - origin.lat) * 110540 }));
  // frame the user and every listed shop (the price pins are the point of this map); category-only shops only fill in,
  // nearest first, when few shops list the product
  const byDist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y);
  const lp = pts.filter((p) => p.s.tier !== "category_only").sort(byDist).slice(0, 12);
  const cp = pts.filter((p) => p.s.tier === "category_only").sort(byDist).slice(0, Math.max(0, 6 - lp.length));
  const near = [...lp, ...cp];
  const xs = [0, ...near.map((p) => p.x)], ys = [0, ...near.map((p) => p.y)];
  const spanX = Math.max(240, Math.max(...xs) - Math.min(...xs)), spanY = Math.max(200, Math.max(...ys) - Math.min(...ys));
  // usable band: below the legend (plus room for a price label above its dot) and above the selection tray
  const TRAY = 200, TOP = 170, BOTTOM = H - TRAY - 24, SIDE = 90;
  const sc = Math.min((W - 2 * SIDE) / spanX, Math.max(80, BOTTOM - TOP) / spanY);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const P = (x: number, y: number): [number, number] => [W / 2 + (x - cx) * sc, (TOP + BOTTOM) / 2 - (y - cy) * sc];
  const [ux, uy] = P(0, 0);
  // price pins: place each bubble above its shop, nudging it down/sideways when it would cover an earlier one
  const placed: { s: ShopCard; px: number; py: number; bx: number; by: number }[] = [];
  pts.filter((p) => p.s.tier !== "category_only").forEach(({ s, x, y }) => {
    const [px, py] = P(x, y);
    let bx = px - PIN_W / 2, by = py - PIN_H - 10;
    for (let tries = 0; tries < 12 && placed.some((o) => Math.abs(o.bx - bx) < PIN_W + 4 && Math.abs(o.by - by) < PIN_H + 4); tries++) {
      if (tries % 2) by += PIN_H + 6; else bx += (tries % 4 === 0 ? 1 : -1) * (PIN_W + 6) * Math.ceil((tries + 1) / 4);
    }
    placed.push({ s, px, py, bx, by });
  });
  const hv = placed.find((p) => p.s.shop_id === hover);
  // walking-distance rings around the user (same model as the walk times on the cards: 4.5 km/h, +30% detours)
  const rings = [5, 10, 15, 20, 30].map((min) => ({ min, r: ((min / 60) * 4.5 * 1000 / 1.3) * sc }))
    .filter((g) => g.r > 40 && g.r < Math.hypot(W, H));
  const cheapest = listed.filter((s) => s.offer?.price).sort((a, b) => a.offer!.price! - b.offer!.price!)[0];

  return (
    <div ref={box} className={className ? `map ${className}` : "map"} style={{ height: 240 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`نقشهٔ ${fa(listed.length)} فروشگاه نزدیک شما`}>
        <rect width={W} height={H} fill="var(--map-bg)" />
        <defs><pattern id="mapdots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="var(--map-block)" /></pattern></defs>
        <rect width={W} height={H} fill="url(#mapdots)" />
        {rings.map((g) => (
          <g key={g.min}>
            <circle cx={ux} cy={uy} r={g.r} fill="none" stroke="var(--line-2)" strokeWidth={1.2} strokeDasharray="6 6" />
            {(() => { // label on the ring's upper-right arc, only when it lands inside the pane and above the tray
              const lx = ux + g.r * 0.8, ly = uy - g.r * 0.6;
              return lx > 60 && lx < W - 60 && ly > 130 && ly < H - TRAY
                ? <text x={lx} y={ly} textAnchor="middle" className="pin-lbl" fill="var(--ink-3)" stroke="var(--map-bg)" strokeWidth={5} paintOrder="stroke" style={{ fontWeight: 500 }}>{fa(g.min)} دقیقه پیاده</text>
                : null;
            })()}
          </g>
        ))}
        {pts.filter((p) => p.s.tier === "category_only").map(({ s, x, y }) => {
          const [px, py] = P(x, y);
          return <circle key={s.shop_id} cx={px} cy={py} r={8} fill="var(--card)" stroke="var(--ink-3)" strokeWidth={1.6} strokeDasharray="3 2.5" onMouseEnter={() => onHover?.(s.shop_id)} onMouseLeave={() => onHover?.(null)} />;
        })}
        {placed.map(({ s, px, py, bx, by }) => {
          const on = selected.includes(s.shop_id), h = hover === s.shop_id, fill = on || h;
          const label = s.offer?.price ? mil(s.offer.price).replace(" میلیون", " م").replace(" هزار", " ه") : "بپرسید";
          return (
            <g key={s.shop_id} style={{ cursor: "pointer" }} onClick={() => onPick?.(s.shop_id)} onMouseEnter={() => onHover?.(s.shop_id)} onMouseLeave={() => onHover?.(null)}>
              <line x1={bx + PIN_W / 2} y1={by + PIN_H} x2={px} y2={py} stroke="var(--accent)" strokeWidth={1.2} opacity={0.45} />
              <circle cx={px} cy={py} r={4} fill="var(--accent)" />
              {h && <rect x={bx - 4} y={by - 4} width={PIN_W + 8} height={PIN_H + 8} rx={(PIN_H + 8) / 2} fill="none" stroke="var(--accent)" strokeWidth={2} opacity={0.35} />}
              <rect x={bx} y={by} width={PIN_W} height={PIN_H} rx={PIN_H / 2} fill={fill ? "var(--accent)" : "var(--card)"} stroke="var(--accent)" strokeWidth={h ? 2.4 : 1.4} />
              <text x={bx + PIN_W / 2} y={by + 17} textAnchor="middle" className="pin-lbl" fill={fill ? "var(--on-accent)" : "var(--accent-ink)"}>{label}</text>
            </g>
          );
        })}
        <circle cx={ux} cy={uy} r={20} fill="var(--info)" opacity={0.16} />
        <circle cx={ux} cy={uy} r={8} fill="var(--info)" stroke="var(--card)" strokeWidth={3} />
      </svg>
      {hv && (
        <div className="pin-pop" style={{ left: hv.bx + PIN_W / 2, top: hv.by }}>
          <b>{hv.s.name}</b>
          <div className="xs muted">{hv.s.mall ?? "بدون پاساژ"} · {walk(hv.s.walk_min)} پیاده</div>
          {hv.s.offer?.price
            ? <div className="row between"><span className="b num">{money(hv.s.offer.price)}</span><span className="xs faint">ثبت {daysAgo(hv.s.offer.age_days)}</span></div>
            : <div className="xs" style={{ color: "var(--unk)" }}>قیمت نامشخص — بپرسید</div>}
        </div>
      )}
      <div className="maplegend">
        <span className="lg"><i />کالا را ثبت کرده · قیمت ثبت‌شده{cheapest?.offer?.price ? ` (از ${mil(cheapest.offer.price)})` : ""}</span>
        <span className="lg"><i className="c" />فقط در این دسته</span>
        <span className="lg"><i className="u" />شما</span>
        <span className="xs faint" style={{ marginTop: 2, maxWidth: 230 }}>نقشهٔ طرح‌وار: جای فروشگاه‌ها واقعی است؛ خیابان‌ها رسم نشده‌اند.</span>
      </div>
    </div>
  );
}
