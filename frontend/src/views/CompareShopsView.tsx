"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type ShopCard, type ShopFilters } from "@/lib/api";
import { fa, floorLabel, mil, walk } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { useInquiries } from "@/lib/useInquiries";
import { Icon } from "@/components/Icon";
import { OpenChip, PriceBadge } from "@/components/honesty";
import { AppBar, Bidi, ErrorState, Note, Seg, SkeletonCards, Steps } from "@/components/ui";

type Sort = NonNullable<ShopFilters["sort"]>;
const OPEN_RANK = { open: 0, closing_soon: 1, unknown: 2, closed: 3 };

export default function CompareShopsView({ id, ids }: { id: string; ids: string[] }) {
  const { state, sid } = useSession();
  const [sort, setSort] = useState<Sort>("best");
  const p = useQuery({ queryKey: ["product", id], queryFn: () => api.product(id) });
  const q = useQuery({ queryKey: ["pshops-all", id, state.place.lat], queryFn: () => api.productShops(id, state.place, { sort: "best" }, 100) });
  const inq = useInquiries(sid, { live: false });
  const confirmedBy = useMemo(() => {
    const m = new Map<string, { price: number; ago: string }>();
    inq.items.filter((i) => i.status === "answered" && i.product?.product_id === id && i.answer?.price && i.shop)
      .forEach((i) => { if (!m.has(i.shop!.shop_id)) m.set(i.shop!.shop_id, { price: i.answer!.price!, ago: "تأییدشده" }); });
    return m;
  }, [inq.items, id]);

  if (q.isLoading) return <main className="main"><AppBar title="مقایسهٔ فروشگاه‌ها" /><SkeletonCards n={2} /></main>;
  if (q.isError || !q.data) return <main className="main"><AppBar title="مقایسهٔ فروشگاه‌ها" /><ErrorState error={q.error} retry={() => q.refetch()} /></main>;

  const all = [...q.data.listed, ...q.data.category_only];
  const price = (s: ShopCard) => confirmedBy.get(s.shop_id)?.price ?? s.offer?.price ?? Infinity;
  const base = ids.map((x) => all.find((s) => s.shop_id === x)).filter(Boolean) as ShopCard[];
  const cols = [...base].sort((a, b) => {
    if (sort === "price") return price(a) - price(b);
    if (sort === "distance") return (a.distance_km ?? 99) - (b.distance_km ?? 99);
    if (sort === "freshness") return (a.offer?.age_days ?? 9999) - (b.offer?.age_days ?? 9999);
    // best: confirmed first, then open/closing, then the backend's ranking
    return Number(confirmedBy.has(b.shop_id)) - Number(confirmedBy.has(a.shop_id)) || OPEN_RANK[a.open.state] - OPEN_RANK[b.open.state] || all.indexOf(a) - all.indexOf(b); // backend score order
  });
  const top = cols[0], second = cols[1];
  const tie = top && second && top.walk_min === second.walk_min;
  const reason = top && [
    confirmedBy.has(top.shop_id) ? "قیمتش توسط فروشنده تأیید شده" : top.offer?.price ? `قیمت ثبت‌شده ${mil(top.offer.price)} (${fa(top.offer.age_days ?? 0)} روز پیش)` : "",
    top.open.state === "open" ? "الان باز است" : top.open.state === "closing_soon" ? "به‌زودی می‌بندد" : "",
    top.walk_min != null ? `${walk(top.walk_min)} پیاده` : "",
  ].filter(Boolean).join("، ");

  const rows: [string, (s: ShopCard) => React.ReactNode][] = [
    ["قیمت", (s) => s.tier === "category_only" ? <span className="cell-unk">بپرسید</span> : <PriceBadge offer={s.offer} confirmed={confirmedBy.get(s.shop_id)} />],
    ["فاصله", (s) => `${walk(s.walk_min)} پیاده`],
    ["وضعیت", (s) => <OpenChip open={s.open} />],
    ["محل", (s) => <>{s.mall ?? "بدون پاساژ"}<br />{floorLabel(s.floor_label) ?? <span className="cell-unk">طبقه نامشخص</span>}</>],
    ["قسطی", (s) => s.installment ? s.payments.map((x) => x.provider).join("، ") : "ندارد"],
    ["گارانتی", (s) => s.offer?.warranty ? s.offer.warranty : <span className="cell-unk">نامشخص</span>],
    ["ارسال سریع", (s) => s.fast_delivery === true ? "دارد" : s.fast_delivery === false ? "ندارد" : <span className="cell-unk">نامشخص</span>],
  ];

  return (
    <main className="main has-cta">
      <AppBar title="مقایسهٔ فروشگاه‌ها" sub={p.data ? <Bidi text={p.data.title} /> : undefined} />
      <Steps at={2} />
      <div className="pad stack" style={{ gap: 12 }}>
        <Seg label="مرتب‌سازی" value={sort} onChange={setSort} options={[["best", "بهترین"], ["price", "قیمت"], ["distance", "فاصله"], ["freshness", "تازگی قیمت"]]} />
        <div className="tablewrap">
          <table className="ctab" style={{ minWidth: 110 + cols.length * 120 }}>
            <thead><tr><th />{cols.map((s, i) => (
              <td key={s.shop_id}><span className="tag" style={{ background: i === 0 ? "var(--accent)" : "var(--sunk)", color: i === 0 ? "var(--on-accent)" : "var(--ink-2)" }}>{fa(i + 1)}</span>
                <Link href={`/shop/${s.shop_id}?product=${id}`} className="b sm" style={{ display: "block", marginTop: 4 }}>{s.name}</Link></td>
            ))}</tr></thead>
            <tbody>{rows.map(([k, f]) => <tr key={k}><th>{k}</th>{cols.map((s) => <td key={s.shop_id}>{f(s)}</td>)}</tr>)}</tbody>
          </table>
        </div>
        {top && <Note tone="info" icon="spark"><b>چرا {top.name} {sort === "best" ? "اول است" : "اول آمده"}؟ </b>{reason}.</Note>}
        {tie && <Note tone="unk" icon="sort">{top.name} و {second.name} هر دو {walk(top.walk_min)} فاصله دارند؛ رتبه با قیمت و وضعیت باز بودن مشخص شد.</Note>}
      </div>
      <div className="sticky-cta">
        <Link className="btn pri block" href={`/p/${id}/ask`}><Icon n="send" s />استعلام از این {fa(cols.length)} فروشگاه</Link>
      </div>
    </main>
  );
}
