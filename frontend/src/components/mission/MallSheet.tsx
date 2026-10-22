"use client";
// A mall floor by floor (canvas S3). The shops that have the shopper's product are highlighted so the floor to walk to is obvious.
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fa } from "@/lib/fa";
import { normalize } from "@/lib/text";
import { Icon } from "@/components/Icon";
import { ErrorState, Sheet } from "@/components/ui";

export function MallSheet({ mallKey, hits, onClose, onShop }: { mallKey: string | null; hits: Set<string>; onClose: () => void; onShop?: (id: string) => void }) {
  const q = useQuery({ queryKey: ["mall", mallKey], queryFn: () => api.mall(mallKey!), enabled: !!mallKey, staleTime: 5 * 60_000 });
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const m = q.data;
  const t = normalize(term);
  const floors = useMemo(() => (m?.floors ?? []).map((f) => ({
    ...f, mine: f.shops.filter((s) => hits.has(s.shop_id)),
    shown: f.shops.filter((s) => !t || normalize(s.name).includes(t) || s.categories.some((c) => normalize(c).includes(t)) || (s.unit ?? "").includes(term) || (s.plaque ?? "").includes(term)),
  })).filter((f) => !t || f.shown.length), [m, hits, t, term]);
  const mineTotal = floors.reduce((n, f) => n + f.mine.length, 0);
  const keyOf = (f: { floor: number | null }) => String(f.floor ?? "unk");
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <Sheet open={!!mallKey} onClose={onClose} label="راهنمای پاساژ" className="tall">
      <div className="row between"><span className="mc-label">راهنمای پاساژ</span><button className="iconbtn soft" onClick={onClose} aria-label="بستن"><Icon n="x" /></button></div>
      {q.isLoading && <><div className="sk" style={{ height: 48 }} /><div className="sk" style={{ height: 200 }} /></>}
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {m && (
        <>
          <div><div className="b" style={{ fontSize: 19 }}>{fa(m.mall)}</div>
            <div className="xs faint">{m.area ? `${m.area}، ` : ""}{fa(m.shop_count)} فروشگاه در ترب</div></div>
          {mineTotal > 0 && <div className="mc-verdict" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>برای خرید شما: {fa(mineTotal)} فروشگاه در این پاساژ این کالا را ثبت کرده‌اند؛ با رنگ قرمز مشخص شده‌اند.</div>}
          <div className="field" style={{ minHeight: 44 }}><Icon n="search" s /><label htmlFor="mall-q" className="sr">جستجو در پاساژ</label><input id="mall-q" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="نام فروشگاه یا دسته، مثلاً «هندزفری»" /></div>
          <div className="stack" style={{ gap: 0 }}>
            {floors.map((f) => {
              const k = keyOf(f), unk = f.floor == null, isOpen = !!t || open.has(k) || (mineTotal > 0 && f.mine.length > 0 && !open.has(`x${k}`));
              return (
                <div key={k} style={{ borderBottom: "1px solid var(--line)", ...(unk ? { opacity: .9 } : {}) }}>
                  <button className="frow" style={{ width: "100%", background: "none", border: 0, padding: "0 2px" }} aria-expanded={isOpen} onClick={() => (isOpen && !open.has(k) ? setOpen((o) => new Set(o).add(`x${k}`)) : toggle(k))}>
                    <span className="b sm">{fa(f.label)}</span>
                    <span className="row" style={{ gap: 8 }}>
                      {f.mine.length > 0 && <span className="tb-cnt" style={{ minWidth: 0, padding: "0 8px", height: 22, fontSize: 11.5 }}>{fa(f.mine.length)} با این کالا</span>}
                      <span className="xs muted">{fa(f.shops.length)} فروشگاه</span>
                    </span>
                  </button>
                  {unk && !isOpen && <div className="xs faint" style={{ paddingBottom: 10 }}>در آدرس این فروشگاه‌ها طبقه نیامده؛ از تابلوی پاساژ بپرسید.</div>}
                  {isOpen && (
                    <div className="stack" style={{ gap: 6, paddingBottom: 10 }}>
                      {[...f.shown].sort((a, b) => Number(hits.has(b.shop_id)) - Number(hits.has(a.shop_id))).slice(0, t ? 40 : 12).map((s) => (
                        <button key={s.shop_id} type="button" onClick={() => onShop?.(s.shop_id)} className="row between"
                          style={{ minHeight: 42, padding: "0 12px", borderRadius: 12, border: 0, background: hits.has(s.shop_id) ? "var(--accent-soft)" : "var(--sunk)", color: "var(--ink)", textAlign: "start" }}>
                          <span className="sm b">{s.name}</span>
                          <span className="xs muted">{s.unit ? `واحد ${fa(s.unit)}` : s.plaque ? `پلاک ${fa(s.plaque)}` : "بدون شماره"}{hits.has(s.shop_id) ? "، این کالا را دارد" : ""}</span>
                        </button>
                      ))}
                      {f.shown.length > 12 && !t && <span className="xs faint">و {fa(f.shown.length - 12)} فروشگاه دیگر؛ جستجو کنید.</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}
