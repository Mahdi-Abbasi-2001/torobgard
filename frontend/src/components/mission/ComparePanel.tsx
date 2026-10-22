"use client";
// Step 3 (canvas F4): the shortlist, side by side. A priority chip re-ranks it and rewrites the verdict; each row says what to trust
// (listed price age, open at arrival, how reliable the shop is, red flags from the seller's own text). A table view adds score bars and
// the winner of each row. Tapping a row opens the shop.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Priority, type ShopCard } from "@/lib/api";
import { fa, mil } from "@/lib/fa";
import type { Mission } from "@/lib/mission";
import { Icon } from "@/components/Icon";
import { ScoreBars } from "@/components/discover";
import { FlagChips, LocLine, OpenChip, PriceBadge, ReliabilityLine, confirmedPrice } from "@/components/honesty";
import { Note, Sheet } from "@/components/ui";

const PRIOS: [Priority, string][] = [["balanced", "متعادل"], ["price", "قیمت"], ["near", "نزدیکی"], ["trust", "اطلاعات مطمئن"], ["now", "همین الان"]];
const WIN_LABEL: Record<string, string> = { price: "ارزان‌ترین", distance: "نزدیک‌ترین", freshness: "تازه‌ترین قیمت", closes: "دیرتر می‌بندد", warranty: "بهترین گارانتی", trust: "مطمئن‌ترین اطلاعات" };
const FOR_PRIO: Partial<Record<Priority, string>> = { price: "ارزان‌ترین", near: "نزدیک‌ترین", trust: "مطمئن‌ترین اطلاعات" };

