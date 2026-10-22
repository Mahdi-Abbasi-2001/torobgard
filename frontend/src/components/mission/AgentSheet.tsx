"use client";
// "Ask Torob-Gard" (canvas S9): the streaming assistant as a side door. Its answers come as actions on the mission («add to the
// duel», «see specs»), not as a chat thread you have to live in.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { streamChat, type Block } from "@/lib/chat";
import { fa, mil } from "@/lib/fa";
import { useMissions, type Mission } from "@/lib/mission";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { ShopCard } from "@/components/cards";
import { ReviewCardView } from "@/components/ReviewCard";
import { WhereToLookCard } from "@/components/WhereToLook";
import { Bidi, Sheet, Thumb } from "@/components/ui";

type Msg = { me: boolean; text: string; blocks: Block[]; err?: string };
const SUGGEST = ["اگر فردا بروم، چه فرقی می‌کند؟", "قسطی کجا می‌دهد؟", "در مغازه چه چیزی را چک کنم؟"];

export function AgentSheet({ open, onClose, mission, initialQ = "" }: { open: boolean; onClose: () => void; mission: Mission; initialQ?: string }) {
  const { sid } = useSession();
  const { patch } = useMissions();
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const sentInitial = useRef("");
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
        else if (e.type === "error") patchLast((m) => ({ ...m, err: e.message }));
      });
    } catch (e) { patchLast((m) => ({ ...m, err: (e as Error).message })); }
    finally { setBusy(false); setStatus(null); }
  };
  useEffect(() => {
    if (open && initialQ && sentInitial.current !== initialQ) { sentInitial.current = initialQ; send(initialQ); }
    if (!open) sentInitial.current = "";
  }, [open, initialQ]); // eslint-disable-line react-hooks/exhaustive-deps

  const challenge = (id: string) => { patch(mission.id, (m) => ({ extras: [id, ...m.extras.filter((x) => x !== id)] })); onClose(); router.push(`/m/${mission.id}?s=decide`); };

  return (
    <Sheet open={open} onClose={onClose} label="از ترب‌گرد بپرسید" className="agent-sheet">
      <div className="row between"><h2>از ترب‌گرد بپرسید</h2></div>
      <span className="xs faint" style={{ marginTop: -8 }}>سؤال بپرسید؛ جواب‌ها را می‌شود مستقیم به خریدتان اضافه کرد.</span>
      <div className="stack agent-body" style={{ gap: 10 }}>
        {!msgs.length && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="msg ai">سلام! دربارهٔ <b><Bidi text={mission.product?.title ?? mission.query} /></b> چه می‌خواهید بدانید؟</div>
            <div className="wrapr">{SUGGEST.map((s) => <button key={s} type="button" className="chip" onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => m.me ? <div key={i} className="msg me">{m.text}</div> : (
          <div key={i} className="stack" style={{ gap: 8 }}>
            {m.text && <div className="msg ai" style={{ whiteSpace: "pre-wrap" }}>{m.text.replace(/\*\*|__|^#+\s*/gm, "")}</div>}
            {m.blocks.map((b, j) => <Blk key={j} b={b} onPick={send} onChallenge={challenge} />)}
            {m.err && <div className="note bad"><Icon n="alert" s /><span>{m.err}</span></div>}
          </div>
        ))}
        {busy && <div className="toolline"><span className="spin" />{status ?? "در حال فکر کردن…"}</div>}
        <div ref={end} />
      </div>
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <div className="field grow" style={{ minHeight: 48 }}>
          <label htmlFor="agent-q" className="sr">سؤال شما</label>
          <input id="agent-q" value={text} onChange={(e) => setText(e.target.value)} placeholder="بپرسید…" enterKeyHint="send" maxLength={600} />
        </div>
        <button className="iconbtn" style={{ background: "var(--accent)", color: "var(--on-accent)", borderRadius: 14 }} aria-label="ارسال" disabled={busy}><Icon n="send" /></button>
      </form>
    </Sheet>
  );
}

function Blk({ b, onPick, onChallenge }: { b: Block; onPick: (t: string) => void; onChallenge: (id: string) => void }) {
  if (b.type === "product_cards") return (
    <div className="stack" style={{ gap: 8 }}>
      {b.items.slice(0, 4).map((p) => (
        <div key={p.product_id} className="card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="row" style={{ gap: 10 }}>
            <Thumb src={p.image} alt="" size={48} brand={p.brand} />
            <div className="grow"><div className="b sm"><Bidi text={p.title} /></div>
              <div className="xs faint">{p.price_min ? `از ${mil(p.price_min)} تومان، ` : ""}{fa(p.shop_count)} فروشگاه</div></div>
          </div>
          <button type="button" className="btn pri block" style={{ minHeight: 40 }} onClick={() => onChallenge(p.product_id)}>به مقایسه اضافه کن</button>
        </div>
      ))}
    </div>
  );
  if (b.type === "chips") return <div className="wrapr">{b.options.map((o) => <button key={o} type="button" className="chip" onClick={() => onPick(o)}>{o}</button>)}</div>;
  if (b.type === "shop_list") return <div className="stack" style={{ gap: 8 }}>{b.listed.slice(0, 3).map((s) => <ShopCard key={s.shop_id} s={s} />)}</div>;
  if (b.type === "review") return <ReviewCardView r={b} />;
  if (b.type === "location_widget") return <WhereToLookCard data={b} />;
  if (b.type === "comparison_table") return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      {b.rows.filter((r) => r.differs).slice(0, 5).map((r) => (
        <div key={r.key} className="xs" style={{ display: "grid", gridTemplateColumns: `80px repeat(${b.products.length}, 1fr)`, gap: 6 }}>
          <span className="faint">{r.key}</span>{r.values.map((v, i) => <span key={i}>{v ? <Bidi text={v} /> : <span className="unknown">نامشخص</span>}</span>)}
        </div>
      ))}
    </div>
  );
  return null; // asking shops is done by the mission itself
}
