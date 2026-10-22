"use client";
import type { Inquiry } from "@/lib/api";
import { fa, floorLabel, hm, minutesAgo, mmss, money, daysAgo } from "@/lib/fa";
import { Icon } from "./Icon";
import { PriceBadge } from "./honesty";
import { AnswerDetails, Conversation, KidRow } from "./followup";

export const isWaiting = (q: Inquiry) => q.status === "sent" || q.status === "delivered";
export const isFailed = (q: Inquiry) => q.status === "unavailable" || q.status === "no_reply";

export function diffPct(q: Inquiry, listed?: number | null) {
  const p = q.answer?.price;
  return p && listed ? Math.round(((p - listed) / listed) * 100) : null;
}

function Timeline({ status }: { status: Inquiry["status"] }) {
  const idx = status === "sent" ? 0 : status === "delivered" ? 1 : 2;
  const last = status === "unavailable" ? "ناموجود" : status === "no_reply" ? "بی‌پاسخ" : "پاسخ";
  return (
    <div className="tl" aria-label={`وضعیت: ${last}`}>
      <span className="done">ارسال</span><i className={idx >= 1 ? "done" : ""} />
      <span className={idx >= 1 ? "done" : "live"}>دیده شد</span><i className={idx >= 2 ? "done" : ""} />
      <span className={idx >= 2 ? "done" : idx === 1 ? "live" : ""}>{last}</span>
    </div>
  );
}

export interface CardActions {
  onHold?: () => void; onRecheck?: () => void; onReport?: () => void; onCall?: () => void;
}

