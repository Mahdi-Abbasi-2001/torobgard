"use client";
// Seller-side inbox, opened from the link in the Bale bot or /api/demo/seller-link/{shop}. Big one-hand buttons; one tap for
// "yes, same price as listed"; or just type the answer like in a chat and the assistant reads it (and may ask once more).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api, type Inquiry } from "@/lib/api";
import { fa, minutesAgo, money, parseNum } from "@/lib/fa";
import { useNow } from "@/lib/useInquiries";
import { Icon } from "@/components/Icon";
import { Conversation } from "@/components/followup";
import { Bidi, Empty, ErrorState, Note, Seg, SkeletonCards } from "@/components/ui";

const HOURS: [string, string][] = [["19:00", "۱۹:۰۰"], ["20:00", "۲۰:۰۰"], ["21:00", "۲۱:۰۰"], ["22:00", "۲۲:۰۰"]];

export default function SellerView({ shop, token }: { shop: string; token: string }) {
  const [sent, setSent] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["seller", shop, token], queryFn: () => api.sellerInbox(shop, token), refetchInterval: 6_000, retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 1 });

  if (q.error instanceof ApiError && q.error.status === 403) return (
    <main className="main"><div style={{ paddingTop: 120 }}>
      <Empty icon="lock" tone="bad" title="این لینک معتبر نیست">لینک منقضی شده یا مال فروشگاه دیگری است. لینک تازه را از ربات بله بگیرید.</Empty></div></main>
  );
  if (q.isLoading) return <main className="main"><SkeletonCards n={2} /></main>;
  if (q.isError || !q.data) return <main className="main"><ErrorState error={q.error} retry={() => q.refetch()} /></main>;
  const pending = q.data.items.filter((i) => i.status === "sent" || i.status === "delivered");
  const past = q.data.items.filter((i) => !pending.includes(i));
  const st = q.data.stats;

  return (
    <main className="main seller-main">
      <header className="sellerbar">
        <span className="mk"><Icon n="inbox" /></span>
        <div className="grow"><div className="b">{q.data.shop.name}</div><div className="xs" style={{ opacity: .75 }}>صندوق استعلام · نسخهٔ فروشنده</div></div>
      </header>
      <div className="pad stack" style={{ gap: 14, paddingTop: 14 }}>
        {st && (st.asked || st.listing_updates) ? (
          <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="h4">کارنامهٔ پاسخ‌گویی شما</div>
            <div className="xs muted">{st.label ? fa(st.label) : `به ${fa(st.replied ?? 0)} از ${fa(st.asked ?? 0)} استعلام پاسخ داده‌اید`}</div>
            <div className="xs faint">فروشگاه‌هایی که زود و درست جواب می‌دهند بالاتر نشان داده می‌شوند.{st.listing_updates ? ` · ${fa(st.listing_updates)} قیمت را از همین‌جا به‌روز کرده‌اید.` : ""}</div>
          </div>
        ) : null}
        {q.data.bale?.enabled && <BaleConnect b={q.data.bale} />}
        <div className="xs muted">{pending.length ? `${fa(pending.length)} استعلام منتظر پاسخ شماست` : "استعلام تازه‌ای ندارید. این صفحه خودکار به‌روز می‌شود."}</div>
        {sent && <div className="card"><Empty icon="check" tone="ok" title="پاسخ شما ارسال شد">{sent}</Empty></div>}
        {pending.map((i) => <Answerable key={i.id} i={i} shop={shop} token={token} onSent={setSent} />)}
        {past.length > 0 && <div className="h4" style={{ marginTop: 8 }}>پاسخ‌داده‌ها</div>}
        {past.map((i) => <Past key={i.id} i={i} shop={shop} token={token} />)}
      </div>
    </main>
  );
}

