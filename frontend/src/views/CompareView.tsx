"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fa, mil } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { compareHref, MAX_COMPARE, useCompare } from "@/components/Compare";
import { Icon } from "@/components/Icon";
import { AppBar, Bidi, Empty, ErrorState, Note, SkeletonCards, Steps, Thumb, Toggle } from "@/components/ui";

export default function CompareView({ ids }: { ids: string[] }) {
  const router = useRouter();
  const { state, ready, update } = useSession();
  const { openCompare } = useCompare();
  const [onlyDiff, setOnlyDiff] = useState(true);
  const key = ids.join(",");
  // the URL is what is shown; keep the compare list (bar, picker) in step with it
  useEffect(() => {
    if (ready && ids.length) update((s) => (s.compare.join(",") === key ? s : { ...s, compare: ids.slice(0, MAX_COMPARE) }));
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = (x: string) => {
    update((s) => ({ ...s, compare: s.compare.filter((i) => i !== x) }));
    router.replace(compareHref(ids.filter((i) => i !== x)));
  };
  const q = useQuery({ queryKey: ["compare", ids], queryFn: () => api.compare(ids), enabled: ids.length >= 2 });

  if (ids.length < 2) return (
    <main className="main"><AppBar title="مقایسهٔ کالاها" />
      <Empty icon="compare" title="حداقل ۲ کالا انتخاب کنید" action={<button type="button" className="btn pri" onClick={() => openCompare(ids[0])}><Icon n="plus" s />افزودن کالا</button>}>
        {ids.length ? "یک کالای دیگر اضافه کنید تا کنار هم ببینید؛ تا ۴ کالا." : "از صفحهٔ کالا «مقایسه با کالای دیگر» را بزنید، یا همین‌جا کالا اضافه کنید؛ تا ۴ کالا."}</Empty></main>
  );
  if (q.isLoading) return <main className="main"><AppBar title="مقایسهٔ کالاها" /><SkeletonCards n={2} /></main>;
  if (q.isError || !q.data) return <main className="main"><AppBar title="مقایسهٔ کالاها" /><ErrorState error={q.error} retry={() => q.refetch()} /></main>;

  const { products, rows } = q.data;
  // rows where every product has a value first: those are the meaningful differences
  const sorted = [...rows].sort((a, b) => Number(b.differs) - Number(a.differs) || Number(b.values.every((v) => v != null)) - Number(a.values.every((v) => v != null)));
  const shown = onlyDiff ? sorted.filter((r) => r.differs) : sorted;
  const nDiff = rows.filter((r) => r.differs).length;
  // pick: most shops near, then cheapest
  const best = [...products].sort((a, b) => b.shop_count - a.shop_count || (a.price_min ?? 9e12) - (b.price_min ?? 9e12))[0];
  const cols = `30% repeat(${products.length}, 1fr)`;

  return (
    <main className="main has-cta compare-main">
      <div className="lay lay-head">
      <AppBar title="مقایسهٔ کالاها" sub={`${fa(products.length)} مدل`} />
      <Steps at={0} />
      </div>
      <div className="pad stack" style={{ gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "end" }}>
          <span />
          {products.map((p) => (
            <div key={p.product_id} className="cmp-col">
              <button type="button" className="cmp-x" onClick={() => remove(p.product_id)} aria-label={`حذف ${p.title} از مقایسه`}><Icon n="x" s /></button>
              <Link href={`/p/${p.product_id}`} className="stack" style={{ gap: 6 }}>
                <Thumb src={p.image} alt={p.title} size="100%" h={110} brand={p.brand} />
                <div className="xs b" style={{ lineHeight: 1.5 }}><Bidi text={p.title} /></div>
                <div className="sm b num">{p.price_min != null ? `از ${mil(p.price_min)}` : "قیمت نامشخص"}</div>
                <div className="xs faint">{fa(p.shop_count)} فروشگاه</div>
              </Link>
            </div>
          ))}
        </div>
        {products.length < MAX_COMPARE && (
          <button type="button" className="btn sec block" onClick={() => openCompare(ids[0])}><Icon n="plus" s />افزودن کالای دیگر <span className="faint">({fa(products.length)} از {fa(MAX_COMPARE)})</span></button>
        )}
        <Note tone="info" icon="spark">
          <b>برای شما کدام بهتر است؟ </b><Bidi text={best.title} /> بیشترین فروشنده را دارد ({fa(best.shop_count)} فروشگاه){best.price_min ? ` و از ${mil(best.price_min)} تومان شروع می‌شود` : ""}. برای جزئیات، ردیف‌های رنگی را ببینید.
        </Note>
        <div className="frow"><span className="b sm">فقط تفاوت‌ها <span className="faint">({fa(nDiff)} از {fa(rows.length)})</span></span><Toggle on={onlyDiff} onChange={setOnlyDiff} label="فقط تفاوت‌ها" /></div>
        {rows.length === 0 ? <Note tone="unk" icon="q">مشخصات فنی این کالاها ثبت نشده است.</Note> : (
          <div className="tablewrap">
            <table className="ctab" style={{ minWidth: 120 + products.length * 110 }}>
              <tbody>{shown.map((r) => (
                <tr key={r.key} className={r.differs ? "d" : ""}><th>{r.key}</th>{r.values.map((v, i) => <td key={i}>{v == null ? <span className="cell-unk">نامشخص</span> : fa(v)}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <span className="xs faint">داده‌های مشخصات از ترب؛ نام ویژگی‌ها برای همهٔ کالاها یکسان ثبت نشده.</span>
      </div>
      <div className="sticky-cta">
        <Link className="btn pri block" href={`/p/${best.product_id}/shops`}>فروشگاه‌های {state.place.label} برای انتخاب اول <Icon n="fwd" s /></Link>
      </div>
    </main>
  );
}
