"use client";
// «کجا بگردم؟»: when nobody lists the product, show the malls/areas where shops of that kind concentrate (from the dataset's
// shop locations). Data-derived places are labelled as such; the AI's own knowledge is labelled unverified.
import { useQuery } from "@tanstack/react-query";
import { api, type WhereToLook } from "@/lib/api";
import { fa, floorLabel } from "@/lib/fa";
import { walk } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { Icon } from "./Icon";

export type WhereData = WhereToLook & { knowledge_hint?: string | null };

export function WhereToLookCard({ data }: { data: WhereData }) {
  const weak = data.confidence === "low" || data.confidence === "none";
  return (
    <section className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }} aria-label="کجا بگردم">
      <div className="h4"><Icon n="loc" s />کجا بگردم؟</div>
      {data.matched_categories.length > 0 && (
        <div className="xs muted">طبق دستهٔ «{data.matched_categories.map((c) => c.name).slice(0, 2).join("، ")}» در داده‌ی فروشگاه‌ها ({fa(data.dataset_shops)} فروشگاه)</div>
      )}
      {weak && <div className="note unk"><Icon n="q" s /><span>داده‌ی فروشگاه‌ها این دسته را کم پوشش می‌دهد؛ اینها فقط نزدیک‌ترین هم‌دسته‌ها هستند و موجودی مشخص نیست.</span></div>}
      {data.places.map((p) => (
        <div key={p.name + p.area} className="stack" style={{ gap: 6, paddingBlockStart: 8, borderBlockStart: "1px solid var(--line)" }}>
          <div className="row between" style={{ alignItems: "baseline" }}>
            <b>{p.name}</b><span className="xs muted">{fa(p.shop_count)} فروشگاه هم‌دسته</span>
          </div>
          <div className="xs muted">{p.area} · {fa(p.distance_km)} کیلومتر · {walk(p.walk_min)} پیاده{p.common_floors.filter(Boolean).length > 0 && ` · بیشتر در ${p.common_floors.filter(Boolean).map((f) => floorLabel(f) ?? f).join("، ")}`}</div>
          <div className="row" style={{ gap: 8 }}>
            <a className="btn sec grow" style={{ minHeight: 40 }} href={p.links.neshan} target="_blank" rel="noopener">نشان</a>
            <a className="btn sec grow" style={{ minHeight: 40 }} href={p.links.balad} target="_blank" rel="noopener">بلد</a>
            <a className="btn sec grow" style={{ minHeight: 40 }} href={p.links.google} target="_blank" rel="noopener">گوگل</a>
          </div>
        </div>
      ))}
      {data.knowledge_hint && (
        <div className="note info" style={{ alignItems: "flex-start" }}>
          <Icon n="alert" s />
          <span><b>طبق اطلاعات عمومی (تأییدنشده):</b> {data.knowledge_hint}{data.search_link && <> · <a href={data.search_link} target="_blank" rel="noopener" style={{ textDecoration: "underline" }}>جستجو روی نقشه</a></>}</span>
        </div>
      )}
    </section>
  );
}

/** Self-fetching variant for empty states (search with no results, product nobody lists). */
export function WhereToLook({ q, category }: { q: string; category?: string | null }) {
  const { state } = useSession();
  const d = useQuery({ queryKey: ["where", q, category, state.place.lat], queryFn: () => api.whereToLook({ q, category }, state.place), enabled: !!(q || category), staleTime: 5 * 60_000 });
  if (!d.data || d.data.places.length === 0) return null;
  return <div className="pad"><WhereToLookCard data={d.data} /></div>;
}
