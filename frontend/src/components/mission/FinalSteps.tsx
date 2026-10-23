"use client";
// The last 100 metres: a map app gets you to the mall, this gets you to the shop. The data has the mall, the floor and the unit or plaque
// from the address text, and nothing indoors, so the help is: the floor drawn, the shops either side of it (a name you can ask a guard
// about), and one card to show to a guard or shopkeeper or send to a friend. It does not pretend to be an indoor map.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type PlanStop, type ShopCard } from "@/lib/api";
import { fa, floorLabel } from "@/lib/fa";
import { Icon } from "@/components/Icon";
import { MallLocator } from "@/components/cards";
import { Bidi } from "@/components/ui";

const num = (s: string | null | undefined) => { const n = parseInt(String(s ?? "").replace(/\D/g, ""), 10); return Number.isFinite(n) ? n : null; };

export function FinalSteps({ stop, card, onFloors }: { stop: PlanStop; card?: ShopCard; onFloors?: () => void }) {
  const [copied, setCopied] = useState(false);
  const mall = useQuery({ queryKey: ["mall", card?.mall_key], queryFn: () => api.mall(card!.mall_key!), enabled: !!card?.mall_key, staleTime: 5 * 60_000 });
  const mine = num(stop.unit) ?? num(stop.plaque);
  const floorShops = mall.data?.floors.find((f) => f.floor === (card?.floor ?? null))?.shops ?? [];
  const neighbours = mine == null || card?.floor == null ? [] : floorShops
    .map((s) => ({ s, n: num(s.unit) ?? num(s.plaque) }))
    .filter((x) => x.n != null && x.s.shop_id !== stop.shop_id)
    .sort((a, b) => Math.abs(a.n! - mine) - Math.abs(b.n! - mine)).slice(0, 3);
  const where = [stop.mall, floorLabel(stop.floor_label), stop.unit ? `واحد ${fa(stop.unit)}` : stop.plaque ? `پلاک ${fa(stop.plaque)}` : null].filter(Boolean).join("، ");
  const message = [`فروشگاه ${stop.name}`, where, card?.address ? fa(card.address) : stop.area, `https://nshn.ir/?lat=${stop.lat}&lng=${stop.lon}`, stop.hold ? `کد نگه‌داری: ${fa(stop.hold.code)}` : null].filter(Boolean).join("\n");
  const share = async () => {
    try {
      if (navigator.share) { await navigator.share({ text: message }); return; }
      await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2500);
    } catch {}
  };

  return (
    <div className="mc-card final" style={{ padding: 14, gap: 12 }}>
      <div className="b sm">آخرین ۱۰۰ متر: از در پاساژ تا فروشگاه</div>
      {card && <MallLocator s={card} />}
      {neighbours.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="xs muted">در همان طبقه، نزدیک این فروشگاه (اگر گم شدید اسم یکی‌شان را بپرسید):</span>
          {neighbours.map(({ s, n }) => (
            <div key={s.shop_id} className="row between" style={{ minHeight: 38, padding: "0 12px", borderRadius: 10, background: "var(--sunk)" }}>
              <span className="sm b"><Bidi text={s.name} /></span>
              <span className="xs muted">{s.unit ? `واحد ${fa(s.unit)}` : `پلاک ${fa(n)}`}، {Math.abs(n! - mine!) <= 2 ? "همین نزدیکی" : "چند واحد آن‌طرف‌تر"}</span>
            </div>
          ))}
        </div>
      )}
      <div className="show-guard" aria-label="برای نشان دادن به نگهبان یا فروشنده">
        <span className="xs">اگر گم شدید، این نشانی را به نگهبان یا فروشنده‌ای که سر راه می‌بینید نشان دهید:</span>
        <b>{stop.name}</b>
        <span>{where}</span>
      </div>
      <div className="fs-actions">
        {onFloors && <button type="button" className="btn sec" onClick={onFloors}><Icon n="layers" s />کدام طبقه، کدام واحد؟</button>}
        <button type="button" className="btn sec" onClick={share}><Icon n={copied ? "check" : "send"} s />{copied ? "کپی شد" : "فرستادن آدرس برای دوست"}</button>
      </div>
      <span className="xs faint">نقشهٔ داخلی پاساژ را نداریم؛ طبقه، شمارهٔ واحد و فروشگاه‌های همسایه نزدیک‌ترین راهنما هستند.</span>
    </div>
  );
}
