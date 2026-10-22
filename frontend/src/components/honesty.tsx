// The honesty system: listed vs seller-confirmed vs unknown never share a look (design-brief §3).
import type { Confirmation, Flag, Offer, OpenInfo, Payment, Reliability, ShopCard, Travel } from "@/lib/api";
import { daysAgo, fa, floorLabel, money, walk } from "@/lib/fa";
import { Icon } from "./Icon";

const FRESH_LABEL: Record<string, string> = { fresh: "ثبت‌شده", recent: "ثبت‌شده", stale: "قیمت قدیمی · ثبت", very_stale: "خیلی قدیمی · ثبت" };

export function PriceBadge({ offer, confirmed }: { offer?: Offer | null; confirmed?: { price: number; ago: string; sim?: boolean } | null }) {
  if (confirmed)
    return (
      <div className="pb is-confirmed">
        <span className="price">{money(confirmed.price)}<small>تومان</small></span>
        <span className="confirmed"><Icon n="check" s />قیمت تأییدشده · {confirmed.ago}{confirmed.sim ? " (نمایشی)" : ""}</span>
        {offer?.price && offer.price !== confirmed.price ? <span className="xs faint">ثبت‌شده: <span className="strike num">{money(offer.price)}</span></span> : null}
      </div>
    );
  if (!offer || offer.price == null || offer.freshness === "no_price")
    return <div className="pb"><span className="unknown"><Icon n="q" s />قیمت نامشخص — بپرسید</span></div>;
  const unknownAge = offer.freshness === "unknown_age" || offer.age_days == null;
  return (
    <div className="pb">
      <span className="price">{money(offer.price)}<small>تومان</small></span>
      {offer.updated_by_seller
        ? <span className="fresh">قیمت به‌روزشده توسط فروشنده · {daysAgo(offer.age_days)}{offer.listed_before_update && offer.listed_before_update !== offer.price ? <> (قبلاً <span className="strike num">{money(offer.listed_before_update)}</span>)</> : null}</span>
        : unknownAge
        ? <span className="fresh unknown_age">تاریخ ثبت قیمت نامشخص</span>
        : <span className={`fresh ${offer.freshness}`}>{FRESH_LABEL[offer.freshness] ?? "ثبت‌شده"} {daysAgo(offer.age_days)}</span>}
      {offer.suspicious && <div className="note bad"><Icon n="alert" s /><span>قیمت مشکوک، حتماً استعلام بگیرید</span></div>}
    </div>
  );
}

export function OpenChip({ open }: { open: OpenInfo }) {
  const label = open.state === "unknown"
    ? (open.quality === "suspicious" ? "ساعت این روز نامشخص" : "ساعت کاری ثبت نشده")
    : fa(open.label);
  return (
    <>
      <span className={`oc ${open.state}`}>{label}</span>
      {open.quality === "suspicious" && open.state !== "unknown" && (
        <span className="tag" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>ساعت‌ها ممکن است دقیق نباشد</span>
      )}
    </>
  );
}

export function FastChip({ v }: { v: boolean | null }) {
  if (v === true) return <span className="feat yes"><Icon n="truck" s />ارسال سریع</span>;
  if (v === false) return <span className="feat no"><Icon n="truck" s />ارسال سریع ندارد</span>;
  return <span className="feat unk"><Icon n="truck" s />ارسال سریع: نامشخص</span>;
}

export function InstallmentChips({ shop, full = false }: { shop: { installment: boolean; payments: Payment[] }; full?: boolean }) {
  if (!shop.installment || !shop.payments?.length)
    return full ? <span className="feat no"><Icon n="card" s />قسطی ندارد</span> : null;
  return (
    <>
      {shop.payments.map((p) =>
        p.confirmed_in_store
          ? <span key={p.provider} className="inst conf"><Icon n="card" s />{p.provider} · پذیرش حضوری تأییدشده</span>
          : <span key={p.provider} className="inst decl"><Icon n="card" s />{p.provider}{full ? " · اعلام‌شده؛ نوع پذیرش نامشخص" : ""}</span>
      )}
      {!full && shop.payments.some((p) => !p.confirmed_in_store) && <span className="xs faint" style={{ alignSelf: "center" }}>نوع پذیرش نامشخص</span>}
    </>
  );
}

