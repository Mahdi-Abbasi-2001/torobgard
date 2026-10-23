"use client";
// "Ask Torob-Gard" (canvas S9): the streaming assistant as a side door. Its answers come as actions on the mission («add to the
// duel», «see specs»), not as a chat thread you have to live in.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { streamChat, type Block } from "@/lib/chat";
import { fa, mil } from "@/lib/fa";
import { useAddItem, useMissions, type Mission } from "@/lib/mission";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { ShopCard } from "@/components/cards";
import { ReviewCardView } from "@/components/ReviewCard";
import { WhereToLookCard } from "@/components/WhereToLook";
import { Bidi, Sheet, Thumb } from "@/components/ui";
import { slotSummary } from "./slots";

type Msg = { me: boolean; text: string; blocks: Block[]; err?: string; changes?: string[] };
const SUGGEST = ["اگر فردا بروم، چه فرقی می‌کند؟", "قسطی کجا می‌دهد؟", "در مغازه چه چیزی را چک کنم؟"];

/** The errand as plain words, so the assistant answers about this errand and not a fresh topic. */
const contextOf = (m: Mission) => [
  `کالا: ${m.product?.title ?? m.query}`, m.need && `برای: ${m.need}`, m.category && `دسته: ${m.category}`,
  (m.budgetMin || m.budgetMax) && `بودجه: ${m.budgetMin ? `از ${mil(m.budgetMin)} ` : ""}${m.budgetMax ? `تا ${mil(m.budgetMax)} ` : ""}میلیون تومان`.replace(/\s+/g, " "),
  `شروع از: ${m.place.label}`,
].filter(Boolean).join("\n");

export function AgentSheet({ open, onClose, mission, initialQ = "" }: { open: boolean; onClose: () => void; mission: Mission; initialQ?: string }) {
  const { sid } = useSession();
  const { patch } = useMissions();
  const addItem = useAddItem();
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>(() => mission.chat.map((l) => ({ ...l, blocks: [] })));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const sentInitial = useRef("");
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, status, open]);
  // the conversation stays with the mission, so it is there when the sheet is opened again
  useEffect(() => { if (!busy) patch(mission.id, { chat: msgs.filter((m) => m.text || m.changes?.length).map(({ me, text, changes }) => ({ me, text, ...(changes?.length && { changes }) })).slice(-40) }); }, [busy, msgs]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchLast = (fn: (m: Msg) => Msg) => setMsgs((all) => all.map((m, i) => (i === all.length - 1 ? fn(m) : m)));
  // what the shopper just said goes straight into the errand: the slots change, and a changed item or need restarts the model choice
  const applyUpdate = (b: Extract<Block, { type: "mission_update" }>) => {
    const p = b.patch;
    patch(mission.id, (m) => ({
      ...(p.need && { need: p.need, presetId: null }), ...(p.query && { query: p.query, category: null }),
      ...((p.need || p.query) && { champion: null, beaten: [], productId: p.query ? null : m.productId, product: p.query ? null : m.product }),
      ...(p.budget && { budgetMin: p.budget.min, budgetMax: p.budget.max }),
      ...(p.place && { place: { ...p.place, source: "area" as const } }), ...(p.when && { when: p.when }), ...(p.mode && { mode: p.mode }),
      ...((p.installment || p.open_only) && { cond: { ...m.cond, installment: p.installment || m.cond.installment, open: p.open_only || m.cond.open } }),
    }));
    p.add_items?.forEach((x) => addItem(mission, { query: x.query }));
    patchLast((m) => ({ ...m, changes: [...(m.changes ?? []), ...b.labels] }));
    if (p.query && mission.productId) { onClose(); router.push(`/m/${mission.id}?s=decide`); } // the model chosen no longer fits the narrower item
  };
  const send = async (t: string) => {
    const q = t.trim(); if (!q || busy || !sid) return;
    setText(""); setBusy(true); setStatus(null);
    setMsgs((m) => [...m, { me: true, text: q, blocks: [] }, { me: false, text: "", blocks: [] }]);
    try {
      await streamChat(sid, q, (e) => {
        if (e.type === "text") patchLast((m) => ({ ...m, text: m.text + e.delta }));
        else if (e.type === "tool_status") setStatus(e.text);
        else if (e.type === "block" && e.block.type === "mission_update") applyUpdate(e.block);
        else if (e.type === "block") { setStatus(null); patchLast((m) => ({ ...m, blocks: [...m.blocks, e.block] })); }
        else if (e.type === "error") patchLast((m) => ({ ...m, err: e.message }));
      }, undefined, contextOf(mission));
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
        {mission.text && <div className="msg me">{mission.text}</div>}
        <div className="msg ai">{mission.brief ? <>{fa(mission.brief)} سفر را همین‌طور ساختم: <span className="muted">{slotSummary(mission)}</span>. </> : <>این سفر را برای «<Bidi text={mission.query} />» ساختم. </>}هر چیزی را بگویید در همین سفر عوض می‌کنم و اینجا می‌نویسم چه کردم.</div>
        {!msgs.length && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="wrapr">{SUGGEST.map((s) => <button key={s} type="button" className="chip" onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => m.me ? <div key={i} className="msg me">{m.text}</div> : (
          <div key={i} className="stack" style={{ gap: 8 }}>
            {m.text && <div className="msg ai" style={{ whiteSpace: "pre-wrap" }}>{m.text.replace(/\*\*|__|^#+\s*/gm, "")}</div>}
            {m.changes && m.changes.length > 0 && <div className="note ok"><Icon n="check" s /><span><b>در سفر شما عوض شد:</b> {m.changes.join("، ")}</span></div>}
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
  if (b.type === "mission_update") return <div className="note ok"><Icon n="check" s /><span><b>به سفر شما اضافه شد:</b> {b.labels.join("، ")}</span></div>;
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
