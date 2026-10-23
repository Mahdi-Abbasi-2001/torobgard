"use client";
// The card under a tapped dot on the start map: who the shop is, whether it is open, what it sells, and the next step.
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { fa, mil } from "@/lib/fa";
import { Icon } from "@/components/Icon";
import { Bidi } from "@/components/ui";
import type { Place } from "@/lib/geo";

export function ShopPeek({ id, origin, query, category, onClose, onAsk }: { id: string; origin: Place; query: string | null; category: string | null; onClose: () => void; onAsk: () => void }) {
  const q = useQuery({ queryKey: ["peek", id, origin.lat.toFixed(4), origin.lon.toFixed(4), query, category], staleTime: 5 * 60_000, queryFn: () => api.shop(id, origin, { q: query ?? undefined, category: category ?? undefined }) });
  const s = q.data;
  const tone = s?.open.state === "open" ? "ok" : s?.open.state === "closing_soon" ? "warn" : s?.open.state === "closed" ? "bad" : "unk";
  const where = s ? [s.mall, s.floor_label, s.unit && `واحد ${s.unit}`].filter(Boolean).join("، ") || s.area : null;
  const sells = s ? s.categories.slice(0, 3) : [];
  // what the shopper is looking for comes first; with nothing typed, the shop's most recently updated listings
  const looking = !!(query || category);
  const mine = s?.matching ?? [];
  const items = s ? (looking ? mine : s.offers).slice(0, 3) : [];
  return (
    <section className="st-peek" aria-label="فروشگاه انتخاب‌شده" aria-live="polite">
      <button type="button" className="st-x" aria-label="بستن" onClick={onClose}><Icon n="x" s /></button>
      {!s ? (q.isError ? <div className="sm muted">اطلاعات این فروشگاه باز نشد.</div> : <div className="sk" style={{ height: 76, borderRadius: 12 }} />) : (
        <>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <b style={{ fontSize: 16 }}><Bidi text={s.name} /></b>
            <span className={`tb ${tone}`}>{s.open.label}</span>
          </div>
          {where && <div className="xs muted"><Bidi text={fa(where)} />{s.walk_min != null && ` · ${fa(s.walk_min)} دقیقه پیاده`}</div>}
          {sells.length > 0 && <div className="xs muted">می‌فروشد: {sells.join("، ")}</div>}
          {looking && s && mine.length === 0 && <div className="xs muted">«{query || category}» در فهرست این فروشگاه ثبت نشده؛ فقط این دسته را اعلام کرده است.</div>}
          {items.length > 0 && (
            <ul className="st-peek-items">
              {items.map((o) => <li key={o.offer_id}><span className="grow"><Bidi text={((o as { title?: string; seller_title?: string }).title ?? (o as { seller_title?: string }).seller_title ?? "").slice(0, 44)} /></span>{o.price != null && <b>{mil(o.price)}</b>}</li>)}
            </ul>
          )}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn pri grow" onClick={onAsk}>{query || category ? `«${query || category}» را از اینجا می‌خواهم` : "دنبال کالایی از این فروشگاه‌ام"}</button>
            <Link className="btn sec" href={`/shop/${encodeURIComponent(s.shop_id)}`}>جزئیات</Link>
          </div>
        </>
      )}
    </section>
  );
}