export function ShopName({ shop }: { shop: Pick<ShopCard, "name" | "name_is_verified"> }) {
  return (
    <div className="shop-name">
      {shop.name}
      {shop.name_is_verified && <span className="tag" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}><Icon n="shield" s />نام تأییدشده</span>}
    </div>
  );
}

export function LocLine({ s, mode = "walk" }: { s: Pick<ShopCard, "mall" | "floor_label" | "unit" | "plaque" | "address" | "walk_min"> & { travel?: Travel | null }; mode?: "walk" | "taxi" | "car" }) {
  const parts: React.ReactNode[] = [];
  if (s.mall) {
    parts.push(s.mall);
    parts.push(floorLabel(s.floor_label) ?? <span style={{ color: "var(--unk)" }}>طبقه نامشخص</span>);
  } else {
    parts.push(<span className="faint">بدون پاساژ · {fa(s.address.split("،").slice(0, 2).join("،"))}</span>);
  }
  if (s.unit) parts.push(`واحد ${fa(s.unit)}`);
  else if (s.plaque) parts.push(`پلاک ${fa(s.plaque)}`);
  return (
    <div className="loc">
      {parts.map((p, i) => <span key={i} className="row" style={{ gap: 4 }}>{i > 0 && <span className="sep">←</span>}{p}</span>)}
      {mode !== "walk" && s.travel ? <><span className="sep">·</span><Icon n={mode === "car" ? "truck" : "route"} s />{travelText(s.travel, mode)}</>
        : s.walk_min != null && <><span className="sep">·</span><Icon n="walk" s />{walk(s.walk_min)}</>}
    </div>
  );
}

export function SourceNote({ children }: { children: React.ReactNode }) {
  return <div className="xs faint row" style={{ gap: 6 }}><Icon n="eye" s /><span>{children}</span></div>;
}

export function NoCallNote() {
  return <div className="note unk"><Icon n="lock" s /><span>شمارهٔ تلفن این فروشگاه در داده‌ها معتبر نیست؛ مطمئن‌ترین راه «استعلام» است و پاسخ را همین‌جا می‌بینید. اگر خودتان زنگ زدید، نتیجه را در صفحهٔ پیگیری ثبت کنید تا بقیه هم ببینند.</span></div>;
}

/** "n minutes / hours ago" from a minute count. */
export const agoMin = (m: number) => (m < 1 ? "همین الان" : m < 60 ? `${fa(m)} دقیقه پیش` : m < 1440 ? `${fa(Math.round(m / 60))} ساعت پیش` : `${fa(Math.round(m / 1440))} روز پیش`);

const SOURCE: Record<Confirmation["source"], string> = { seller: "تأیید فروشنده", visit: "دیدهٔ خریدار", call: "تماس خریدار" };

/** A confirmation that may still be shown as current (fresh or aging) and says the item is there. */
export const liveConfirmation = (c?: Confirmation | null) => (c && c.state !== "expired" && c.available !== false ? c : null);

/** The confirmed price as PriceBadge's `confirmed` prop, when a recent confirmation carries one. */
export function confirmedPrice(c?: Confirmation | null) {
  const l = liveConfirmation(c);
  return l?.price ? { price: l.price, ago: agoMin(l.age_min) + (l.source !== "seller" ? ` · ${SOURCE[l.source]}` : ""), sim: l.simulated } : null;
}