function Past({ i, shop, token }: { i: Inquiry; shop: string; token: string }) {
  const qc = useQueryClient();
  const upd = useMutation({ mutationFn: () => api.sellerUpdateListing(shop, token, i.id), onSettled: () => qc.invalidateQueries({ queryKey: ["seller", shop, token] }) });
  const a = i.answer;
  const canUpdate = i.kind === "ask" && a?.price && !a.listing_updated && a.price !== i.listed_price;
  return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="row between"><span className="sm b"><Bidi text={i.product?.title} /></span><span className={`st ${i.status}`}>{i.label}</span></div>
      {a?.price ? <span className="xs muted">قیمت اعلام‌شده: {money(a.price)} تومان{a.listing_updated ? " · در ترب‌گرد هم به‌روز شد" : ""}</span> : null}
      {a?.hold_code && <span className="xs muted">کد نگه‌داری: <b className="num">{fa(a.hold_code)}</b> · تا {fa(a.hold_until ?? "")}</span>}
      {canUpdate && <button className="btn ghost" style={{ minHeight: 38 }} disabled={upd.isPending} onClick={() => upd.mutate()}><Icon n="refresh" s />قیمت ثبت‌شده‌ام را هم {money(a!.price!)} کن</button>}
      <Conversation q={i} />
    </div>
  );
}

