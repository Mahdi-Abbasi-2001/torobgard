"use client";
// Step 4 building blocks: the seller conversation, hold / recheck, phone script, visit report, waves, notifications.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type Campaign, type Inquiry } from "@/lib/api";
import { clock, fa, money, parseNum } from "@/lib/fa";
import { Icon } from "./Icon";
import { Bidi, Note, Seg } from "./ui";

const WHO: Record<string, string> = { buyer: "پیام ترب‌گرد به فروشنده", seller: "فروشنده", agent: "ترب‌گرد (سؤال تکمیلی)", system: "" };

/** The actual messages exchanged with the seller, so the shopper sees what was asked and answered, in their words. */
export function Conversation({ q, open: initial = false }: { q: Inquiry; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  const msgs = q.thread ?? [];
  if (msgs.length < 2 && !q.awaiting_seller) return null;
  const n = msgs.filter((m) => m.role !== "buyer").length;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <button type="button" className="xs row" style={{ gap: 6, background: "none", border: 0, padding: 0, color: "var(--info-ink)", fontWeight: 650 }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon n="chat" s />{open ? "بستن گفتگو" : `گفتگو با فروشنده (${fa(n)} پیام)`}
      </button>
      {open && (
        <div className="conv">
          {msgs.map((m, i) => (
            <div key={i} className={`m ${m.role}`}>
              <small>{WHO[m.role]}{m.channel === "bale" ? " · از بله" : ""}{m.simulated ? " · نمایشی" : ""} · {clock(m.at)}</small>
              <Bidi text={m.text} />
            </div>
          ))}
          {q.awaiting_seller && <div className="xs muted row" style={{ gap: 6 }}><span className="spin" />منتظر جواب فروشنده به سؤال تکمیلی…</div>}
        </div>
      )}
    </div>
  );
}

/** Extra facts a seller gave in free text: variants, restock, warranty, a suggested alternative. */
export function AnswerDetails({ q }: { q: Inquiry }) {
  const a = q.answer;
  if (!a) return null;
  const chips: React.ReactNode[] = [];
  if (a.variants_available?.length) chips.push(<span key="va" className="tb ok">موجود: {a.variants_available.join("، ")}</span>);
  if (a.variants_unavailable?.length) chips.push(<span key="vu" className="tb bad">تمام شده: {a.variants_unavailable.join("، ")}</span>);
  if (a.restock) chips.push(<span key="rs" className="tb info">دوباره می‌آید: {a.restock}{a.opens_at ? ` · از ${fa(a.opens_at)}` : ""}</span>);
  if (a.warranty) chips.push(<span key="w" className="tb">گارانتی: {fa(a.warranty)}</span>);
  if (a.original === true) chips.push(<span key="o" className="tb ok">اصل و آکبند (به گفتهٔ فروشنده)</span>);
  if (a.original === false) chips.push(<span key="o" className="tb bad">اصل نیست (به گفتهٔ فروشنده)</span>);
  if (a.same_as_listed) chips.push(<span key="s" className="tb ok">همان قیمت ثبت‌شده</span>);
  if (a.listing_updated) chips.push(<span key="l" className="tb ok">فروشنده قیمتش را در ترب‌گرد هم به‌روز کرد</span>);
  const custom = q.questions.filter((x) => x.custom && a.answers?.[x.key]);
  return (
    <>
      {chips.length > 0 && <div className="truth">{chips}</div>}
      {custom.map((x) => <div key={x.key} className="xs"><span className="faint">{x.text} </span><b>{a.answers![x.key]}</b></div>)}
      {a.alt_suggestion && <Note tone="info" icon="spark">پیشنهاد فروشنده به‌جای این کالا: <b><Bidi text={a.alt_suggestion} /></b></Note>}
      {a.drift?.summary && (
        <Note tone={a.drift.alert ? "warn" : "ok"} icon={a.drift.alert ? "alert" : "check"}>
          <span>{fa(a.drift.summary)}.
            {a.drift.cheaper_nearby.slice(0, 2).map((c) => <span key={c.shop_id} className="row" style={{ gap: 4 }}>• {c.name}: {money(c.price)} تومان{c.confirmed ? " (تأییدشده)" : " (ثبت‌شده)"}</span>)}
          </span>
        </Note>
      )}
    </>
  );
}

/** Hold / recheck sent to the same shop, shown under the main inquiry. */
export function KidRow({ k }: { k: Inquiry }) {
  const a = k.answer;
  const waiting = k.status === "sent" || k.status === "delivered";
  if (k.kind === "arrive") {
    if (waiting) return <div className="kid"><span className="spin" /><span>به فروشنده خبر دادیم که رسیده‌اید…</span></div>;
    if (k.status === "answered") return <div className="kid" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}><Icon n="check" s /><span>فروشنده منتظر شماست.</span></div>;
    return <div className="kid"><Icon n="clock" s /><span>{k.status === "unavailable" ? "فروشنده الان نمی‌تواند پاسخ بدهد؛ چند دقیقه صبر کنید." : "فروشنده جواب نداد؛ مستقیم سراغ فروشگاه بروید."}</span></div>;
  }
  if (k.kind === "hold") {
    if (waiting) return <div className="kid"><span className="spin" /><span>درخواست «تا ساعت {fa(k.hold_until ?? "")} نگه دارید» فرستاده شد…</span></div>;
    if (a?.hold_accepted) return (
      <div className="kid" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}>
        <Icon n="hold" s /><span className="grow">تا ساعت {fa(a.hold_until ?? k.hold_until ?? "")} برایتان نگه می‌دارد. در فروشگاه این کد را بگویید:</span>
        <span className="code num">{fa(a.hold_code ?? "")}</span>
      </div>
    );
    return <div className="kid"><Icon n="hold" s /><span>{k.status === "no_reply" ? "به درخواست نگه‌داشتن جواب نداد." : "نمی‌تواند نگه دارد."}{a?.available ? " ولی گفت هنوز موجود است." : ""}</span></div>;
  }
  if (waiting) return <div className="kid"><span className="spin" /><span>دوباره پرسیدیم «هنوز موجود است؟»{k.eta_min ? ` · رسیدن حدود ${fa(k.eta_min)} دقیقه` : ""}</span></div>;
  if (k.status === "answered") return <div className="kid" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}><Icon n="check" s /><span>ساعت {clock(k.answered_at!)} دوباره تأیید کرد: هنوز موجود است{a?.price ? ` · ${money(a.price)} تومان` : ""}.</span></div>;
  if (k.status === "unavailable") return <div className="kid" style={{ background: "var(--bad-soft)", color: "var(--bad)" }}><Icon n="x" s /><span>همین الان گفت دیگر موجود نیست. جایگزین‌ها را ببینید.</span></div>;
  return <div className="kid"><Icon n="clock" s /><span>به سؤال دوباره جواب نداد؛ قبل از رفتن احتیاط کنید.</span></div>;
}