export function ComparePanel({ m, set, listed, onShop, max = 5 }: { m: Mission; set: (p: Partial<Mission>) => void; listed: ShopCard[]; onShop: (id: string) => void; max?: number }) {
  const [table, setTable] = useState(false);
  const [adding, setAdding] = useState(false);
  const pid = m.productId!;
  const cmp = useQuery({
    queryKey: ["fcmp", pid, m.picks.join(","), m.place.lat, m.place.lon, m.priority, m.when], placeholderData: keepPreviousData,
    queryFn: () => api.compareShops(pid, m.picks, m.place, m.priority, m.when), enabled: m.picks.length >= 2,
  });
  const byId = new Map(listed.map((s) => [s.shop_id, s]));
  const rows: ShopCard[] = cmp.data && m.picks.length >= 2 ? cmp.data.shops : m.picks.map((id) => byId.get(id)).filter((s): s is ShopCard => !!s);
  const winners = cmp.data?.winners;
  const wins = (id: string) => (winners ? Object.entries(winners).filter(([, ids]) => ids.includes(id)).map(([k]) => WIN_LABEL[k]).filter(Boolean) : []);
  const verdict = (() => {
    if (!cmp.data || rows.length < 2) return null;
    const forPrio = FOR_PRIO[m.priority];
    const v = forPrio ? cmp.data.verdict.find((x) => x.for === forPrio) : null;
    if (v) return `${v.name}: ${v.why}`;
    const top = rows[0];
    return top ? `${top.name} بهترین ترکیب است${top.why ? `: ${top.why}` : ""}` : null;
  })();
  const remove = (id: string) => set({ picks: m.picks.filter((x) => x !== id) });
  const later = m.when !== "now";

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row between">
        <div className="b" style={{ fontSize: 16 }}>فهرست کوتاه <span className="xs faint">{fa(rows.length)} فروشگاه</span></div>
        <div className="seg" role="radiogroup" aria-label="نمایش" style={{ minWidth: 120 }}>
          <button role="radio" aria-checked={!table} className={!table ? "on" : ""} style={{ minHeight: 32 }} onClick={() => setTable(false)}>فهرست</button>
          <button role="radio" aria-checked={table} className={table ? "on" : ""} style={{ minHeight: 32 }} onClick={() => setTable(true)}>جدول</button>
        </div>
      </div>
      <div className="wrapr" role="radiogroup" aria-label="برایتان مهم‌تر چیست؟">
        {PRIOS.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={m.priority === v} className={`chip ${m.priority === v ? "on" : ""}`} onClick={() => set({ priority: v })}>{l}</button>)}
      </div>
      {verdict && <div className="mc-verdict">{fa(verdict)}</div>}
      {cmp.data?.one_trip && <div className="mc-note">{fa(cmp.data.one_trip.count)} تا از اینها در {fa(cmp.data.one_trip.mall)} هستند: یک سفر.</div>}
      {m.picks.length === 0 && <Note tone="unk" icon="store">فروشگاهی انتخاب نشده؛ از نقشه یا «افزودن فروشگاه» چند تا را بگذارید.</Note>}
      <div className="stack" style={{ gap: 8, opacity: cmp.isFetching && cmp.isPlaceholderData ? 0.6 : 1, transition: "opacity .2s" }}>
        {rows.map((s, i) => (
          <div key={s.shop_id} className="cmp-shop">
            <button type="button" className="cmp-hit" onClick={() => onShop(s.shop_id)} aria-label={`جزئیات ${s.name}`}>
              <span className="row between" style={{ alignItems: "flex-start", gap: 8 }}>
                <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <span className="b" style={{ fontSize: 15 }}><span style={{ color: "var(--accent-ink)", fontWeight: 800 }}>{fa(i + 1)}</span> {s.name}</span>
                  <LocLine s={s} mode={m.mode} />
                </span>
                <PriceBadge offer={s.offer} confirmed={confirmedPrice(s.confirmation)} />
              </span>
              <span className="wrapr">
                {later && <span className="xs faint">وقتی می‌رسید:</span>}<OpenChip open={s.open} />
              </span>
              <ReliabilityLine r={s.reliability} />
              <FlagChips flags={s.offer?.flags} />
              {table && (
                <span className="stack" style={{ gap: 6 }}>
                  {wins(s.shop_id).length > 0 && <span className="wrapr">{wins(s.shop_id).map((w) => <span key={w} className="tb ok"><Icon n="check" s />{w}</span>)}</span>}
                  <ScoreBars s={s} />
                </span>
              )}
            </button>
            {rows.length > 1 && <button type="button" className="cmp-rm" onClick={() => remove(s.shop_id)} aria-label={`حذف ${s.name} از فهرست`}><Icon n="x" s /></button>}
          </div>
        ))}
        {cmp.isLoading && m.picks.length >= 2 && <div className="sk" style={{ height: 110, borderRadius: 16 }} />}
      </div>
      {m.picks.length < max && listed.length > m.picks.length && (
        <button type="button" className="btn sec" style={{ minHeight: 42 }} onClick={() => setAdding(true)}><Icon n="plus" s />افزودن فروشگاه</button>
      )}
      <Sheet open={adding} onClose={() => setAdding(false)} label="افزودن فروشگاه" className="tall">
        <h2>افزودن به فهرست <span className="xs faint">تا {fa(max)} فروشگاه</span></h2>
        <div className="stack" style={{ gap: 8 }}>
          {listed.filter((s) => !m.picks.includes(s.shop_id)).slice(0, 14).map((s) => (
            <button key={s.shop_id} type="button" className="card cmp-pick" onClick={() => { set({ picks: [...m.picks, s.shop_id].slice(0, max) }); if (m.picks.length + 1 >= max) setAdding(false); }}>
              <span className="stack" style={{ gap: 2, minWidth: 0 }}><span className="b sm">{s.name}</span><LocLine s={s} mode={m.mode} /></span>
              <span className="stack" style={{ gap: 2, alignItems: "flex-end" }}>
                <span className="b sm">{s.offer?.price ? mil(s.offer.price) : "نامشخص"}</span><OpenChip open={s.open} />
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