function Answerable({ i, shop, token, onSent }: { i: Inquiry; shop: string; token: string; onSent: (msg: string) => void }) {
  const qc = useQueryClient();
  const listed = i.listed_price;
  const now = useNow();
  const [avail, setAvail] = useState<boolean | null>(null);
  const [price, setPrice] = useState<string>("");
  const [closes, setCloses] = useState<string>("20:00");
  const [inst, setInst] = useState<boolean | null>(null);
  const [alt, setAlt] = useState("");
  const [updateListing, setUpdateListing] = useState(true);
  const [text, setText] = useState("");
  const priceVal = price ? parseNum(price) : listed;
  const done = () => qc.invalidateQueries({ queryKey: ["seller", shop, token] });
  const m = useMutation({
    mutationFn: (over?: { same?: boolean; tomorrow?: boolean; hold?: boolean; still?: boolean }) => {
      if (over?.hold !== undefined) return api.sellerAnswer(shop, token, i.id, { hold_accepted: over.hold, message: over.hold ? "نگه می‌دارم" : "نمی‌توانم نگه دارم" });
      if (over?.still !== undefined) return api.sellerAnswer(shop, token, i.id, { available: over.still, message: over.still ? "هنوز هست" : "تمام شد" });
      if (over?.same) return api.sellerAnswer(shop, token, i.id, { available: true, same_as_listed: true, closes_at: closes, message: "موجود است، به همان قیمت ثبت‌شده" });
      if (over?.tomorrow) return api.sellerAnswer(shop, token, i.id, { available: false, restock: "فردا", message: "فردا موجود می‌شود" });
      const changed = !!(priceVal && priceVal !== listed);
      return api.sellerAnswer(shop, token, i.id, {
        available: avail, price: avail ? priceVal : null, closes_at: closes, installment: i.questions.some((x) => x.key === "installment") ? inst : null,
        alt_suggestion: !avail && alt.trim() ? alt.trim() : undefined, update_listing: !!avail && changed && updateListing,
        message: avail ? (changed ? "موجوده ولی قیمت عوض شده." : "موجوده، تشریف بیارید.") : "متأسفانه موجود نیست.",
      });
    },
    onSuccess: (v) => onSent(v.kind === "hold"
      ? (v.answer?.hold_accepted ? `کد نگه‌داری ${fa(v.answer.hold_code ?? "")} برای مشتری فرستاده شد.` : "به مشتری گفتیم نمی‌توانید نگه دارید.")
      : v.status === "answered"
        ? `مشتری همین الان ${v.answer?.price ? `قیمت ${money(v.answer.price)} تومان را` : "موجود بودن را"} با برچسب «تأیید شده توسط فروشنده» می‌بیند.${v.answer?.listing_updated ? " قیمت ثبت‌شده‌تان هم به‌روز شد." : ""}`
        : "به مشتری گفتیم موجود نیست و فروشگاه دیگری پیشنهاد می‌دهیم."),
    onSettled: done,
  });
  const reply = useMutation({
    mutationFn: () => api.sellerReply(shop, token, i.id, text),
    onSuccess: (r) => { setText(""); if (!r.follow_up) onSent(`مشتری می‌بیند: ${r.inquiry.answer?.summary ?? r.inquiry.label}`); },
    onSettled: done,
  });
  const left = Math.max(0, Math.round((new Date(i.deadline_at).getTime() - now) / 1000));
  const lastAgent = [...(i.thread ?? [])].reverse().find((x) => x.role === "agent");
  const firstMsg = i.thread?.find((x) => x.role === "buyer")?.text;

  const header = (
    <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row between xs muted"><span>{i.kind === "hold" ? "درخواست نگه‌داشتن" : i.kind === "recheck" ? "مشتری در راه است" : "استعلام"} · {minutesAgo(i.created_at, now)}</span><span className="num">{left ? `مهلت ${fa(Math.floor(left / 60))}:${fa(String(left % 60).padStart(2, "0"))}` : "مهلت تمام شد"}</span></div>
      <div className="b" style={{ lineHeight: 1.6 }}><Bidi text={i.product?.title} /></div>
      <div className="qa" style={{ whiteSpace: "pre-line" }}>{firstMsg ?? i.questions.map((x) => x.text).join("\n")}</div>
      {i.awaiting_seller && lastAgent && <Note tone="info" icon="chat"><span><b>سؤال تکمیلی:</b> {lastAgent.text}</span></Note>}
    </div>
  );
  const freeText = (
    <div className="stack" style={{ gap: 6 }}>
      <label htmlFor={`t-${i.id}`} className="b sm">{i.awaiting_seller ? "جواب سؤال تکمیلی" : "یا خیلی ساده جواب را بنویسید"}</label>
      <div className="field" style={{ minHeight: 52 }}>
        <input id={`t-${i.id}`} value={text} onChange={(e) => setText(e.target.value)} placeholder={i.kind === "hold" ? "مثلاً: باشه، تا ۶ نگه می‌دارم" : "مثلاً: داریم، ۲ و ۸۵۰. تا ۹ شب هستیم"} />
        <button type="button" className="iconbtn" aria-label="ارسال متن" disabled={!text.trim() || reply.isPending} onClick={() => reply.mutate()}>{reply.isPending ? <span className="spin" /> : <Icon n="send" />}</button>
      </div>
      <span className="xs faint">ترب‌گرد متن شما را می‌خواند؛ اگر چیزی مثل قیمت جا افتاده باشد، یک بار دیگر می‌پرسد.</span>
    </div>
  );
  const errors = (
    <>
      {m.error instanceof ApiError && m.error.status === 409 && <Note tone="info" icon="alert"><b>این استعلام قبلاً پاسخ داده شده.</b> اگر قیمت عوض شده، در استعلام بعدی پاسخ تازه بفرستید.</Note>}
      {m.isError && !(m.error instanceof ApiError && m.error.status === 409) && <Note tone="bad" icon="alert">{(m.error as Error).message}</Note>}
      {reply.isError && <Note tone="bad" icon="alert">{(reply.error as Error).message}</Note>}
    </>
  );

  if (i.kind === "hold" || i.kind === "recheck") return (
    <div className="stack" style={{ gap: 14 }}>
      {header}
      <div className="row" style={{ gap: 10 }}>
        <button type="button" className="bigbtn ok" disabled={m.isPending} onClick={() => m.mutate(i.kind === "hold" ? { hold: true } : { still: true })}><Icon n="check" />{i.kind === "hold" ? `نگه می‌دارم تا ${fa(i.hold_until ?? "")}` : "هنوز هست"}</button>
        <button type="button" className="bigbtn no" disabled={m.isPending} onClick={() => m.mutate(i.kind === "hold" ? { hold: false } : { still: false })}><Icon n="x" />{i.kind === "hold" ? "نمی‌توانم" : "تمام شد"}</button>
      </div>
      {freeText}{errors}
    </div>
  );

  return (
    <form className="stack" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); m.mutate(undefined); }}>
      {header}
      {i.awaiting_seller ? freeText : (
        <>
          {listed ? (
            <button type="button" className="bigbtn ok" style={{ width: "100%" }} disabled={m.isPending} onClick={() => m.mutate({ same: true })}>
              <Icon n="check" />موجود است · همان {money(listed)} تومان
            </button>
          ) : null}
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className={`bigbtn ok ${avail === false ? "dim" : ""}`} aria-pressed={avail === true} onClick={() => setAvail(true)}><Icon n="check" />{listed ? "موجود، قیمت دیگر" : "موجود است"}</button>
            <button type="button" className={`bigbtn no ${avail === true ? "dim" : ""}`} aria-pressed={avail === false} onClick={() => setAvail(false)}><Icon n="x" />ناموجود</button>
          </div>
          <button type="button" className="btn ghost" style={{ minHeight: 44 }} disabled={m.isPending} onClick={() => m.mutate({ tomorrow: true })}><Icon n="clock" s />الان نیست، فردا موجود می‌شود</button>
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
              {priceVal && priceVal !== listed ? (
                <label className="card frow" style={{ padding: "0 12px", minHeight: 52, cursor: "pointer" }}>
                  <span className="sm">قیمت ثبت‌شده‌ام در ترب هم {money(priceVal)} شود <span className="xs faint">(بقیهٔ خریدارها هم قیمت درست را می‌بینند)</span></span>
                  <input type="checkbox" className="sr" checked={updateListing} onChange={() => setUpdateListing(!updateListing)} />
                  <span className={`sel ${updateListing ? "on" : ""}`} aria-hidden="true">{updateListing && <Icon n="check" s />}</span>
                </label>
              ) : null}
              {i.questions.some((x) => x.key === "installment") && (
                <div className="stack" style={{ gap: 6 }}><span className="b sm">قسط حضوری می‌پذیرید؟</span>
                  <Seg label="قسط" value={inst} onChange={setInst} options={[[true, "بله"], [false, "نه"]]} /></div>
              )}
            </>
          )}
          {avail === false && (
            <div className="stack" style={{ gap: 6 }}>
              <label htmlFor={`a-${i.id}`} className="b sm">مدل مشابهی دارید؟ <span className="xs faint">(اختیاری؛ به مشتری پیشنهاد می‌دهیم)</span></label>
              <div className="field"><input id={`a-${i.id}`} value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="مثلاً: ردمی بادز ۵" maxLength={100} /></div>
            </div>
          )}
          {avail !== null && (
            <div className="stack" style={{ gap: 6 }}><span className="b sm">امروز تا چه ساعتی باز هستید؟</span>
              <Seg label="ساعت بسته شدن" value={closes} onChange={setCloses} options={HOURS} /></div>
          )}
          {avail !== null && (
            <button className="btn pri block" style={{ minHeight: 56, fontSize: 17 }} disabled={m.isPending || (avail && !priceVal && !listed) as boolean}>
              {m.isPending ? <span className="spin" /> : <Icon n="send" s />}ارسال پاسخ
            </button>
          )}
          {avail === null && freeText}
        </>
      )}
      {errors}
      <Conversation q={i} />
    </form>
  );
}


