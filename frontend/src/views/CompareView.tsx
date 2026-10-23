"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
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
  const q = useQuery({ queryKey: ["compare", ids, state.place.lat, state.place.lon], queryFn: () => api.compare(ids, state.place), enabled: ids.length >= 2 });
  const [need, setNeed] = useState("");
  const verdict = useMutation({ mutationFn: (n: string | null) => api.compareVerdict(ids, n, state.place) });
  // a first verdict without a stated need, as soon as the table is there
  useEffect(() => { if (q.data && ids.length >= 2 && verdict.isIdle) verdict.mutate(null); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const ins = q.data.insights;
  const av = q.data.availability ?? {};
  // pick: the verdict's choice, else most shops, then cheapest
  const best = products.find((p) => p.product_id === verdict.data?.pick)
    ?? [...products].sort((a, b) => b.shop_count - a.shop_count || (a.price_min ?? 9e12) - (b.price_min ?? 9e12))[0];
  const title = (pid: string) => products.find((p) => p.product_id === pid)?.title ?? "";
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
                <div className="xs faint">{fa(p.shop_count)} فروشگاه{av[p.product_id]?.near ? `، ${fa(av[p.product_id].near)} نزدیک شما` : ""}</div>
                {ins && <div className="xs" style={{ color: "var(--ok)", lineHeight: 1.6 }}>{fa(ins.per_product.find((x) => x.product_id === p.product_id)?.text ?? "")}</div>}
              </Link>
            </div>
          ))}
        </div>
        {products.length < MAX_COMPARE && (
          <button type="button" className="btn sec block" onClick={() => openCompare(ids[0])}><Icon n="plus" s />افزودن کالای دیگر <span className="faint">({fa(products.length)} از {fa(MAX_COMPARE)})</span></button>
        )}
        <section className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }} aria-live="polite">
          <div className="row" style={{ gap: 8 }}><Icon n="spark" s /><b className="sm grow">کدام برای شما بهتر است؟</b>
            {verdict.data && <span className="xs faint">{verdict.data.source === "llm" ? "تحلیل هوشمند از همین مشخصات" : "از روی مشخصات و قیمت‌ها"}</span>}</div>
          <form className="field" onSubmit={(e) => { e.preventDefault(); verdict.mutate(need.trim() || null); }}>
            <input value={need} onChange={(e) => setNeed(e.target.value)} placeholder="نیازتان را بنویسید، مثلاً «عکاسی و بازی» یا «باتری قوی برای سفر»" maxLength={200} aria-label="نیاز شما" />
            <button className="iconbtn" aria-label="پرسیدن" disabled={verdict.isPending}>{verdict.isPending ? <span className="spin" /> : <Icon n="send" s />}</button>
          </form>
          {verdict.isPending && !verdict.data && <div className="xs muted row" style={{ gap: 6 }}><span className="spin" />در حال سنجیدن…</div>}
          {verdict.data && (
            <>
              <div className="sm b">{verdict.data.headline}</div>
              <ul style={{ margin: 0, paddingInlineStart: 18 }} className="sm">{verdict.data.reasons.map((r) => <li key={r}>{fa(r)}</li>)}</ul>
              {verdict.data.tradeoff && <div className="xs muted"><b>در عوض: </b>{fa(verdict.data.tradeoff)}</div>}
              {verdict.data.per_need.length > 0 && (
                <div className="wrapr">{verdict.data.per_need.map((x) => <span key={x.need} className="tb info">{x.need}: <Bidi text={title(x.product_id).split("|")[0].slice(0, 30)} /></span>)}</div>
              )}
            </>
          )}
          {verdict.isError && <Note tone="bad" icon="alert">{(verdict.error as Error).message}</Note>}
        </section>
        <div className="frow"><span className="b sm">فقط تفاوت‌ها <span className="faint">({fa(nDiff)} از {fa(rows.length)})</span></span><Toggle on={onlyDiff} onChange={setOnlyDiff} label="فقط تفاوت‌ها" /></div>
        {rows.length === 0 ? <Note tone="unk" icon="q">مشخصات فنی این کالاها ثبت نشده است.</Note> : (
          <div className="tablewrap">
            <table className="ctab" style={{ minWidth: 120 + products.length * 110 }}>
              <tbody>{shown.map((r) => (
                <tr key={r.key} className={r.differs ? "d" : ""}><th>{r.key}</th>{r.values.map((v, i) => <td key={i} className={r.best?.includes(i) ? "win" : undefined}>{v == null ? <span className="cell-unk">نامشخص</span> : <>{r.best?.includes(i) && <Icon n="check" s />}{fa(v)}</>}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <span className="xs faint">مشخصات از ترب گرفته شده؛ نام ویژگی‌ها برای همهٔ کالاها یکسان ثبت نشده. خانهٔ سبز: مقدار بهتر (فقط وقتی واحدها یکی است).</span>
      </div>
      <div className="sticky-cta">
        <Link className="btn pri block" href={`/p/${best.product_id}/shops`}>فروشگاه‌های نزدیک برای {verdict.data ? "انتخاب پیشنهادی" : "انتخاب اول"} <Icon n="fwd" s /></Link>
      </div>
    </main>
  );
}
