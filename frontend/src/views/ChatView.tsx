"use client";
// Chat helper: streams the agent (/api/chat). Tokens arrive as text; tool results arrive as typed blocks that
// render with the same components as the rest of the app. If the backend reports the LLM unavailable it falls
// back to rule-based search and shows the «جستجوی ساده» banner.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fa, mil } from "@/lib/fa";
import { streamChat, type Block } from "@/lib/chat";
import { useSession } from "@/lib/session";
import { useNow } from "@/lib/useInquiries";
import { Icon } from "@/components/Icon";
import { ProductCard, ShopCard } from "@/components/cards";
import { InquiryCard } from "@/components/inquiry";
import { AppBar, Bidi, BottomNav } from "@/components/ui";

type Msg = { me: boolean; text: string; blocks: Block[]; err?: string };

export default function ChatView({ initial }: { initial?: string }) {
  const { sid, ready } = useSession();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, status]);

  const patchLast = (fn: (m: Msg) => Msg) => setMsgs((all) => all.map((m, i) => (i === all.length - 1 ? fn(m) : m)));

  const send = async (t: string) => {
    const q = t.trim(); if (!q || busy || !sid) return;
    setText(""); setBusy(true); setStatus(null);
    setMsgs((m) => [...m, { me: true, text: q, blocks: [] }, { me: false, text: "", blocks: [] }]);
    try {
      await streamChat(sid, q, (e) => {
        if (e.type === "text") patchLast((m) => ({ ...m, text: m.text + e.delta }));
        else if (e.type === "tool_status") setStatus(e.text);
        else if (e.type === "block") { setStatus(null); patchLast((m) => ({ ...m, blocks: [...m.blocks, e.block] })); }
        else if (e.type === "degraded") setDegraded(true);
        else if (e.type === "error") patchLast((m) => ({ ...m, err: e.message }));
      });
    } catch (e) {
      patchLast((m) => ({ ...m, err: (e as Error).message }));
    } finally { setBusy(false); setStatus(null); }
  };
  const started = useRef(false); // effects run twice in dev; send the opening message once
  useEffect(() => { if (initial && ready && sid && !started.current) { started.current = true; send(initial); } }, [ready, sid]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="main" style={{ paddingBottom: 150 }}>
      <AppBar title="دستیار خرید" back="/" />
      {degraded && <div className="banner warn"><Icon n="alert" s /><span><b>دستیار هوشمند الان در دسترس نیست.</b> جستجوی ساده فعال است؛ بودجه و نام کالا را از متن شما برمی‌داریم و فیلترها همه کار می‌کنند.</span></div>}
      <div className="pad stack" style={{ gap: 12, paddingTop: 12 }}>
        {!msgs.length && <div className="msg ai">سلام! بگویید چه می‌خواهید و تا چقدر؛ مثلاً «هندزفری گردنی برای ورزش زیر ۳ میلیون».</div>}
        {msgs.map((m, i) => m.me ? <div key={i} className="msg me">{m.text}</div> : (
          <div key={i} className="stack" style={{ gap: 8 }}>
            {m.text && <div className="msg ai" style={{ whiteSpace: "pre-wrap" }}>{m.text.replace(/\*\*|__|^#+\s*/gm, "")}</div>}
            {m.blocks.map((b, j) => <BlockView key={j} b={b} onPick={send} />)}
            {m.err && <div className="note bad"><Icon n="alert" s /><span>{m.err}</span></div>}
          </div>
        ))}
        {busy && <div className="toolline"><span className="spin" />{status ?? "در حال فکر کردن…"}</div>}
        <div ref={end} />
      </div>
      <form className="composer" style={{ bottom: "calc(62px + env(safe-area-inset-bottom, 0px))" }} onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <div className="field grow" style={{ minHeight: 46 }}>
          <label htmlFor="msg" className="sr">پیام</label>
          <input id="msg" value={text} onChange={(e) => setText(e.target.value)} placeholder="بنویسید چه می‌خواهید…" enterKeyHint="send" maxLength={600} />
        </div>
        <button className="iconbtn" style={{ background: "var(--accent)", color: "var(--on-accent)" }} aria-label="ارسال" disabled={busy}><Icon n="send" /></button>
      </form>
      <BottomNav />
    </main>
  );
}

function BlockView({ b, onPick }: { b: Block; onPick: (t: string) => void }) {
  const router = useRouter();
  const { setPicks } = useSession();
  const now = useNow(30_000);
  if (b.type === "product_cards") return (
    <div className="stack" style={{ gap: 8 }}>
      {b.title && <div className="h4">{b.title}</div>}
      {b.applied.price_max ? <div className="wrapr"><span className="chip on">بودجه: تا {mil(b.applied.price_max)}</span></div> : null}
      {b.items.map((p) => <ProductCard key={p.product_id} p={p} />)}
      {b.query && b.total > b.items.length && <Link className="btn sec block" href={`/search?q=${encodeURIComponent(b.query)}`}>همهٔ نتایج ({fa(b.total)})</Link>}
    </div>
  );
  if (b.type === "chips") return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, alignSelf: "flex-end" }}>
      <span className="sm b">{b.question}</span>
      <div className="wrapr">{b.options.map((o) => <button key={o} type="button" className="chip" onClick={() => onPick(o)}>{o}</button>)}</div>
    </div>
  );
  if (b.type === "comparison_table") {
    const ids = b.products.map((p) => p.product_id).join(",");
    return (
      <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="h4">مقایسهٔ مدل‌ها</div>
        {b.rows.filter((r) => r.differs).slice(0, 5).map((r) => (
          <div key={r.key} className="xs" style={{ display: "grid", gridTemplateColumns: `90px repeat(${b.products.length}, 1fr)`, gap: 6 }}>
            <span className="faint">{r.key}</span>{r.values.map((v, i) => <span key={i}>{v ? <Bidi text={v} /> : <span className="unknown">نامشخص</span>}</span>)}
          </div>
        ))}
        <Link className="btn sec block" href={`/compare?ids=${ids}`}>مقایسهٔ کامل</Link>
      </div>
    );
  }
  if (b.type === "shop_list") return (
    <div className="stack" style={{ gap: 8 }}>
      {b.product && <Link href={`/p/${b.product.product_id}`} className="xs row" style={{ gap: 6, color: "var(--ink-3)" }}><Icon n="store" s />فروشگاه‌ها برای: <b style={{ color: "var(--ink)" }}><Bidi text={b.product.title} /></b></Link>}
      {b.listed.map((s) => <ShopCard key={s.shop_id} s={s} />)}
      {!b.listed.length && b.counts.category_only > 0 && <div className="note unk"><Icon n="q" s /><span>هیچ فروشگاهی این کالا را ثبت نکرده؛ {fa(b.counts.category_only)} فروشگاه در این دسته هست و باید بپرسید.</span></div>}
      {b.product && <Link className="btn sec block" href={`/p/${b.product.product_id}/shops`}>همهٔ فروشگاه‌ها و نقشه ({fa(b.counts.listed + b.counts.category_only)})</Link>}
    </div>
  );
  if (b.type === "inquiry_proposal") return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="h4">استعلام از {fa(b.shops.length)} فروشگاه</div>
      <div className="xs muted">{b.questions.map((q) => q.text).join(" · ")}</div>
      {b.shops.map((s) => <div key={s.shop_id} className="sm">{s.name}<span className="xs faint"> · {[s.mall, s.floor_label, s.unit && `واحد ${fa(s.unit)}`].filter(Boolean).join(" ← ")}</span></div>)}
      <div className="xs faint">چیزی فرستاده نشده؛ با دکمهٔ زیر بازبینی و ارسال کنید.</div>
      {b.product && <button type="button" className="btn pri block" onClick={() => { setPicks(b.product!.product_id, b.shops.map((s) => s.shop_id)); router.push(`/p/${b.product!.product_id}/ask`); }}>بازبینی و ارسال استعلام</button>}
    </div>
  );
  if (b.type === "inquiry_status") return (
    <div className="stack" style={{ gap: 8 }}>
      {b.items.slice(0, 3).map((i) => <InquiryCard key={i.id} q={i} now={now} />)}
      <Link className="btn sec block" href="/track">پیگیری زندهٔ پاسخ‌ها</Link>
    </div>
  );
  return null;
}
