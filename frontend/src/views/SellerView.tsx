"use client";
// Seller-side inbox, opened from the link in the Bale bot or /api/demo/seller-link/{shop}. Big one-hand buttons.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api, type Inquiry } from "@/lib/api";
import { fa, minutesAgo, money, parseNum } from "@/lib/fa";
import { useNow } from "@/lib/useInquiries";
import { Icon } from "@/components/Icon";
import { Bidi, Empty, ErrorState, Note, Seg, SkeletonCards } from "@/components/ui";

const HOURS: [string, string][] = [["19:00", "۱۹:۰۰"], ["20:00", "۲۰:۰۰"], ["21:00", "۲۱:۰۰"], ["22:00", "۲۲:۰۰"]];

export default function SellerView({ shop, token }: { shop: string; token: string }) {
  const [sent, setSent] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["seller", shop, token], queryFn: () => api.sellerInbox(shop, token), refetchInterval: 10_000, retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 1 });

  if (q.error instanceof ApiError && q.error.status === 403) return (
    <main className="main"><div style={{ paddingTop: 120 }}>
      <Empty icon="lock" tone="bad" title="این لینک معتبر نیست">لینک منقضی شده یا مال فروشگاه دیگری است. لینک تازه را از ربات بله بگیرید.</Empty></div></main>
  );
  if (q.isLoading) return <main className="main"><SkeletonCards n={2} /></main>;
  if (q.isError || !q.data) return <main className="main"><ErrorState error={q.error} retry={() => q.refetch()} /></main>;
  const pending = q.data.items.filter((i) => i.status === "sent" || i.status === "delivered");
  const past = q.data.items.filter((i) => !pending.includes(i));

  return (
    <main className="main seller-main">
      <header className="sellerbar">
        <span className="mk"><Icon n="inbox" /></span>
        <div className="grow"><div className="b">{q.data.shop.name}</div><div className="xs" style={{ opacity: .75 }}>صندوق استعلام · نسخهٔ فروشنده</div></div>
      </header>
      <div className="pad stack" style={{ gap: 14, paddingTop: 14 }}>
        {q.data.bale?.enabled && <BaleConnect b={q.data.bale} />}
        <div className="xs muted">{pending.length ? `${fa(pending.length)} استعلام منتظر پاسخ شماست` : "استعلام تازه‌ای ندارید. این صفحه خودکار به‌روز می‌شود."}</div>
        {sent && <div className="card"><Empty icon="check" tone="ok" title="پاسخ شما ارسال شد">{sent}</Empty></div>}
        {pending.map((i) => <Answerable key={i.id} i={i} shop={shop} token={token} onSent={setSent} />)}
        {past.length > 0 && <div className="h4" style={{ marginTop: 8 }}>پاسخ‌داده‌ها</div>}
        {past.map((i) => (
          <div key={i.id} className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="row between"><span className="sm b"><Bidi text={i.product?.title} /></span><span className={`st ${i.status}`}>{i.label}</span></div>
            {i.answer?.price ? <span className="xs muted">قیمت اعلام‌شده: {money(i.answer.price)} تومان</span> : null}
          </div>
        ))}
      </div>
    </main>
  );
}