export function InquiryCard({ q, listed: listedIn, now, flash, onAlternatives, kids = [], actions = {} }: {
  q: Inquiry; listed?: { price: number | null; age_days: number | null } | null; now: number; flash?: boolean; onAlternatives?: () => void;
  kids?: Inquiry[]; actions?: CardActions;
}) {
  const s = q.shop, a = q.answer;
  const left = Math.max(0, Math.round((new Date(q.deadline_at).getTime() - now) / 1000));
  const listed = listedIn ?? (q.listed_price != null ? { price: q.listed_price, age_days: null } : null);
  const pct = diffPct(q, listed?.price);
  const lastRecheck = kids.find((k) => k.kind === "recheck");
  const hold = kids.find((k) => k.kind === "hold");
  const holdOk = hold?.answer?.hold_accepted;
  const goneNow = lastRecheck?.status === "unavailable";
  return (
    <div className={`card shop ${flash ? "flash" : ""}`}>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <div className="shop-name">{s?.name ?? "فروشگاه"}</div>
          <div className="loc">{s?.mall ?? "بدون پاساژ"}<span className="sep">←</span>{floorLabel(s?.floor_label) ?? <span style={{ color: "var(--unk)" }}>طبقه نامشخص</span>}</div>
        </div>
        <span className={`st ${q.status}`}>{q.label}</span>
      </div>
      <Timeline status={q.status} />
      {isWaiting(q) && (
        <>
          <div className="xs muted row" style={{ gap: 6 }}><Icon n="clock" s />{q.status === "sent" ? "منتظر دیده شدن…" : q.awaiting_seller ? "ترب‌گرد سؤال تکمیلی پرسید؛ منتظر جواب…" : "فروشنده پیام را دید؛ منتظر پاسخ…"}<span className="num">مهلت {mmss(left)}</span></div>
          {listed?.price != null && <div className="xs faint">قیمت ثبت‌شده: {money(listed.price)} تومان · {daysAgo(listed.age_days)}</div>}
        </>
      )}
      {q.status === "answered" && a && (
        <>
          <div className="row between" style={{ alignItems: "flex-end" }}>
            {a.price ? <PriceBadge confirmed={{ price: a.price, ago: minutesAgo(q.answered_at, now) }} /> : <span className="confirmed"><Icon n="check" s />موجود است · قیمت را نگفت</span>}
            {pct !== null && pct !== 0 && listed?.price && (
              <div style={{ textAlign: "left" }}>
                <div className="strike num">{money(listed.price)}</div>
                <span className={`diff ${pct < 0 ? "down" : ""}`}>{pct > 0 ? "+" : "−"}{fa(Math.abs(pct))}٪ نسبت به ثبت‌شده</span>
              </div>
            )}
          </div>
          {a.parsed_by && a.summary ? <div className="qa"><span className="xs faint">خلاصهٔ گفتگو: </span>{a.summary}</div> : a.message && <div className="qa">«{a.message}»</div>}
          <div className="wrapr">
            {a.closes_at && <span className="oc open">باز تا {hm(a.closes_at)} (طبق گفتهٔ فروشنده)</span>}
            {a.installment === true && <span className="inst conf"><Icon n="card" s />قسط حضوری: بله</span>}
            {a.installment === false && <span className="feat no"><Icon n="card" s />قسطی ندارد</span>}
          </div>
          <AnswerDetails q={q} />
        </>
      )}
      {q.status === "answered" && a?.available === null && <div className="xs muted">جواب فروشنده روشن نبود؛ متن گفتگو را ببینید.</div>}
      {q.status === "unavailable" && (
        <>
          <div className="qa bad">ناموجود{a?.message ? ` · «${a.message}»` : ""}</div>
          <AnswerDetails q={q} />
          {onAlternatives && <button className="btn sec block" style={{ minHeight: 44 }} onClick={onAlternatives}>جایگزین‌ها را ببینید <Icon n="fwd" s /></button>}
        </>
      )}
      {q.status === "no_reply" && (
        <>
          <div className="xs muted">مهلت پاسخ تمام شد و پاسخی نیامد. شاید فروشنده سرش شلوغ است.</div>
          <div className="actions">
            {onAlternatives && <button className="btn sec" onClick={onAlternatives}>گزینه‌های دیگر <Icon n="fwd" s /></button>}
            {actions.onCall && <button className="btn ghost" onClick={actions.onCall}><Icon n="phone" s />خودم زنگ می‌زنم</button>}
          </div>
        </>
      )}
      {kids.map((k) => <KidRow key={k.id} k={k} />)}
      {goneNow && onAlternatives && <button className="btn sec block" style={{ minHeight: 44 }} onClick={onAlternatives}>جایگزین‌ها را ببینید <Icon n="fwd" s /></button>}
      {q.status === "answered" && a?.available !== false && !goneNow && (actions.onHold || actions.onRecheck || actions.onReport) && (
        <div className="actions">
          {actions.onHold && !holdOk && !(hold && (hold.status === "sent" || hold.status === "delivered")) && <button className="btn sec" onClick={actions.onHold}><Icon n="hold" s />برایم نگه دارید</button>}
          {actions.onRecheck && !(lastRecheck && (lastRecheck.status === "sent" || lastRecheck.status === "delivered")) && <button className="btn sec" onClick={actions.onRecheck}><Icon n="walk" s />راه افتادم؛ دوباره بپرس</button>}
          {actions.onReport && <button className="btn ghost" onClick={actions.onReport}><Icon n="check" s />رفتم؛ نتیجه را بگویم</button>}
        </div>
      )}
      <Conversation q={q} />
    </div>
  );
}

export function Summary({ qs }: { qs: Inquiry[] }) {
  const c = (ks: string[]) => qs.filter((q) => ks.includes(q.status)).length;
  return (
    <div className="sum">
      <div><b style={{ color: "var(--ok)" }}>{fa(c(["answered"]))}</b>پاسخ</div>
      <div><b style={{ color: "var(--bad)" }}>{fa(c(["unavailable"]))}</b>ناموجود</div>
      <div><b style={{ color: "var(--info-ink)" }}>{fa(c(["sent", "delivered"]))}</b>در انتظار</div>
      <div><b style={{ color: "var(--ink-3)" }}>{fa(c(["no_reply"]))}</b>بی‌پاسخ</div>
    </div>
  );
}
