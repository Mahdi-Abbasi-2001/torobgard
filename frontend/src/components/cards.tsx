"use client";
import Link from "next/link";
import type { Product, ShopCard as Shop } from "@/lib/api";
import { fa, floorLabel, mil } from "@/lib/fa";
import { Icon } from "./Icon";
import { FastChip, InstallmentChips, LocLine, OpenChip, PriceBadge, ShopName } from "./honesty";
import { Bidi, Thumb } from "./ui";

export function ShopCard({ s, selected, onSelect, confirmed, href, flash, hovered, onHover }: {
  s: Shop; selected?: boolean; onSelect?: () => void; confirmed?: { price: number; ago: string } | null; href?: string; flash?: boolean;
  hovered?: boolean; onHover?: (id: string | null) => void; // desktop: highlights the shop's pin on the map
}) {
  const cat = s.tier === "category_only";
  return (
    <div className={`card shop ${cat ? "cat" : ""} ${flash ? "flash" : ""}${hovered ? " hov" : ""}`}
      onMouseEnter={onHover && (() => onHover(s.shop_id))} onMouseLeave={onHover && (() => onHover(null))}>
      <div className="shop-top">
        {onSelect && (
          <button type="button" className={`sel ${selected ? "on" : ""}`} role="checkbox" aria-checked={!!selected} aria-label={`انتخاب ${s.name} برای استعلام`} onClick={onSelect}>
            {selected && <Icon n="check" s />}
          </button>
        )}
        <Link href={href ?? `/shop/${s.shop_id}`} className="grow" style={{ display: "block" }}>
          <ShopName shop={s} />
          <LocLine s={s} />
        </Link>
      </div>
      <div>{cat ? <span className="unknown"><Icon n="q" s />موجودی و قیمت نامشخص — بپرسید</span> : <PriceBadge offer={s.offer} confirmed={confirmed} />}</div>
      {!cat && s.offer?.seller_title && <div className="xs muted" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}><span className="faint">عنوان فروشنده: </span><Bidi text={s.offer.seller_title} /></div>}
      {!cat && s.offer?.description && <div className="xs faint" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}><Bidi text={s.offer.description} /></div>}
      <div className="wrapr"><OpenChip open={s.open} /></div>
      <div className="wrapr"><InstallmentChips shop={s} /><FastChip v={s.fast_delivery} /></div>
      {(s.instagram || s.website) && (
        <div className="wrapr">
          {s.instagram && <a className="chip" href={s.instagram.profile_url} target="_blank" rel="noopener"><Icon n="link" s />اینستاگرام</a>}
          {s.website && <a className="chip" href={s.website} target="_blank" rel="noopener"><Icon n="link" s />وب‌سایت</a>}
        </div>
      )}
      <div className="why"><b>چرا اینجا؟</b><span>{cat ? "در این دسته فعالیت دارد؛ موجودی را بپرسید" : fa(s.why ?? "")}</span></div>
    </div>
  );
}

export function ProductCard({ p, why, inCompare, onCompare }: { p: Product; why?: string; inCompare?: boolean; onCompare?: () => void }) {
  const same = p.price_min === p.price_max;
  return (
    <div className="card pcard">
      <Link href={`/p/${p.product_id}`}><Thumb src={p.image} alt={p.title} brand={p.brand} /></Link>
      <div className="grow" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Link href={`/p/${p.product_id}`} className="ptitle"><Bidi text={p.title} /></Link>
        <div className="row between" style={{ alignItems: "baseline" }}>
          {p.price_min != null
            ? <span className="price" style={{ fontSize: 16 }}>{same ? "" : "از "}{mil(p.price_min)}<small>تومان</small></span>
            : <span className="unknown">قیمت نامشخص</span>}
          <span className="xs faint">{fa(p.shop_count)} فروشگاه</span>
        </div>
        {!same && p.price_max != null && p.price_median != null && <div className="range">تا {mil(p.price_max)} · میانه {mil(p.price_median)}</div>}
        {why && <div className="why"><b>چرا این؟</b><span>{why}</span></div>}
        {onCompare && (
          <button type="button" className="xs row" style={{ gap: 6, background: "none", border: 0, padding: "4px 0", color: inCompare ? "var(--accent-ink)" : "var(--ink-3)", fontWeight: inCompare ? 650 : 500 }} onClick={onCompare} aria-pressed={inCompare}>
            <span className={`sel ${inCompare ? "on" : ""}`} style={{ width: 20, height: 20, borderRadius: 6 }}>{inCompare && <Icon n="check" s />}</span>
            {inCompare ? "در مقایسه" : "افزودن به مقایسه"}
          </button>
        )}
      </div>
    </div>
  );
}

/** پاساژ ← طبقه ← واحد, with a mini floor stack. Missing parts are drawn as missing. */
export function MallLocator({ s }: { s: { mall: string | null; floor: number | null; floor_label: string | null; unit: string | null; plaque: string | null; address: string } }) {
  const lo = Math.min(-2, s.floor ?? 0), hi = Math.max(7, s.floor ?? 0);
  const floors = [];
  for (let f = lo; f <= hi; f++) floors.push(f);
  const unk = s.floor == null;
  const u = (t: string) => <span className="u">{t}</span>;
  const crumbs = [
    s.mall ?? u("بدون پاساژ"),
    floorLabel(s.floor_label) ?? u("طبقه نامشخص"),
    s.unit ? `واحد ${fa(s.unit)}` : s.plaque ? `پلاک ${fa(s.plaque)}` : u("واحد نامشخص"),
  ];
  return (
    <div className="card mloc">
      <div className="floors" aria-hidden="true">
        {unk ? Array.from({ length: 10 }, (_, i) => <div key={i} className="unk" />)
          : floors.map((f) => <div key={f} className={s.floor === f ? "hit" : ""}>{s.floor === f ? (f === 0 ? "همکف" : fa(f)) : ""}</div>)}
      </div>
      <div className="stack grow" style={{ gap: 6 }}>
        <span className="xs faint">مسیر داخل پاساژ</span>
        <div className="crumb">{crumbs.map((c, i) => <span key={i} className="row" style={{ gap: 6 }}>{i > 0 && <span className="ar">←</span>}{c}</span>)}</div>
        <div className="xs muted">{fa(s.address)}</div>
        {unk && <div className="xs" style={{ color: "var(--unk)" }}>طبقه ثبت نشده؛ از نگهبان یا تابلوی ورودی بپرسید.</div>}
      </div>
    </div>
  );
}

export function ProductMini({ p, sub }: { p: { title: string; image?: string | null; brand?: string | null; product_id?: string }; sub: React.ReactNode }) {
  return (
    <Link href={p.product_id ? `/p/${p.product_id}` : "#"} className="card row" style={{ padding: 10, gap: 10 }}>
      <Thumb src={p.image} alt={p.title} size={48} brand={p.brand} />
      <div className="grow"><div className="b sm" style={{ lineHeight: 1.5 }}><Bidi text={p.title} /></div><div className="xs faint">{sub}</div></div>
    </Link>
  );
}
