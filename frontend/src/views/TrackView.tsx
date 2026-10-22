"use client";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Campaign, type Inquiry } from "@/lib/api";
import { fa, mil, money } from "@/lib/fa";
import { useIsDesktop } from "@/lib/media";
import { useSession } from "@/lib/session";
import { useInquiries, useNow } from "@/lib/useInquiries";
import { Icon } from "@/components/Icon";
import { ShopCard } from "@/components/cards";
import { InquiryCard, Summary, diffPct, isFailed } from "@/components/inquiry";
import { CallScript, CampaignBanner, HoldPicker, NotifyOptIn, VisitReport } from "@/components/followup";
import { AppBar, BottomNav, Bidi, Empty, ErrorState, Note, Sheet, SkeletonCards, Steps, Thumb, Toggle } from "@/components/ui";

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== "0";

export default function TrackView({ product }: { product?: string }) {
  const { sid, state } = useSession();
  const qc = useQueryClient();
  const now = useNow();
  const [altId, setAltId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [selId, setSel] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ type: "hold" | "call" | "report"; q: Inquiry } | null>(null);
  const [reported, setReported] = useState<Record<string, boolean>>({});
  const desk = useIsDesktop();
  const listedRef = useRef(new Map<string, { price: number | null; age_days: number | null }>());
  const pidRef = useRef<string | undefined>(product);

  // Live changes: highlight the card, explain a price difference, open alternatives when a shop fails
  const inq = useInquiries(sid, {
    onChange: (n) => {
      if (n.product?.product_id !== pidRef.current) return;
      setFlash(n.id); setTimeout(() => setFlash((f) => (f === n.id ? null : f)), 1500);
      if (n.campaign_id) qc.invalidateQueries({ queryKey: ["campaigns", sid] });
      if (n.kind === "ask" && n.status === "answered" && n.shop && n.answer?.price) {
        const pct = diffPct(n, listedRef.current.get(n.shop.shop_id)?.price ?? n.listed_price);
        const drift = n.answer.drift?.cheaper_nearby?.length ? ` · ${fa(n.answer.drift.cheaper_nearby.length)} فروشگاه نزدیک ارزان‌تر است` : "";
        if (pct || drift) { setToast(`${n.shop.name}: ${money(n.answer.price)} تومان${pct ? ` — ${fa(Math.abs(pct))}٪ ${pct > 0 ? "بیشتر" : "کمتر"} از قیمت ثبت‌شده` : ""}${drift}`); setTimeout(() => setToast(null), 6000); }
      }
      if (n.kind === "hold" && n.answer?.hold_accepted) { setToast(`${n.shop?.name}: نگه می‌دارد · کد ${fa(n.answer.hold_code ?? "")}`); setTimeout(() => setToast(null), 6000); }
      if (isFailed(n) && n.kind !== "hold") setTimeout(() => setAltId(n.id), 900);
    },
  });

  const pid = product ?? inq.items[0]?.product?.product_id;
  // newest question per shop (asking a shop again replaces its old card); holds and rechecks hang under their question
  const items = useMemo(() => {
    const seen = new Set<string>();
    return inq.items.filter((i) => i.kind === "ask" && i.product?.product_id === pid && i.shop && !seen.has(i.shop.shop_id) && seen.add(i.shop.shop_id));
  }, [inq.items, pid]);
  // holds / rechecks by the card they belong to: asking the same shop again keeps an earlier hold code visible
  const kids = useMemo(() => {
    const byId = new Map(inq.items.map((i) => [i.id, i]));
    const cardOf = new Map(items.map((i) => [`${i.shop!.shop_id}:${i.product?.product_id}`, i.id]));
    const m = new Map<string, Inquiry[]>();
    inq.items.forEach((i) => {
      if (!i.parent_id) return;
      const p = byId.get(i.parent_id);
      const card = (p?.shop && cardOf.get(`${p.shop.shop_id}:${p.product?.product_id}`)) || i.parent_id;
      m.set(card, [...(m.get(card) ?? []), i]);
    });
    return m;
  }, [inq.items, items]);
  const camps = useQuery({ queryKey: ["campaigns", sid], queryFn: () => api.campaigns(sid), enabled: !!sid, refetchInterval: 15_000 });
  const camp: Campaign | undefined = camps.data?.items.find((c) => c.product_id === pid);
  const sess = useQuery({ queryKey: ["session-state", sid], queryFn: () => api.getSession(sid), enabled: !!sid });
  const [autoAlt, setAutoAlt] = useState<boolean | null>(null);
  const auto = autoAlt ?? !!sess.data?.auto_alternatives;
  const shops = useQuery({ queryKey: ["pshops-all", pid, state.place.lat], queryFn: () => api.productShops(pid!, state.place, { sort: "best" }, 100), enabled: !!pid });
  const listed = useMemo(() => {
    const m = new Map<string, { price: number | null; age_days: number | null }>();
    shops.data?.listed.forEach((s) => m.set(s.shop_id, { price: s.offer?.price ?? null, age_days: s.offer?.age_days ?? null }));
    return m;
  }, [shops.data]);
  useEffect(() => { listedRef.current = listed; pidRef.current = pid; });
  const alt = altId ? inq.items.find((x) => x.id === altId) ?? null : null;

  const stopCamp = useMutation({ mutationFn: (id: string) => api.stopCampaign(sid, id), onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", sid] }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["inquiries", sid] });
  const hold = useMutation({ mutationFn: ({ id, until }: { id: string; until: string }) => api.hold(sid, id, until), onSuccess: () => { setSheet(null); refresh(); } });
  const recheck = useMutation({
    mutationFn: (q: Inquiry) => api.recheck(sid, q.id, shops.data?.listed.find((s) => s.shop_id === q.shop?.shop_id)?.walk_min ?? null),
    onSuccess: refresh,
  });
  const setAuto = (v: boolean) => { setAutoAlt(v); api.putSession(sid, { auto_alternatives: v }).catch(() => {}); };
  const actionsFor = (q: Inquiry) => ({
    onHold: () => setSheet({ type: "hold", q }),
    onRecheck: () => recheck.mutate(q),
    onReport: reported[q.id] ? undefined : () => setSheet({ type: "report", q }),
    onCall: () => setSheet({ type: "call", q }),
  });

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
  // desktop side panel: the chosen card (default: first answer) and the alternatives for the latest failure
  const sel = items.find((x) => x.id === selId) ?? items.find((x) => x.status === "answered") ?? items[0];
  const altFor = alt ?? (sel && isFailed(sel) ? sel : items.find(isFailed)) ?? null;

  return (
    <main className="main has-cta">
      <div className="lay lay-head">
      <AppBar title="پیگیری استعلام" sub={<Bidi text={p.title} />} back="/mine" end={<Link href={`/p/${pid}/shops`} className="iconbtn" aria-label="فروشگاه‌های بیشتر"><Icon n="plus" /></Link>} />
      <Steps at={3} />
      {(simulated || DEMO) && <div className="banner info"><Icon n="spark" s /><span><b>پاسخ‌ها شبیه‌سازی‌شده‌اند — حالت نمایشی.</b> فروشنده‌های نمایشی مثل آدم واقعی متن می‌نویسند؛ ترب‌گرد جوابشان را می‌خواند و اگر چیزی کم باشد دوباره می‌پرسد.</span></div>}
      </div>
      <div className="lay lay-track">
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
        {camp && <CampaignBanner c={camp} onStop={() => stopCamp.mutate(camp.id)} stopping={stopCamp.isPending} />}
        {items.map((q) => {
          const ks = kids.get(q.id) ?? [];
          const failedKid = ks.find((k) => k.kind === "recheck" && k.status === "unavailable");
          return (
            <div key={q.id} className={`lay trk-item${sel?.id === q.id ? " is-sel" : ""}`} onClick={() => setSel(q.id)}>
              {(q.auto_from || q.campaign_id) && <div className="xs faint row" style={{ gap: 4, marginBottom: 4 }}><Icon n="spark" s />{q.auto_from ? "خودکار پرسیده شد (جایگزین)" : `پرسیدن موجی${camp?.reasons[q.shop!.shop_id] ? ` · چرا: ${camp.reasons[q.shop!.shop_id]}` : ""}`}</div>}
              <InquiryCard q={q} now={now} flash={flash === q.id} listed={q.shop ? listed.get(q.shop.shop_id) : null} kids={ks}
                actions={actionsFor(q)} onAlternatives={() => { setAltId(failedKid?.id ?? q.id); setSel(q.id); }} />
            </div>
          );
        })}
        <div className="card frow" style={{ padding: "10px 12px", gap: 10 }}>
          <div className="grow"><div className="sm b">اگر جایی نداشت، خودکار از بعدی بپرس</div><div className="xs faint">تا ۶ فروشگاه دیگر، فقط همین کالا</div></div>
          <Toggle on={auto} onChange={setAuto} label="پرسیدن خودکار از جایگزین‌ها" />
        </div>
        <NotifyOptIn sid={sid} />
      </div>
      <aside className="dk-only trk-detail" aria-label="جزئیات استعلام">
        {sel && (
          <div className="panel">
            <div className="row between"><span className="h4">جزئیات</span>{sel.shop && <Link className="btn ghost" style={{ minHeight: 36 }} href={`/shop/${sel.shop.shop_id}?product=${pid}`}>صفحهٔ فروشگاه <Icon n="fwd" s /></Link>}</div>
            <InquiryCard q={sel} now={now} listed={sel.shop ? listed.get(sel.shop.shop_id) : null} kids={kids.get(sel.id) ?? []} actions={actionsFor(sel)} />
            {sel.note && <div className="qa">یادداشت شما: «{sel.note}»</div>}
          </div>
        )}
        {altFor && <div className="panel"><AltBody q={altFor} onAsk={(ids) => askMore.mutate(ids)} pending={askMore.isPending} /></div>}
      </aside>
      </div>

      {toast && <div className="toast" role="status"><Icon n="alert" /><span>{toast}</span></div>}
      <div className="sticky-cta">
        <Link className={`btn pri block`} href={okCount ? `/plan?product=${pid}` : "#"} aria-disabled={!okCount} style={okCount ? undefined : { opacity: .55, pointerEvents: "none" }}>
          <Icon n="route" s />ساخت برنامهٔ بازدید
        </Link>
        <div className="xs faint center" style={{ marginTop: 6 }}>{okCount ? `با ${fa(okCount)} فروشگاه تأییدشده` : "بعد از اولین پاسخ «موجود است» فعال می‌شود"}</div>
      </div>

      <Sheet open={!!alt && !desk} onClose={() => setAltId(null)} label="جایگزین‌ها">
        {alt && <AltBody q={alt} onAsk={(ids) => askMore.mutate(ids)} pending={askMore.isPending} />}
      </Sheet>
      <Sheet open={!!sheet} onClose={() => setSheet(null)} label={sheet?.type === "hold" ? "نگه‌داشتن" : sheet?.type === "call" ? "تماس" : "گزارش مراجعه"}>
        {sheet?.type === "hold" && <HoldPicker closes={sheet.q.answer?.closes_at} pending={hold.isPending} onPick={(until) => hold.mutate({ id: sheet.q.id, until })} />}
        {sheet?.type === "hold" && hold.isError && <Note tone="bad" icon="alert">{(hold.error as Error).message}</Note>}
        {sheet?.type === "call" && <CallScript q={sheet.q} sid={sid} onDone={() => { setSheet(null); setToast("ثبت شد؛ بقیهٔ خریدارها هم می‌بینند."); setTimeout(() => setToast(null), 4000); qc.invalidateQueries({ queryKey: ["pshops-all"] }); }} />}
        {sheet?.type === "report" && <VisitReport q={sheet.q} sid={sid} onDone={() => { setReported((r) => ({ ...r, [sheet.q.id]: true })); setSheet(null); setToast("ممنون! این به بقیه کمک می‌کند بدانند این فروشگاه چقدر درست می‌گوید."); setTimeout(() => setToast(null), 4000); }} />}
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
  const sellerAlt = q.answer?.alt_suggestion ? <Note tone="info" icon="spark">خود فروشنده پیشنهاد داد: <b><Bidi text={q.answer.alt_suggestion} /></b></Note> : null;
  if (!a) return <>{head}{sellerAlt}<div className="row sm muted" style={{ gap: 8 }}><span className="spin" />در حال یافتن جایگزین…</div></>;
  if (!a.shops.length) return <>{head}<Note tone="unk" icon="store">فروشگاه باز دیگری که این کالا را ثبت کرده باشد پیدا نکردیم.</Note><Link className="btn sec block" href={`/p/${q.product?.product_id}/shops`}>دیدن فروشگاه‌های این دسته</Link></>;
  if (a.kind === "same_product") return (
    <>
      {head}
      {sellerAlt}
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
      {sellerAlt}
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
