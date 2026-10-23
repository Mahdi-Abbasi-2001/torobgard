"use client";
// Sheets of the confirm stage: what the seller said (canvas F6) and "hold it for me" (F7).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fa, money, parseNum } from "@/lib/fa";
import { useSession } from "@/lib/session";
import type { ShopProgress } from "@/lib/useMissionStatus";
import { Icon } from "@/components/Icon";
import { AnswerDetails, Conversation, HoldPicker } from "@/components/followup";
import { isWaiting } from "@/components/inquiry";
import { Bidi, Note, Sheet } from "@/components/ui";

export function ChatSheet({ item, onClose }: { item: ShopProgress | null; onClose: () => void }) {
  const q = item?.q, a = q?.answer;
  const facts: [string, string, "ok" | "bad" | "unk"][] = a ? [
    ["موجودی", a.available === true ? "موجود" : a.available === false ? "ناموجود" : "روشن نیست", a.available === true ? "ok" : a.available === false ? "bad" : "unk"],
    ["قیمت", a.price ? `${money(a.price)} تومان` : "نگفت", a.price ? "ok" : "unk"],
    ["اصالت", a.original === true ? "اصل" : a.original === false ? "اصل نیست" : "نگفت", a.original === true ? "ok" : a.original === false ? "bad" : "unk"],
    ["گارانتی", a.warranty ? fa(a.warranty) : "نگفت", a.warranty ? "ok" : "unk"],
  ] : [];
  return (
    <Sheet open={!!item} onClose={onClose} label="گفتگو با فروشنده" className="tall">
      <div className="row between"><div><div className="mc-label">گفتگو با فروشنده</div><div className="b" style={{ fontSize: 17 }}>{q?.shop?.name}</div></div>
        <button className="iconbtn soft" onClick={onClose} aria-label="بستن"><Icon n="x" /></button></div>
      {a && (
        <div className="mc-card" style={{ padding: 12 }}>
          <div className="mc-label">از جواب فروشنده این‌ها را فهمیدیم</div>
          <div className="facts">{facts.map(([k, v, t]) => <div key={k} className={`fact ${t}`}><span className="xs">{k}</span><b>{v}</b></div>)}</div>
          <AnswerDetails q={q!} />
          <span className="xs muted">این تأیید روی کارت این فروشگاه برای همهٔ کاربران دیده می‌شود و تا ۲ ساعت تازه حساب می‌شود.</span>
        </div>
      )}
      {q && <Conversation q={q} open />}
      {q?.answer?.simulated && <Note tone="info" icon="spark">این گفتگو نمایشی است؛ فروشندهٔ نمایشی مثل آدم واقعی می‌نویسد.</Note>}
    </Sheet>
  );
}

export function HoldSheet({ item, onClose, onGo }: { item: ShopProgress | null; onClose: () => void; onGo: () => void }) {
  const { sid } = useSession();
  const qc = useQueryClient();
  const hold = useMutation({ mutationFn: (until: string) => api.hold(sid, item!.q.id, until), onSuccess: () => qc.invalidateQueries({ queryKey: ["inquiries", sid] }) });
  const kid = item ? [...item.kids].filter((k) => k.kind === "hold").sort((x, y) => (y.created_at > x.created_at ? 1 : -1))[0] : undefined;
  const accepted = !!item?.hold;
  const waiting = !!kid && isWaiting(kid);
  const declined = !!kid && !waiting && !accepted;
  return (
    <Sheet open={!!item} onClose={onClose} label="نگه‌داشتن">
      <div className="row between"><div><div className="mc-label">برایم نگه دارید</div><div className="b" style={{ fontSize: 17 }}>{item?.q.shop?.name}</div>
        {item?.q.answer?.price ? (item.deal && item.deal < item.q.answer.price
          ? <div className="xs faint">به قیمتی که توافق شد: {money(item.deal)} تومان <s>{money(item.q.answer.price)}</s></div>
          : <div className="xs faint">به قیمت {money(item.q.answer.price)} تومان</div>) : null}</div>
        <button className="iconbtn soft" onClick={onClose} aria-label="بستن"><Icon n="x" /></button></div>
      {accepted && item?.hold ? (
        <div className="stack" style={{ gap: 12 }}>
          <div className="hold-code">
            <span className="xs">فروشنده قبول کرد{item.hold.until ? `، تا ${fa(item.hold.until)} نگه می‌دارد` : ""}</span>
            <b className="num">{fa(item.hold.code)}</b>
            <span className="xs">این کد را به فروشنده نشان دهید</span>
          </div>
          <button className="btn pri block" onClick={onGo}>شروع مسیر</button>
        </div>
      ) : waiting ? (
        <div className="hold-wait"><span className="spin" />منتظر جواب فروشنده…</div>
      ) : (
        <>
          {declined && <Note tone="warn" icon="alert">{kid?.status === "no_reply" ? "فروشنده به درخواست نگه‌داشتن جواب نداد." : "فروشنده نمی‌تواند نگه دارد."} زمان دیگری را امتحان کنید یا مستقیم بروید.</Note>}
          <HoldPicker closes={item?.q.answer?.closes_at} pending={hold.isPending} onPick={(u) => hold.mutate(u)} />
          {hold.isError && <Note tone="bad" icon="alert">{(hold.error as Error).message}</Note>}
        </>
      )}
    </Sheet>
  );
}