/** Times to ask a shop to hold the item until: the next half hours, up to its closing time. */
export function HoldPicker({ closes, onPick, pending }: { closes?: string | null; onPick: (hhmm: string) => void; pending: boolean }) {
  const now = new Date();
  const [h, m] = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" }).split(":").map(Number);
  const close = closes ? Number(closes.slice(0, 2)) * 60 + Number(closes.slice(3, 5)) : 22 * 60;
  const opts: string[] = [];
  for (let t = Math.ceil((h * 60 + m + 45) / 30) * 30; t <= Math.min(close, 23 * 60 + 30) && opts.length < 6; t += 30)
    opts.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  const [sel, setSel] = useState<string | null>(null);
  const pick = sel ?? opts[1] ?? opts[0] ?? null;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <h2>تا چه ساعتی نگه دارند؟</h2>
      <p className="lede" style={{ marginTop: -6 }}>از فروشنده می‌خواهیم یکی را برایتان کنار بگذارد. اگر قبول کند، یک کد چهاررقمی می‌گیرید.</p>
      {opts.length ? (
        <div className="wrapr">{opts.map((o) => <button key={o} type="button" className={`chip ${pick === o ? "on" : ""}`} style={{ minHeight: 44 }} onClick={() => setSel(o)}>{fa(o)}</button>)}</div>
      ) : <Note tone="warn" icon="clock">فروشگاه به‌زودی می‌بندد؛ وقت کافی برای نگه‌داشتن نیست.</Note>}
      <button className="btn pri block" disabled={!pick || pending} onClick={() => pick && onPick(pick)}>{pending ? <span className="spin" /> : <Icon n="hold" s />}درخواست نگه‌داشتن تا {fa(pick ?? "")}</button>
    </div>
  );
}

