// The honesty system: listed vs seller-confirmed vs unknown never share a look (design-brief §3).
import type { Offer, OpenInfo, Payment, ShopCard } from "@/lib/api";
import { daysAgo, fa, floorLabel, money, walk } from "@/lib/fa";
import { Icon } from "./Icon";

const FRESH_LABEL: Record<string, string> = { fresh: "ثبت‌شده", recent: "ثبت‌شده", stale: "قیمت قدیمی · ثبت", very_stale: "خیلی قدیمی · ثبت" };

export function PriceBadge({ offer, confirmed }: { offer?: Offer | null; confirmed?: { price: number; ago: string } | null }) {
  if (confirmed)
    return (
      <div className="pb is-confirmed">
        <span className="price">{money(confirmed.price)}<small>تومان</small></span>
        <span className="confirmed"><Icon n="check" s />تأیید شده توسط فروشنده · {confirmed.ago}</span>
      </div>
    );
  if (!offer || offer.price == null || offer.freshness === "no_price")
    return <div className="pb"><span className="unknown"><Icon n="q" s />قیمت نامشخص — بپرسید</span></div>;
  const unknownAge = offer.freshness === "unknown_age" || offer.age_days == null;
  return (
    <div className="pb">
      <span className="price">{money(offer.price)}<small>تومان</small></span>
      {unknownAge
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

export function LocLine({ s }: { s: Pick<ShopCard, "mall" | "floor_label" | "unit" | "plaque" | "address" | "walk_min"> }) {
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
      {s.walk_min != null && <><span className="sep">·</span><Icon n="walk" s />{walk(s.walk_min)}</>}
    </div>
  );
}

export function SourceNote({ children }: { children: React.ReactNode }) {
  return <div className="xs faint row" style={{ gap: 6 }}><Icon n="eye" s /><span>{children}</span></div>;
}

export function NoCallNote() {
  return <div className="note unk"><Icon n="lock" s /><span>شمارهٔ تلفن این فروشگاه در داده‌ها معتبر نیست؛ تماس فقط از راه «استعلام» است و پاسخ را همین‌جا می‌بینید.</span></div>;
}