/** Optional second channel: answer inquiries from Bale instead of this page. Shown only when the bot is configured. */
function BaleConnect({ b }: { b: { bot_username?: string | null; linked?: boolean; command?: string } }) {
  const [copied, setCopied] = useState(false);
  if (b.linked) return <div className="note ok"><Icon n="check" s /><span>بله متصل است؛ استعلام‌ها در بله هم می‌آید و می‌توانید همان‌جا با دکمه، متن یا پیام صوتی جواب بدهید.</span></div>;
  return (
    <section className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="h4">جواب دادن از «بله»</div>
      <div className="xs muted">{b.bot_username ? <>ربات <bdi dir="ltr">@{b.bot_username}</bdi> را در بله باز کنید و</> : "ربات را در بله باز کنید و"} این دستور را بفرستید؛ بعد استعلام‌ها با دکمه در بله می‌آید (متن و پیام صوتی هم قبول است).</div>
      <code dir="ltr" style={{ fontSize: 12, wordBreak: "break-all", padding: 8, borderRadius: 8, background: "var(--bg-2, rgba(127,127,127,.12))" }}>{b.command}</code>
      <button type="button" className="btn sec" onClick={() => { navigator.clipboard?.writeText(b.command ?? "").then(() => setCopied(true)).catch(() => {}); }}>{copied ? "کپی شد" : "کپی دستور"}</button>
    </section>
  );
}
