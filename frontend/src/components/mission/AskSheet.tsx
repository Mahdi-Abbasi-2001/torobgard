"use client";
// What to ask and how (canvas S6) and the call that actually asks. Waves is the default: the best two shops first, the next only
// when one says no or stays silent, stop when one confirms. The questions come from the product's own specs.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type ShopCard } from "@/lib/api";
import { fa } from "@/lib/fa";
import type { Mission } from "@/lib/mission";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { Bidi, Note, Sheet, Toggle } from "@/components/ui";

const BASE = ["stock", "price"];

/** Send the mission's questions: in waves (default) or to everyone at once. Resolves when the first inquiries exist. */
export function useAsk(m: Mission) {
  const qc = useQueryClient();
  const { sid } = useSession();
  return useMutation({
    mutationFn: async (o: { shopIds: string[]; keys: string[]; custom: Record<string, string>; mode: "waves" | "direct"; timeout: number; note?: string | null }) => {
      const b = { session_id: sid, product_id: m.productId!, questions: o.keys, custom: o.custom, note: o.note ?? null, timeout_s: o.timeout };
      if (o.mode === "waves") await api.smartInquiries({ ...b, shop_ids: o.shopIds, wave: 2, target: 1, max_shops: Math.max(6, o.shopIds.length) });
      else await api.createInquiries({ ...b, shop_ids: o.shopIds });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inquiries", sid] }); qc.invalidateQueries({ queryKey: ["campaigns", sid] }); },
  });
}

export function AskSheet({ open, onClose, m, shops, onSent, only }: { open: boolean; onClose: () => void; m: Mission; shops: ShopCard[]; onSent: () => void; only?: string | null }) {
  const { sid } = useSession();
  const ask = useAsk(m);
  const [keys, setKeys] = useState<string[] | null>(null);
  const [own, setOwn] = useState("");
  const [mode, setMode] = useState<"waves" | "direct">("waves");
  const [timeout, setTimeoutS] = useState(300);
  const [auto, setAuto] = useState(true);
  const questions = useQuery({ queryKey: ["questions"], queryFn: () => api.questions(), staleTime: Infinity, enabled: open });
  const pq = useQuery({ queryKey: ["pquestions", m.productId], queryFn: () => api.productQuestions(m.productId!), staleTime: Infinity, enabled: open && !!m.productId });
  const custom = pq.data?.custom ?? [];
  const chosen = only ? shops.filter((s) => s.shop_id === only) : shops.filter((s) => m.picks.includes(s.shop_id));
  const catOnly = chosen.some((s) => s.tier === "category_only");
  const active = keys ?? [...(catOnly ? [...BASE, "hours"] : BASE), ...custom.slice(0, 1).map((c) => c.key)];
  const toggle = (k: string) => setKeys(active.includes(k) ? active.filter((x) => x !== k) : [...active, k]);
  const customMap = { ...Object.fromEntries(custom.filter((c) => active.includes(c.key)).map((c) => [c.key, c.text])), ...(own.trim() ? { own: own.trim() } : {}) };
  const keysToSend = own.trim() ? [...active, "own"] : active;

  const send = () => {
    api.putSession(sid, { auto_alternatives: auto }).catch(() => {});
    ask.mutate({ shopIds: chosen.map((s) => s.shop_id), keys: keysToSend, custom: customMap, mode: only ? "direct" : mode, timeout }, { onSuccess: () => { onClose(); onSent(); } });
  };
  const opts = [...(questions.data?.items ?? BASE.map((k) => ({ key: k, text: k }))).filter((x) => x.key !== "tomorrow"), ...custom];
  return (
    <Sheet open={open} onClose={onClose} label="چه بپرسیم؟" className="tall">
      <div className="row between"><h2>چه بپرسیم؟</h2><button className="iconbtn soft" onClick={onClose} aria-label="بستن"><Icon n="x" /></button></div>
      <div className="wrapr">
        {opts.map((x) => {
          const on = active.includes(x.key);
          return <button key={x.key} type="button" className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggle(x.key)}>{on && <Icon n="check" s />}<Bidi text={x.text} /></button>;
        })}
      </div>
      {custom.length > 0 && <span className="xs faint">{custom[0].source === "llm" ? "سؤال‌های مخصوص این کالا از روی مشخصاتش پیشنهاد شده" : "سؤال‌های مخصوص این دسته"}</span>}
      <div className="stack" style={{ gap: 4 }}>
        <label htmlFor="own-q" className="xs muted">سؤال خودتان</label>
        <div className="field" style={{ minHeight: 44 }}><input id="own-q" maxLength={120} value={own} onChange={(e) => setOwn(e.target.value)} placeholder="مثلاً «کاور هم دارید؟»" /></div>
      </div>
      {!only && (
        <>
          <div className="seg" role="radiogroup" aria-label="روش پرسیدن">
            <button role="radio" aria-checked={mode === "waves"} className={mode === "waves" ? "on" : ""} onClick={() => setMode("waves")}>موجی و هوشمند</button>
            <button role="radio" aria-checked={mode === "direct"} className={mode === "direct" ? "on" : ""} onClick={() => setMode("direct")}>{`هم‌زمان از ${fa(chosen.length)} فروشگاه`}</button>
          </div>
          <span className="xs muted">{mode === "waves" ? "اول دو فروشگاهِ اول را می‌پرسیم؛ اگر یکی «ندارم» گفت یا جواب نداد، سراغ بعدی می‌رویم تا یکی تأیید کند. فروشگاه‌های بسته را نمی‌پرسیم." : "همه هم‌زمان پیام می‌گیرند."}</span>
        </>
      )}
      <div className="stack" style={{ gap: 6 }}>
        <span className="b sm">از چه فروشگاه‌هایی؟</span>
        {chosen.map((s) => (
          <div key={s.shop_id} className="row between" style={{ minHeight: 40, padding: "0 12px", borderRadius: 12, background: "var(--sunk)" }}>
            <span className="sm b">{s.name}</span><span className="xs faint">{s.tier === "category_only" ? "فقط هم‌دسته؛ موجودی را می‌پرسیم" : "پیام در ترب‌گرد"}</span>
          </div>
        ))}
        <span className="xs faint">اگر فروشنده‌ای جواب نداد، متن آمادهٔ تماس تلفنی هم هست.</span>
      </div>
      <div className="frow" style={{ borderTop: "1px solid var(--line)" }}>
        <span className="stack" style={{ gap: 0 }}><span className="sm b">اگر نداشتند، خودکار از بعدی‌ها بپرس</span><span className="xs faint">و از فروشنده مشابه بخواه</span></span>
        <Toggle on={auto} onChange={setAuto} label="پرسیدن خودکار از جایگزین‌ها" />
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="b sm">مهلت پاسخ</span>
        <div className="seg" role="radiogroup" aria-label="مهلت پاسخ">
          {([[120, "۲ دقیقه"], [300, "۵ دقیقه"], [900, "۱۵ دقیقه"]] as [number, string][]).map(([v, l]) => <button key={v} role="radio" aria-checked={timeout === v} className={timeout === v ? "on" : ""} onClick={() => setTimeoutS(v)}>{l}</button>)}
        </div>
      </div>
      {ask.isError && <Note tone="bad" icon="alert">{(ask.error as Error).message}</Note>}
      <div className="sheet-foot">
        <button className="btn pri block" disabled={ask.isPending || !chosen.length || !keysToSend.length} onClick={send}>
          {ask.isPending ? <span className="spin" style={{ borderTopColor: "var(--on-accent)" }} /> : <Icon n="spark" s />}بپرس، جواب تا {fa(timeout / 60)} دقیقه
        </button>
      </div>
    </Sheet>
  );
}