function Answerable({ i, shop, token, onSent }: { i: Inquiry; shop: string; token: string; onSent: (msg: string) => void }) {
  const qc = useQueryClient();
  // this shop's own listed price for the product, so the seller only edits it when it changed
  const pid = i.product?.product_id;
  const offer = useQuery({
    queryKey: ["seller-listed", pid, shop],
    queryFn: () => api.productShops(pid!, null, {}, 100).then((r) => r.listed.find((s) => s.shop_id === shop)?.offer?.price ?? null),
    enabled: !!pid,
  });
  const listed = offer.data ?? null;
  const now = useNow();
  const [avail, setAvail] = useState<boolean | null>(null);
  const [price, setPrice] = useState<string>("");
  const [closes, setCloses] = useState<string>("20:00");
  const [inst, setInst] = useState<boolean | null>(null);
  const priceVal = price ? parseNum(price) : listed;
  const m = useMutation({
    mutationFn: () => api.sellerAnswer(shop, token, i.id, {
      available: avail, price: avail ? priceVal : null, closes_at: closes, installment: i.questions.some((x) => x.key === "installment") ? inst : null,
      message: avail ? (priceVal && listed && priceVal !== listed ? "موجوده ولی قیمت عوض شده." : "موجوده، تشریف بیارید.") : "متأسفانه موجود نیست.",
    }),
    onSuccess: () => onSent(avail
      ? `مشتری همین الان ${priceVal ? `قیمت ${money(priceVal)} تومان را` : "موجود بودن را"} با برچسب «تأیید شده توسط فروشنده» می‌بیند.`
      : "به مشتری گفتیم موجود نیست و فروشگاه دیگری پیشنهاد می‌دهیم."),
    onSettled: () => qc.invalidateQueries({ queryKey: ["seller", shop, token] }),
  });
  const left = Math.max(0, Math.round((new Date(i.deadline_at).getTime() - now) / 1000));

  return (
    <form className="stack" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="row between xs muted"><span>{minutesAgo(i.created_at, now)}</span><span className="num">{left ? `مهلت ${fa(Math.floor(left / 60))}:${fa(String(left % 60).padStart(2, "0"))}` : "مهلت تمام شد"}</span></div>
        <div className="b" style={{ lineHeight: 1.6 }}><Bidi text={i.product?.title} /></div>
        <div className="qa">{i.questions.map((x) => <div key={x.key}>{x.text}</div>)}{i.note && <div className="b">«{i.note}»</div>}</div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <button type="button" className={`bigbtn ok ${avail === false ? "dim" : ""}`} aria-pressed={avail === true} onClick={() => setAvail(true)}><Icon n="check" />موجود است</button>
        <button type="button" className={`bigbtn no ${avail === true ? "dim" : ""}`} aria-pressed={avail === false} onClick={() => setAvail(false)}><Icon n="x" />ناموجود</button>
      </div>
      {avail && (
        <>
          <div className="stack" style={{ gap: 6 }}>
            <label htmlFor={`p-${i.id}`} className="b sm">قیمت امروز (تومان)</label>
            <div className="field" style={{ minHeight: 58 }}>
              <input id={`p-${i.id}`} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={listed ? money(listed) : "مثلاً ۲٬۸۵۰٬۰۰۰"} style={{ fontSize: 20, fontWeight: 800 }} />
              <span className="xs faint">تومان</span>
            </div>
            <span className="xs faint">{listed ? `قیمت ثبت‌شدهٔ شما ${money(listed)} تومان است؛ اگر تغییر کرده، اصلاح کنید.` : "برای این کالا قیمتی ثبت نکرده‌اید."}</span>
          </div>
          {i.questions.some((x) => x.key === "installment") && (
            <div className="stack" style={{ gap: 6 }}><span className="b sm">قسط حضوری می‌پذیرید؟</span>
              <Seg label="قسط" value={inst} onChange={setInst} options={[[true, "بله"], [false, "نه"]]} /></div>
          )}
        </>
      )}
      {avail !== null && (
        <div className="stack" style={{ gap: 6 }}><span className="b sm">امروز تا چه ساعتی باز هستید؟</span>
          <Seg label="ساعت بسته شدن" value={closes} onChange={setCloses} options={HOURS} /></div>
      )}
      {m.error instanceof ApiError && m.error.status === 409 && <Note tone="info" icon="alert"><b>این استعلام قبلاً پاسخ داده شده.</b> اگر قیمت عوض شده، در استعلام بعدی پاسخ تازه بفرستید.</Note>}
      {m.isError && !(m.error instanceof ApiError && m.error.status === 409) && <Note tone="bad" icon="alert">{(m.error as Error).message}</Note>}
      <button className="btn pri block" style={{ minHeight: 56, fontSize: 17 }} disabled={avail === null || m.isPending || (avail && !priceVal && !listed) as boolean}>
        {m.isPending ? <span className="spin" /> : <Icon n="send" s />}ارسال پاسخ
      </button>
    </form>
  );
}


/** Optional second channel: answer inquiries from Bale instead of this page. Shown only when the bot is configured. */
function BaleConnect({ b }: { b: { bot_username?: string | null; linked?: boolean; command?: string } }) {
  const [copied, setCopied] = useState(false);
  if (b.linked) return <div className="note ok"><Icon n="check" s /><span>بله متصل است؛ استعلام‌ها در بله هم می‌آید.</span></div>;
  return (
    <section className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="h4">جواب دادن از «بله»</div>
      <div className="xs muted">{b.bot_username ? <>ربات <bdi dir="ltr">@{b.bot_username}</bdi> را در بله باز کنید و</> : "ربات را در بله باز کنید و"} این دستور را بفرستید؛ بعد استعلام‌ها با دکمه در بله می‌آید.</div>
      <code dir="ltr" style={{ fontSize: 12, wordBreak: "break-all", padding: 8, borderRadius: 8, background: "var(--bg-2, rgba(127,127,127,.12))" }}>{b.command}</code>
      <button type="button" className="btn sec" onClick={() => { navigator.clipboard?.writeText(b.command ?? "").then(() => setCopied(true)).catch(() => {}); }}>{copied ? "کپی شد" : "کپی دستور"}</button>
    </section>
  );
}