/** For a shop that doesn't answer in the app: a short script to read on the phone, then the shopper records what they heard. */
export function CallScript({ q, sid, onDone }: { q: Inquiry; sid: string; onDone: () => void }) {
  const shop = useQuery({ queryKey: ["shop", q.shop?.shop_id], queryFn: () => api.shop(q.shop!.shop_id, null), enabled: !!q.shop });
  const [avail, setAvail] = useState<boolean | null>(null);
  const [price, setPrice] = useState("");
  const send = useMutation({
    mutationFn: () => api.report({ session_id: sid, shop_id: q.shop!.shop_id, product_id: q.product!.product_id, kind: "call", available: avail, price: price ? parseNum(price) : null, inquiry_id: q.id }),
    onSuccess: onDone,
  });
  const phone = shop.data?.phone;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <h2>تماس با {q.shop?.name}</h2>
      <div className="card" style={{ padding: 12, background: "var(--sunk)" }}>
        <div className="xs faint" style={{ marginBottom: 6 }}>متن پیشنهادی (۲۰ ثانیه)</div>
        <div className="sm" style={{ lineHeight: 1.9 }}>
          سلام، وقت بخیر. «<Bidi text={q.product?.title} />» را دارید؟{" "}
          {q.questions.filter((x) => x.key !== "stock").map((x) => x.text).join(" ")}{" "}
          تا ساعت چند باز هستید؟
        </div>
      </div>
      {phone ? (
        <>
          <a className="btn sec block" href={`tel:${phone.replace(/[^\d+]/g, "")}`}><Icon n="phone" s />تماس با <bdi dir="ltr">{fa(phone)}</bdi></a>
          <Note tone="unk" icon="alert">در دادهٔ این مسابقه شماره‌ها ساختگی‌اند؛ در نسخهٔ واقعی همین دکمه تماس می‌گیرد.</Note>
        </>
      ) : <Note tone="unk" icon="phone">شماره‌ای برای این فروشگاه ثبت نشده؛ حضوری یا از راه استعلام بپرسید.</Note>}
      <div className="h4">چه شنیدید؟ <span className="n">برای بقیهٔ خریدارها هم ثبت می‌شود</span></div>
      <Seg label="موجود بود؟" value={avail} onChange={setAvail} options={[[true, "موجود است"], [false, "ندارد"]]} />
      {avail && <div className="field"><input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="قیمتی که گفت (اختیاری)" /><span className="xs faint">تومان</span></div>}
      {send.isError && <Note tone="bad" icon="alert">{(send.error as Error).message}</Note>}
      <button className="btn pri block" disabled={avail === null || send.isPending} onClick={() => send.mutate()}>{send.isPending ? <span className="spin" /> : <Icon n="check" s />}ثبت نتیجهٔ تماس</button>
    </div>
  );
}

/** After the visit: did the shop really have it at that price? Closes the loop and feeds the shop's reliability. */
export function VisitReport({ q, sid, onDone }: { q: Inquiry; sid: string; onDone: () => void }) {
  const [found, setFound] = useState<boolean | null>(null);
  const [same, setSame] = useState<boolean | null>(q.answer?.price ? null : true);
  const [price, setPrice] = useState("");
  const send = useMutation({
    mutationFn: () => api.report({ session_id: sid, shop_id: q.shop!.shop_id, product_id: q.product!.product_id, kind: "visit", available: found,
      price_matched: found ? same : null, price: found && same === false && price ? parseNum(price) : null, inquiry_id: q.id }),
    onSuccess: onDone,
  });
  return (
    <div className="stack" style={{ gap: 12 }}>
      <h2>رفتید {q.shop?.name}؟</h2>
      <p className="lede" style={{ marginTop: -6 }}>جواب شما به بقیهٔ خریدارها نشان می‌دهد این فروشگاه چقدر درست می‌گوید.</p>
      <span className="b sm">کالا موجود بود؟</span>
      <Seg label="موجود بود؟" value={found} onChange={setFound} options={[[true, "بله، بود"], [false, "نه، نبود"]]} />
      {found && q.answer?.price ? (
        <>
          <span className="b sm">همان {money(q.answer.price)} تومان بود؟</span>
          <Seg label="همان قیمت؟" value={same} onChange={setSame} options={[[true, "همان قیمت"], [false, "فرق داشت"]]} />
          {same === false && <div className="field"><input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="قیمت واقعی" /><span className="xs faint">تومان</span></div>}
        </>
      ) : null}
      <button className="btn pri block" disabled={found === null || send.isPending} onClick={() => send.mutate()}>{send.isPending ? <span className="spin" /> : <Icon n="check" s />}ثبت</button>
    </div>
  );
}

