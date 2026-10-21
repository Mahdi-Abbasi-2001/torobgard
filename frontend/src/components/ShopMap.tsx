"use client";
// Schematic map: shops projected around the user with real distances, no tile server needed (fast on poor signal).
// A tile map (Neshan / Leaflet) can replace the background later; pins and legend stay the same.
import type { ShopCard } from "@/lib/api";
import { fa, mil } from "@/lib/fa";

export function ShopMap({ origin, listed, cat, selected, height = 240, onPick }: {
  origin: { lat: number; lon: number }; listed: ShopCard[]; cat: ShopCard[]; selected: string[]; height?: number; onPick?: (id: string) => void;
}) {
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
    <div className="map" style={{ height }}>
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