/** Three facts the brief says must never be merged: listed price age · seller confirmation · stock. */
export function TruthRow({ offer, c, cat = false, listedShown = false }: { offer?: Offer | null; c?: Confirmation | null; cat?: boolean; listedShown?: boolean }) {
  const listed = cat || !offer ? <span className="tb unk">قیمت ثبت‌شده: ندارد</span>
    : offer.price == null ? <span className="tb unk">قیمت ثبت‌شده: ندارد</span>
    : offer.updated_by_seller ? <span className="tb ok">قیمت ثبت‌شده: فروشنده {daysAgo(offer.age_days)} به‌روز کرد</span>
    : offer.age_days == null ? <span className="tb unk">قیمت ثبت‌شده: تاریخ نامشخص</span>
    : <span className={`tb ${offer.age_days > 30 ? "bad" : offer.age_days > 7 ? "warn" : ""}`}>قیمت ثبت‌شده: {daysAgo(offer.age_days)}</span>;
  const sim = c?.simulated ? " (نمایشی)" : "";
  const conf = !c ? <span className="tb unk">تأیید فروشنده: هنوز نه</span>
    : c.state === "expired" ? <span className="tb unk">{SOURCE[c.source]}: {agoMin(c.age_min)} · دوباره بپرسید</span>
    : <span className={`tb ${c.state === "fresh" ? "ok" : "warn"}`}><Icon n="check" s />{SOURCE[c.source]}: {agoMin(c.age_min)}{sim}</span>;
  const stock = !c || c.state === "expired" || c.available == null ? <span className="tb unk">موجودی: تأییدنشده</span>
    : c.available ? <span className={`tb ${c.state === "fresh" ? "ok" : "warn"}`}>موجودی: تأییدشده{c.count > 1 ? ` · ${fa(c.count)} بار امروز` : ""}</span>
    : <span className="tb bad">موجودی: «ندارم» گفته</span>;
  // listedShown: the price badge right above already says how old the listed price is
  return <div className="truth" aria-label="وضعیت اطلاعات">{!listedShown && listed}{conf}{stock}</div>;
}

export function ReliabilityLine({ r }: { r?: Reliability | null }) {
  if (!r?.known || !r.label) return <div className="xs faint row" style={{ gap: 6 }}><Icon n="clock" s /><span>سابقهٔ پاسخ‌گویی: هنوز داده‌ای نداریم</span></div>;
  const good = r.score >= 0.6;
  return <div className="xs row" style={{ gap: 6, color: good ? "var(--ok)" : "var(--ink-3)" }}><Icon n={good ? "shield" : "clock"} s /><span>{fa(r.label)}</span></div>;
}

/** Red flags the seller wrote in their own listing (used, stock, regional version, copy, not registered...). */
export function FlagChips({ flags }: { flags?: Flag[] | null }) {
  if (!flags?.length) return null;
  return (
    <div className="truth" aria-label="هشدار از متن آگهی فروشنده">
      {flags.map((f) => <span key={f.code} className={`tb ${f.tone}`}><Icon n="alert" s />{f.label}</span>)}
      <span className="xs faint" style={{ alignSelf: "center" }}>از متن آگهی خود فروشنده</span>
    </div>
  );
}

/** Where this listed price sits in the market (from all shops' listings). */
export function FairChip({ fair }: { fair?: { level: "ok" | "warn"; text: string } | null }) {
  if (!fair) return null;
  return <span className={`tb ${fair.level === "ok" ? "ok" : "warn"}`}>{fair.level === "ok" ? <Icon n="check" s /> : <Icon n="alert" s />}{fair.text}</span>;
}

const MODE_FA = { walk: "پیاده", taxi: "با تاکسی", car: "با خودرو" } as const;
export function travelText(t: Travel | null | undefined, mode: "walk" | "taxi" | "car") {
  if (!t) return null;
  const m = t[mode];
  return `${m === 0 ? "کمتر از ۱" : fa(m)} دقیقه ${MODE_FA[mode]}`;
}
