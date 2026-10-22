"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fa } from "@/lib/fa";
import { useIsDesktop } from "@/lib/media";
import { normalize } from "@/lib/text";
import { Icon } from "@/components/Icon";
import { AppBar, Empty, ErrorState, SkeletonCards } from "@/components/ui";

export default function MallView({ mallKey }: { mallKey: string }) {
  const q = useQuery({ queryKey: ["mall", mallKey], queryFn: () => api.mall(mallKey) });
  const [term, setTerm] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<string | null>(null); // desktop: one floor at a time
  const desk = useIsDesktop();
  const m = q.data;
  const topCats = useMemo(() => {
    const c = new Map<string, number>();
    m?.floors.forEach((f) => f.shops.forEach((s) => s.categories.forEach((x) => c.set(x, (c.get(x) ?? 0) + 1))));
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
  }, [m]);
  if (q.isLoading) return <main className="main"><AppBar title="پاساژ" /><SkeletonCards n={4} /></main>;
  if (q.isError || !m) return <main className="main"><AppBar title="پاساژ" /><ErrorState error={q.error} retry={() => q.refetch()} /></main>;

  const t = normalize(term);
  const match = (s: { name: string; categories: string[]; unit: string | null; plaque: string | null }) =>
    (!t || normalize(s.name).includes(t) || s.categories.some((c) => normalize(c).includes(t)) || (s.unit ?? "").includes(term) || (s.plaque ?? "").includes(term)) &&
    (!cat || s.categories.includes(cat));
  const filtering = !!t || !!cat;
  const allFloors = m.floors.map((f) => ({ ...f, hits: f.shops.filter(match) })).filter((f) => !filtering || f.hits.length);
  const fk = (f: { floor: number | null }) => String(f.floor ?? "unk");
  const tabKey = tab ?? (allFloors[0] ? fk(allFloors[0]) : null);
  const floors = desk && !filtering ? allFloors.filter((f) => fk(f) === tabKey) : allFloors;
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <main className="main">
      <AppBar title={fa(m.mall)} sub={`${m.area ?? ""} · ${fa(m.shop_count)} فروشگاه · ${fa(m.floors.filter((f) => f.floor != null).length)} طبقه`} />
      <div className="pad stack" style={{ gap: 10 }}>
        <div className="field search">
          <span className="sbtn" aria-hidden="true"><Icon n="search" s /></span>
          <label htmlFor="mq" className="sr">جستجو در پاساژ</label>
          <input id="mq" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={`جستجو در ${fa(m.shop_count)} فروشگاه…`} />
        </div>
        {!filtering && (
          <div className="dk-only floor-tabs" role="tablist" aria-label="طبقه‌ها">
            {allFloors.map((f) => <button key={fk(f)} role="tab" aria-selected={fk(f) === tabKey} className={`${fk(f) === tabKey ? "on" : ""}${f.floor == null ? " unk" : ""}`} onClick={() => setTab(fk(f))}>{fa(f.label)} · {fa(f.shops.length)}</button>)}
          </div>
        )}
        <div className="wrapr">{topCats.map((c) => <button key={c} className={`chip ${cat === c ? "on" : ""}`} onClick={() => setCat(cat === c ? null : c)}>{c}{cat === c && <Icon n="x" s className="x" />}</button>)}</div>
        {!floors.length && <Empty icon="search" title="فروشگاهی پیدا نشد">نام فروشگاه، دسته یا شمارهٔ واحد را امتحان کنید.</Empty>}
        {floors.map((f) => {
          const k = String(f.floor ?? "unk"), unk = f.floor == null, isOpen = filtering || open.has(k) || (desk && k === tabKey);
          return (
            <div key={k} className="card mall-floor" style={{ overflow: "hidden", ...(unk ? { border: "1.5px dashed var(--unk)", background: "transparent", boxShadow: "none" } : {}) }}>
              <button className="frow" style={{ padding: "0 14px", width: "100%", background: "none", border: 0 }} aria-expanded={isOpen} onClick={() => toggle(k)}>
                <span className="b sm" style={unk ? { color: "var(--ink-2)" } : undefined}>{fa(f.label)}</span>
                <span className="row xs muted" style={{ gap: 6 }}>{fa(filtering ? f.hits.length : f.shops.length)} فروشگاه<Icon n={isOpen ? "minus" : "plus"} s /></span>
              </button>
              {unk && !isOpen && <div className="xs faint" style={{ padding: "0 14px 12px" }}>در آدرس این فروشگاه‌ها طبقه نیامده؛ از تابلوی راهنمای پاساژ بپرسید.</div>}
              {isOpen && (filtering ? f.hits : f.shops).map((s) => (
                <Link key={s.shop_id} href={`/shop/${s.shop_id}`} style={{ padding: "10px 14px", borderTop: "1px solid var(--line)", display: "flex", gap: 10, alignItems: "flex-start", background: cat && s.categories.includes(cat) ? "var(--accent-soft)" : undefined }}>
                  <span className="tag num" style={{ background: "var(--sunk)", color: "var(--ink-2)", minWidth: 48, justifyContent: "center" }}>{s.unit ? fa(s.unit) : s.plaque ? `پ ${fa(s.plaque)}` : "—"}</span>
                  <div className="grow"><div className="sm b">{s.name}</div><div className="xs muted">{s.categories.length ? s.categories.slice(0, 2).join("، ") : <span style={{ color: "var(--unk)" }}>دسته ثبت نشده</span>}</div></div>
                  <span className={`xs ${s.offer_count ? "" : "faint"}`}>{s.offer_count ? `${fa(s.offer_count)} کالا` : "بدون کالا"}</span>
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    </main>
  );
}
