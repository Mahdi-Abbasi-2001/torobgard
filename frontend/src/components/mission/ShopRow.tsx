"use client";
// One shop in the confirm stage: who it is, what it said, and how far its answer has ripened (listed → asked → confirmed → held).
import type { Inquiry, ShopCard } from "@/lib/api";
import { daysAgo, fa, floorLabel, minutesAgo, mmss, money } from "@/lib/fa";
import type { ShopProgress } from "@/lib/useMissionStatus";
import { Icon } from "@/components/Icon";
import { AnswerDetails, KidRow } from "@/components/followup";
import { diffPct, isFailed, isWaiting } from "@/components/inquiry";
import { Bidi } from "@/components/ui";

export const Ripe = ({ r }: { r: 0 | 1 | 2 | 3 | 4 }) => <div className={`ripe r${r}`} aria-hidden="true"><i /><i /><i /><i /></div>;
export const RipeLegend = () => <div className="ripe-legend" aria-hidden="true"><span>ثبت‌شده</span><span>پرسیده شد</span><span>تأیید شد</span><span>نگه داشته</span></div>;

export function ShopRow({ p, listed, now, flash, onChat, onHold, onAlt, onCall, onRecheck, simple = false }: {
  p: ShopProgress; listed?: ShopCard; now: number; flash?: boolean; simple?: boolean;
  onChat?: () => void; onHold?: () => void; onAlt?: () => void; onCall?: () => void; onRecheck?: () => void;
}) {
  const { q, kids, ripeness: r, gone, hold } = p;
  const a = q.answer, s = q.shop;
  const listedPrice = q.listed_price ?? listed?.offer?.price ?? null;
  const pct = diffPct(q, listedPrice);
  const left = Math.max(0, Math.round((new Date(q.deadline_at).getTime() - now) / 1000));
  const waiting = isWaiting(q), failed = isFailed(q) || gone;
  const lastKid = kids.find((k) => k.kind === "recheck" && (k.status === "sent" || k.status === "delivered"));
  const holdWaiting = kids.some((k) => k.kind === "hold" && isWaiting(k));
  const price = r >= 3 && a?.price ? <span className="price" style={{ fontSize: 16 }}>{money(a.price)}<small>تومان</small></span>
    : waiting ? <span className="price faint" style={{ fontSize: 16 }}>…</span>
    : failed ? <span className="b" style={{ color: "var(--bad)" }}>{q.status === "no_reply" ? "بی‌پاسخ" : "تمام شده"}</span>
    : listedPrice ? <span className="price faint" style={{ fontSize: 15 }}>{money(listedPrice)}</span> : null;
  const sub = r >= 3 ? (a?.price ? `تأیید فروشنده، ${minutesAgo(q.answered_at, now)}${a.simulated ? " (نمایشی)" : ""}` : "موجود است؛ قیمت را نگفت")
    : waiting ? "در حال پرسیدن" : failed ? "تأیید فروشنده" : "";
  return (
    <div className={`card shop shop-row ${flash ? "flash" : ""}`} style={{ opacity: failed && q.status !== "no_reply" ? 0.78 : 1 }}>
      <div className="row between" style={{ alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="b" style={{ fontSize: 15 }}>{s?.name ?? "فروشگاه"}</div>
          <div className="xs muted">{[s?.mall, floorLabel(s?.floor_label), s?.unit && `واحد ${fa(s.unit)}`].filter(Boolean).join("، ") || s?.address}{listed?.walk_min != null ? `، ${fa(listed.walk_min)} دقیقه` : ""}</div>
        </div>
        <div style={{ textAlign: "end", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          {price}
          {sub && <span className="xs faint">{sub}</span>}
        </div>
      </div>
      <Ripe r={r} />
      {waiting && (
        <div className="xs muted row" style={{ gap: 6 }}><Icon n="clock" s />
          {q.status === "sent" ? "پرسیده شد؛ منتظر دیده شدن…" : q.awaiting_seller ? "ترب‌گرد سؤال تکمیلی پرسید؛ منتظر جواب…" : "فروشنده پیام را دید؛ منتظر پاسخ…"}
          <span className="num faint">مهلت {mmss(left)}</span></div>
      )}
      {q.status === "answered" && a && (
        <>
          {a.parsed_by && a.summary ? <div className="qa"><span className="xs faint">فروشنده: </span><Bidi text={a.summary} /></div> : a.message ? <div className="qa">«{a.message}»</div> : null}
          {pct !== null && pct !== 0 && listedPrice && <span className={`diff ${pct < 0 ? "down" : ""}`} style={{ alignSelf: "flex-start" }}>{pct > 0 ? "+" : "−"}{fa(Math.abs(pct))}٪ نسبت به قیمت ثبت‌شده ({money(listedPrice)}، {daysAgo(listed?.offer?.age_days)})</span>}
          <AnswerDetails q={q} />
        </>
      )}
      {q.status === "unavailable" && (
        <>
          <div className="qa bad">ناموجود{a?.message ? `: «${a.message}»` : ""}</div>
          <AnswerDetails q={q} />
        </>
      )}
      {q.status === "no_reply" && <div className="xs muted">مهلت پاسخ تمام شد و پاسخی نیامد.</div>}
      {!simple && kids.map((k: Inquiry) => <KidRow key={k.id} k={k} />)}
      {hold && <div className="kid" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}><Icon n="hold" s /><span className="grow">نگه داشته{hold.until ? ` تا ${fa(hold.until)}` : ""}؛ در فروشگاه این کد را بگویید:</span><span className="code num" style={{ color: "var(--accent-ink)" }}>{fa(hold.code)}</span></div>}
      <div className="actions">
        {r >= 3 && onChat && <button className="btn ghost" style={{ minHeight: 40 }} onClick={onChat}><Icon n="chat" s />گفتگو و جزئیات</button>}
        {r === 3 && onHold && !holdWaiting && <button className="btn sec" onClick={onHold}><Icon n="hold" s />برایم نگه دار</button>}
        {r >= 3 && onRecheck && !lastKid && <button className="btn ghost" style={{ minHeight: 40 }} onClick={onRecheck}><Icon n="walk" s />راه افتادم؛ دوباره بپرس</button>}
        {failed && onAlt && <button className="btn sec" onClick={onAlt}>جایگزین‌ها<Icon n="fwd" s /></button>}
        {q.status === "no_reply" && onCall && <button className="btn ghost" onClick={onCall}><Icon n="phone" s />خودم زنگ می‌زنم</button>}
      </div>
    </div>
  );
}

/** A shop the wave has not reached yet: listed only, with the reason it comes next. */
export function QueuedRow({ name, why, listed }: { name: string | null; why: string | null; listed?: ShopCard }) {
  return (
    <div className="card shop shop-row" style={{ opacity: 0.85 }}>
      <div className="row between" style={{ alignItems: "flex-start", gap: 10 }}>
        <div><div className="b" style={{ fontSize: 15 }}>{name ?? listed?.name}</div>
          <div className="xs muted">{[listed?.mall, floorLabel(listed?.floor_label)].filter(Boolean).join("، ")}{listed?.walk_min != null ? `، ${fa(listed.walk_min)} دقیقه` : ""}</div></div>
        {listed?.offer?.price ? <div style={{ textAlign: "end" }}><span className="price faint" style={{ fontSize: 15 }}>{money(listed.offer.price)}</span><div className="xs faint">ثبت‌شده، {daysAgo(listed.offer.age_days)}</div></div> : null}
      </div>
      <Ripe r={1} />
      <div className="xs muted">در موج بعد، اگر لازم شد{why ? `، چون ${why}` : ""}</div>
    </div>
  );
}
