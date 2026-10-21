"use client";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Inquiry } from "@/lib/api";
import { fa, mil, money } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { useInquiries, useNow } from "@/lib/useInquiries";
import { Icon } from "@/components/Icon";
import { ShopCard } from "@/components/cards";
import { InquiryCard, Summary, diffPct, isFailed } from "@/components/inquiry";
import { AppBar, BottomNav, Bidi, Empty, ErrorState, Note, Sheet, SkeletonCards, Steps, Thumb } from "@/components/ui";

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== "0";

export default function TrackView({ product }: { product?: string }) {
  const { sid, state } = useSession();
  const qc = useQueryClient();
  const now = useNow();
  const [altId, setAltId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const listedRef = useRef(new Map<string, { price: number | null; age_days: number | null }>());
  const pidRef = useRef<string | undefined>(product);

  // Live changes: highlight the card, explain a price difference, open alternatives when a shop fails
  const inq = useInquiries(sid, {
    onChange: (n) => {
      if (n.product?.product_id !== pidRef.current) return;
      setFlash(n.id); setTimeout(() => setFlash((f) => (f === n.id ? null : f)), 1500);
      if (n.status === "answered" && n.shop && n.answer?.price) {
        const pct = diffPct(n, listedRef.current.get(n.shop.shop_id)?.price);
        if (pct) { setToast(`قیمت واقعی ${fa(Math.abs(pct))}٪ ${pct > 0 ? "بیشتر" : "کمتر"} از قیمت ثبت‌شده است. ${n.shop.name}: ${money(n.answer.price)} تومان`); setTimeout(() => setToast(null), 6000); }
      }
      if (isFailed(n)) setTimeout(() => setAltId(n.id), 900);
    },
  });

  const pid = product ?? inq.items[0]?.product?.product_id;
  // newest inquiry per shop (asking a shop again replaces its old card)
  const items = useMemo(() => {
    const seen = new Set<string>();
    return inq.items.filter((i) => i.product?.product_id === pid && i.shop && !seen.has(i.shop.shop_id) && seen.add(i.shop.shop_id));
  }, [inq.items, pid]);
  const shops = useQuery({ queryKey: ["pshops-all", pid, state.place.lat], queryFn: () => api.productShops(pid!, state.place, { sort: "best" }, 100), enabled: !!pid });
  const listed = useMemo(() => {
    const m = new Map<string, { price: number | null; age_days: number | null }>();
    shops.data?.listed.forEach((s) => m.set(s.shop_id, { price: s.offer?.price ?? null, age_days: s.offer?.age_days ?? null }));
    return m;
  }, [shops.data]);
  useEffect(() => { listedRef.current = listed; pidRef.current = pid; });
  const alt = altId ? inq.items.find((x) => x.id === altId) ?? null : null;

  const askMore = useMutation({
    mutationFn: (ids: string[]) => api.createInquiries({ session_id: sid, shop_ids: ids, product_id: pid!, questions: items[0]?.questions.map((q) => q.key) ?? ["stock", "price"] }),
    onSuccess: () => { setAltId(null); qc.invalidateQueries({ queryKey: ["inquiries", sid] }); },
  });

  const okCount = items.filter((i) => i.status === "answered" && i.answer?.available !== false).length;
  const simulated = items.some((i) => i.answer?.simulated);
  const products = useMemo(() => [...new Map(inq.items.filter((i) => i.product).map((i) => [i.product!.product_id, i.product!])).values()], [inq.items]);

  if (inq.isLoading) return <main className="main"><AppBar title="پیگیری استعلام" /><SkeletonCards n={3} /></main>;
  if (inq.isError) return <main className="main"><AppBar title="پیگیری استعلام" /><ErrorState error={inq.error} retry={() => inq.refetch()} /></main>;
  if (!items.length) return (
    <main className="main has-nav"><AppBar title="پیگیری استعلام" back="/" />
      <Empty icon="send" title="هنوز از فروشگاهی نپرسیده‌اید" action={<Link className="btn pri" href="/"><Icon n="search" s />شروع یک خرید</Link>}>کالا را انتخاب کنید، فروشگاه‌ها را تیک بزنید و «استعلام» را بزنید؛ پاسخ‌ها زنده اینجا می‌آیند.</Empty>
      <BottomNav /></main>
  );
  const p = items[0].product!;

  return (
    <main className="main has-cta">
      <AppBar title="پیگیری استعلام" sub={<Bidi text={p.title} />} back="/mine" end={<Link href={`/p/${pid}/shops`} className="iconbtn" aria-label="فروشگاه‌های بیشتر"><Icon n="plus" /></Link>} />
      <Steps at={3} />
      {(simulated || DEMO) && <div className="banner info"><Icon n="spark" s /><span><b>پاسخ‌ها شبیه‌سازی‌شده‌اند — حالت نمایشی.</b> فروشنده‌های واقعی در این نسخه پاسخ نمی‌دهند.</span></div>}
      <div className="pad stack" style={{ gap: 10, paddingTop: 10 }}>
        {products.length > 1 && (
          <div className="hscroll" style={{ paddingInline: 0 }}>
            {products.map((x) => <Link key={x.product_id} href={`/track?product=${x.product_id}`} className={`chip ${x.product_id === pid ? "on" : ""}`}><Bidi text={x.title.slice(0, 28)} /></Link>)}
          </div>
        )}
        <div className="row between xs muted">
          <span>سؤال‌ها: {items[0].questions.map((q) => q.text.replace("؟", "")).join(" · ")}</span>
          <span className={`oc ${inq.connected ? "open" : "unknown"}`}>{inq.connected ? "زنده" : "در حال اتصال…"}</span>
        </div>
        <Summary qs={items} />
        {items.map((q) => (
          <InquiryCard key={q.id} q={q} now={now} flash={flash === q.id} listed={q.shop ? listed.get(q.shop.shop_id) : null} onAlternatives={() => setAltId(q.id)} />
        ))}
      </div>

      {toast && <div className="toast" role="status"><Icon n="alert" /><span>{toast}</span></div>}
      <div className="sticky-cta">
        <Link className={`btn pri block`} href={okCount ? `/plan?product=${pid}` : "#"} aria-disabled={!okCount} style={okCount ? undefined : { opacity: .55, pointerEvents: "none" }}>
          <Icon n="route" s />ساخت برنامهٔ بازدید
        </Link>
        <div className="xs faint center" style={{ marginTop: 6 }}>{okCount ? `با ${fa(okCount)} فروشگاه تأییدشده` : "بعد از اولین پاسخ «موجود است» فعال می‌شود"}</div>
      </div>

      <Sheet open={!!alt} onClose={() => setAltId(null)} label="جایگزین‌ها">
        {alt && <AltBody q={alt} onAsk={(ids) => askMore.mutate(ids)} pending={askMore.isPending} />}
      </Sheet>
    </main>
  );
}

function AltBody({ q, onAsk, pending }: { q: Inquiry; onAsk: (ids: string[]) => void; pending: boolean }) {
  const a = q.alternatives;
  const head = (
    <div className="row" style={{ gap: 8 }}>
      <span className={`st ${q.status}`}>{q.status === "unavailable" ? "ناموجود" : "بی‌پاسخ"}</span>
      <h2 className="grow">{q.shop?.name} {q.status === "unavailable" ? "این کالا را ندارد" : "جواب نداد"}</h2>
    </div>
  );
  if (!a) return <>{head}<div className="row sm muted" style={{ gap: 8 }}><span className="spin" />در حال یافتن جایگزین…</div></>;
  if (!a.shops.length) return <>{head}<Note tone="unk" icon="store">فروشگاه باز دیگری که این کالا را ثبت کرده باشد پیدا نکردیم.</Note><Link className="btn sec block" href={`/p/${q.product?.product_id}/shops`}>دیدن فروشگاه‌های این دسته</Link></>;
  if (a.kind === "same_product") return (
    <>
      {head}
      <p className="lede" style={{ marginTop: -6 }}>همین مدل در {fa(a.shops.length)} فروشگاه باز دیگر ثبت شده است.</p>
      <Note tone="ok" icon="check">همان کالا: <Bidi text={q.product?.title} /></Note>
      {a.shops.map((s) => <ShopCard key={s.shop_id} s={s} />)}
      <button className="btn pri block" disabled={pending} onClick={() => onAsk(a.shops.map((s) => s.shop_id))}>
        {pending ? <span className="spin" /> : <Icon n="send" s />}استعلام از این {fa(a.shops.length)} فروشگاه
      </button>
    </>
  );
  return (
    <>
      {head}
      <p className="lede" style={{ marginTop: -6 }}>همین مدل جای دیگری باز نیست. این مدل‌های مشابه در فروشگاه‌های باز اطراف هستند:</p>
      <div className="card row" style={{ padding: 12, gap: 10, opacity: .8 }}>
        <Thumb src={q.product?.image} alt="" size={44} /><div><div className="xs faint">شما خواستید</div><div className="sm b"><Bidi text={q.product?.title} /></div></div>
      </div>
      {a.products.map((p, i) => (
        <Link key={p.product_id} href={`/p/${p.product_id}/shops`} className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="row" style={{ gap: 6, color: "var(--warn)" }}><Icon n="alert" s /><span className="xs b">مدل متفاوت؛ مشخصاتش را قبل از خرید مقایسه کنید</span></div>
          <div className="row" style={{ gap: 10 }}>
            <Thumb src={p.image} alt="" size={44} brand={p.brand} />
            <div className="grow"><div className="xs faint">پیشنهاد</div><div className="sm b"><Bidi text={p.title} /></div>
              <div className="xs muted">{p.price_min ? `از ${mil(p.price_min)} تومان · ` : ""}{a.shops[i]?.name ?? ""}</div></div>
            <Icon n="fwd" />
          </div>
        </Link>
      ))}
    </>
  );
}