/** Ask for a better price (the negotiator). Nothing is sent until the shopper presses the button: they see the message, set the number, and
 *  choose which shops get it. Only shops that already confirmed the item are asked; a price counts only when the shop itself says yes. */
export function NegotiateSheet({ open, onClose, items, title }: { open: boolean; onClose: () => void; items: ShopProgress[]; title: string }) {
  const { sid } = useSession();
  const qc = useQueryClient();
  const confirmed = useMemo(() => items.filter((x) => x.ripeness === 3 && x.q.answer?.price).sort((a, b) => a.q.answer!.price! - b.q.answer!.price!), [items]);
  const best = confirmed[0]?.q.answer?.price ?? 0;
  const [text, setText] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null);
  const target = text != null ? parseNum(text) ?? 0 : Math.round((best * 0.92) / 10_000) * 10_000;
  const eligible = confirmed.filter((x) => x.q.answer!.price! > target);
  const chosen = (picked ?? eligible.slice(0, 3).map((x) => x.q.id)).filter((id) => eligible.some((x) => x.q.id === id));
  const send = useMutation({
    mutationFn: async () => { for (const id of chosen) await api.bargain(sid, id, target); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inquiries", sid] }); onClose(); },
  });
  const toggle = (id: string) => setPicked(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  return (
    <Sheet open={open} onClose={onClose} label="قیمت بهتر بگیر" className="tall">
      <div className="row between"><div><div className="mc-label">قیمت بهتر بگیر</div><div className="b" style={{ fontSize: 17 }}>پیشنهاد شما به فروشنده‌ها</div></div>
        <button className="iconbtn soft" onClick={onClose} aria-label="بستن"><Icon n="x" /></button></div>
      {confirmed.length === 0 ? <Note tone="unk" icon="q">هنوز فروشگاهی قیمت را تأیید نکرده؛ بعد از اولین تأیید می‌شود پیشنهاد داد.</Note> : (
        <>
          <div className="field" style={{ minHeight: 52 }}><label htmlFor="bg-t" className="sr">قیمتی که می‌خواهید</label>
            <input id="bg-t" inputMode="numeric" value={text ?? (target ? money(target) : "")} onChange={(e) => setText(e.target.value)} style={{ fontWeight: 800, fontSize: 18 }} /><span className="xs faint">تومان</span></div>
          <span className="xs muted">ارزان‌ترین قیمت تأییدشده الان {money(best)} تومان است.</span>
          <div className="stack" style={{ gap: 6 }}>
            {confirmed.map((x) => {
              const ok = x.q.answer!.price! > target, on = chosen.includes(x.q.id);
              return (
                <button key={x.q.id} type="button" className={`card row between ${on ? "pickon" : ""}`} style={{ padding: "10px 14px", opacity: ok ? 1 : 0.5, textAlign: "start" }} disabled={!ok} aria-pressed={on} onClick={() => toggle(x.q.id)}>
                  <span className="sm b"><Bidi text={x.q.shop?.name ?? ""} /></span>
                  <span className="row" style={{ gap: 8 }}><span className="sm">{money(x.q.answer!.price!)}</span>{ok ? <Icon n={on ? "check" : "plus"} s /> : <span className="xs faint">زیر پیشنهاد شماست</span>}</span>
                </button>
              );
            })}
          </div>
          <div className="mc-card" style={{ padding: 12, gap: 6 }}>
            <div className="mc-label">این پیام فرستاده می‌شود</div>
            <div className="sm" style={{ lineHeight: 1.9 }}>«سلام دوباره. مشتری «{title}» می‌خواهد همین الان بیاید و حضوری بخرد؛ اگر {money(target)} تومان بدهد، می‌فروشید؟ اگر نه، پایین‌ترین قیمتتان برای او چقدر است؟»</div>
          </div>
          <button type="button" className="btn pri block" disabled={!chosen.length || !target || send.isPending} onClick={() => send.mutate()}>{send.isPending ? <span className="spin" style={{ borderTopColor: "var(--on-accent)" }} /> : <Icon n="send" s />}پیشنهاد را بفرست به {fa(chosen.length)} فروشگاه</button>
          {send.isError && <Note tone="bad" icon="alert">{(send.error as Error).message}</Note>}
          <span className="xs faint">پیشنهاد فقط به فروشگاه‌هایی می‌رود که قبلاً موجود بودن را تأیید کرده‌اند، و تأییدشان سر جایش می‌ماند. قیمت جدید فقط وقتی حساب می‌شود که خود فروشنده قبول کند.</span>
        </>
      )}
    </Sheet>
  );
}
