"use client";
// Alternatives when a shop says no or stays silent: the same model in other open shops, or similar models; the seller's own suggestion first.
import Link from "next/link";
import { type Inquiry } from "@/lib/api";
import { fa, mil } from "@/lib/fa";
import { Icon } from "./Icon";
import { ShopCard } from "./cards";
import { Bidi, Note, Thumb } from "./ui";

export function AltBody({ q, onAsk, pending }: { q: Inquiry; onAsk: (ids: string[]) => void; pending: boolean }) {
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
