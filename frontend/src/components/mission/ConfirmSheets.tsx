"use client";
// Sheets of the confirm stage: what the seller said (canvas F6) and "hold it for me" (F7).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fa, money } from "@/lib/fa";
import { useSession } from "@/lib/session";
import type { ShopProgress } from "@/lib/useMissionStatus";
import { Icon } from "@/components/Icon";
import { AnswerDetails, Conversation, HoldPicker } from "@/components/followup";
import { isWaiting } from "@/components/inquiry";
import { Note, Sheet } from "@/components/ui";

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
          <div className="mc-label">ترب‌گرد از جواب فروشنده فهمید</div>
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
        {item?.q.answer?.price ? <div className="xs faint">به قیمت {money(item.q.answer.price)} تومان</div> : null}</div>
        <button className="iconbtn soft" onClick={onClose} aria-label="بستن"><Icon n="x" /></button></div>
      {accepted && item?.hold ? (
        <div className="stack" style={{ gap: 12 }}>
          <div className="hold-code">
            <span className="xs">فروشنده قبول کرد{item.hold.until ? `، تا ${fa(item.hold.until)} نگه می‌دارد` : ""}</span>
            <b className="num">{fa(item.hold.code)}</b>
            <span className="xs">این کد را به فروشنده نشان دهید</span>
          </div>
          <button className="btn pri block" onClick={onGo}>مسیر را شروع کن</button>
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