/** "Ask in waves" progress: who is being asked now, who is next and why. */
export function CampaignBanner({ c, onStop, stopping }: { c: Campaign; onStop: () => void; stopping: boolean }) {
  const total = c.asked + c.queued || 1;
  const head = c.status === "done" ? `${fa(c.confirmed)} فروشگاه تأیید کرد؛ بقیه را نپرسیدیم.`
    : c.status === "exhausted" ? "همهٔ گزینه‌های صف پرسیده شدند."
    : c.status === "stopped" ? "پرسیدن موجی متوقف شد."
    : c.tomorrow ? "همهٔ فروشگاه‌های مناسب الان بسته‌اند؛ دربارهٔ فردا می‌پرسیم."
    : `موج‌به‌موج می‌پرسیم: هم‌زمان ${fa(c.wave)} فروشگاه، تا ${fa(c.target)} نفر تأیید کند.`;
  return (
    <div className="camp" role="status">
      <div className="row" style={{ gap: 8 }}><Icon n="spark" s /><b className="sm grow">{head}</b>
        {c.status === "running" && c.queued > 0 && <button className="btn ghost" style={{ minHeight: 32, padding: "0 10px" }} disabled={stopping} onClick={onStop}>توقف</button>}</div>
      <div className="bar" aria-hidden="true">
        <i style={{ width: `${(c.confirmed / total) * 100}%`, background: "var(--ok)" }} />
        <i style={{ width: `${(c.failed / total) * 100}%`, background: "var(--bad)" }} />
        <i style={{ width: `${(c.waiting / total) * 100}%`, background: "var(--info)" }} />
      </div>
      <div className="xs">{fa(c.asked)} پرسیده‌شده · {fa(c.waiting)} در انتظار · {fa(c.queued)} در صف{c.skipped_closed ? ` · ${fa(c.skipped_closed)} فروشگاهِ بسته را نپرسیدیم` : ""}</div>
      {c.status === "running" && c.next.length > 0 && <div className="xs">بعدی: {c.next.map((n) => `${n.name} (${n.why})`).join(" · ")}</div>}
    </div>
  );
}

/** Get told when a seller answers: browser notification (this device) and/or a Bale message. */
export function NotifyOptIn({ sid }: { sid: string }) {
  const [perm, setPerm] = useState<string>("default");
  const [mounted, setMounted] = useState(false); // the server render has no Notification API: draw nothing until the client has looked
  // Read after mount: the server render has no Notification API, so this cannot be initial state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); if (typeof Notification !== "undefined") setPerm(Notification.permission); }, []);
  const bale = useQuery({ queryKey: ["bale-follow", sid], queryFn: () => api.baleFollow(sid), enabled: !!sid, staleTime: 60_000 });
  const [copied, setCopied] = useState(false);
  const canBrowser = mounted && typeof Notification !== "undefined" && perm !== "granted" && perm !== "denied";
  if (!mounted || (!canBrowser && !(bale.data?.enabled && !bale.data.linked))) return null;
  return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="row" style={{ gap: 8 }}><Icon n="bell" s /><b className="sm grow">لازم نیست صفحه را باز نگه دارید</b></div>
      {canBrowser && <button className="btn sec" style={{ minHeight: 40 }} onClick={() => Notification.requestPermission().then(setPerm)}>خبرم کن وقتی جواب آمد</button>}
      {bale.data?.enabled && !bale.data.linked && (
        <>
          <span className="xs muted">یا جواب‌ها را در «بله» بگیرید: {bale.data.bot_username ? <>ربات <bdi dir="ltr">@{bale.data.bot_username}</bdi> را باز کنید و</> : "در ربات"} این را بفرستید:</span>
          <code dir="ltr" style={{ fontSize: 12, wordBreak: "break-all", padding: 8, borderRadius: 8, background: "var(--sunk)" }}>{bale.data.command}</code>
          <button className="btn ghost" style={{ minHeight: 36 }} onClick={() => navigator.clipboard?.writeText(bale.data!.command ?? "").then(() => setCopied(true)).catch(() => {})}><Icon n="copy" s />{copied ? "کپی شد" : "کپی دستور"}</button>
        </>
      )}
    </div>
  );
}
