"use client";
// Steps 1–3 building blocks: when / how you go, best place to go, model variants, fair price, score breakdown.
import { RouteButton } from "@/components/RoutePreview";
import Link from "next/link";
import { useState } from "react";
import type { FairPrice, ShopCard, Variant, Zone } from "@/lib/api";
import { fa, mil } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { Icon } from "./Icon";
import { Bidi, Note, Seg, Sheet, Thumb } from "./ui";

export const WHEN_OPTS: [string, string][] = [["now", "الان"], ["1h", "یک ساعت دیگر"], ["evening", "عصر امروز"], ["tomorrow", "فردا صبح"]];
const MODE_OPTS: [("walk" | "taxi" | "car"), string][] = [["walk", "پیاده"], ["taxi", "تاکسی / اسنپ"], ["car", "خودروی شخصی"]];
export const whenLabel = (w: string) => WHEN_OPTS.find((x) => x[0] === w)?.[1] ?? (/^\d{1,2}:\d{2}$/.test(w) ? `ساعت ${fa(w)}` : "الان");

/** Chip + sheet: when will you go and how. Opening hours on every card are then judged for your arrival. */
export function WhenChip() {
  const { state, update } = useSession();
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState("");
  const later = state.when !== "now";
  return (
    <>
      <button className={`chip ${later || state.mode !== "walk" ? "on" : ""}`} onClick={() => setOpen(true)}>
        <Icon n="clock" s />{later ? whenLabel(state.when) : "کی می‌روید؟"}{state.mode !== "walk" ? ` · ${MODE_OPTS.find((m) => m[0] === state.mode)?.[1]}` : ""}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} label="زمان و نحوهٔ رفتن">
        <h2>کی و چطور می‌روید؟</h2>
        <p className="lede" style={{ marginTop: -8 }}>باز یا بسته بودن هر فروشگاه را برای <b>زمان رسیدن شما</b> حساب می‌کنیم، نه الان.</p>
        <div className="stack" style={{ gap: 6 }}><span className="b sm">زمان</span>
          <div className="wrapr">{WHEN_OPTS.map(([v, l]) => <button key={v} type="button" className={`chip ${state.when === v ? "on" : ""}`} style={{ minHeight: 42 }} onClick={() => update((s) => ({ ...s, when: v }))}>{l}</button>)}</div>
          <label className="row xs muted" style={{ gap: 8 }}>یا ساعت دقیق:
            <input type="time" value={clock} onChange={(e) => { setClock(e.target.value); if (e.target.value) update((s) => ({ ...s, when: e.target.value })); }} style={{ minHeight: 36 }} />
          </label>
        </div>
        <div className="stack" style={{ gap: 6 }}><span className="b sm">با چه وسیله‌ای؟</span>
          <Seg label="وسیله" value={state.mode} onChange={(v) => update((s) => ({ ...s, mode: v }))} options={MODE_OPTS} />
          {state.mode === "car" && <Note tone="warn" icon="alert">بازار مرکزی داخل طرح ترافیک است؛ بدون مجوز با خودرو نروید. زمان‌ها با پارک حساب شده‌اند.</Note>}
        </div>
        <button className="btn pri block" onClick={() => setOpen(false)}>اعمال</button>
      </Sheet>
    </>
  );
}

/** "Best place to go": malls/areas where several shops that list the product sit together. */
export function ZonesCard({ zones, onFocus }: { zones?: Zone[]; onFocus?: (z: Zone) => void }) {
  if (!zones?.length) return null;
  const [top, ...rest] = zones;
  return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="row" style={{ gap: 8 }}><span className="snap-ic" style={{ width: 34, height: 34 }}><Icon n="layers" s /></span>
        <div className="grow"><div className="xs faint">بهترین جا برای رفتن · یک سفر، چند فروشگاه</div><div className="b">{fa(top.name)}</div></div>
        {onFocus && <button className="btn ghost" style={{ minHeight: 36 }} onClick={() => onFocus(top)}>فقط همین‌ها</button>}</div>
      <div className="xs muted">{top.why}</div>
      {rest.length > 0 && <div className="xs faint">گزینه‌های بعدی: {rest.map((z) => `${fa(z.name)} (${fa(z.shop_count)} فروشگاه${z.price_min ? `، از ${mil(z.price_min)}` : ""})`).join(" · ")}</div>}
      {top.lat != null && top.lon != null && <div className="row" style={{ gap: 8 }}><RouteButton to={{ lat: top.lat, lon: top.lon }} label={fa(top.name)} style={{ minHeight: 38 }} /></div>}
    </div>
  );
}

/** Other versions of the same model (storage / RAM / colour) with their price and how many shops nearby have them. */
export function VariantsStrip({ items, title = "نسخه‌های دیگر همین مدل" }: { items?: Variant[]; title?: string }) {
  if (!items?.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="h4">{title} <span className="n">{fa(items.length)}</span></div>
      <div className="hscroll" style={{ paddingInline: 0 }}>
        {items.map((v) => (
          <Link key={v.product_id} href={`/p/${v.product_id}`} className="card" style={{ padding: 10, minWidth: 170, flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="row" style={{ gap: 8 }}><Thumb src={v.image} alt="" size={36} brand={v.brand} /><span className="xs b" style={{ lineHeight: 1.5 }}><Bidi text={v.variant} /></span></div>
            <span className="sm b num">{v.price_min ? `از ${mil(v.price_min)}` : "قیمت نامشخص"}
              {v.vs_price_pct ? <span className={`xs ${v.vs_price_pct < 0 ? "" : "faint"}`} style={{ color: v.vs_price_pct < 0 ? "var(--ok)" : undefined, marginInlineStart: 6 }}>{v.vs_price_pct > 0 ? "+" : "−"}{fa(Math.abs(v.vs_price_pct))}٪</span> : null}</span>
            <span className="xs faint">{v.near?.near ? `${fa(v.near.near)} فروشگاه نزدیک` : `${fa(v.shop_count)} فروشگاه`}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Typical price from all listings: lets the shopper judge a quote on the spot. */
export function FairPriceNote({ fp }: { fp?: FairPrice | null }) {
  if (!fp) return null;
  return (
    <div className="xs row" style={{ gap: 6, alignItems: "flex-start", color: "var(--ink-2)" }}>
      <Icon n="shield" s /><span><b>قیمت منصفانه: </b>{fp.offers >= 3 ? `${mil(fp.low)} تا ${mil(fp.high)} تومان` : "اطلاعات کافی نیست"}
        <span className="faint"> · از {fa(fp.offers)} قیمت ثبت‌شده{fp.fresh_offers ? `، ${fa(fp.fresh_offers)} تا از این هفته` : ""}{fp.outliers ? ` · ${fa(fp.outliers)} قیمت پرت کنار گذاشته شد` : ""}</span></span>
    </div>
  );
}

const PART_FA: Record<string, string> = { price: "قیمت", distance: "فاصله", freshness: "تازگی قیمت", open: "باز بودن", confirmations: "تأیید و سابقه" };

/** Why a shop ranked where it did: lower is better, so a short bar means a strength. */
export function ScoreBars({ s }: { s: ShopCard }) {
  if (!s.score_parts) return null;
  const parts = Object.entries(s.score_parts).filter(([k]) => k !== "confirmations");
  const max = Math.max(0.3, ...parts.map(([, v]) => v));
  const conf = s.score_parts.confirmations;
  return (
    <div className="stack" style={{ gap: 3 }} aria-label="دلیل رتبه">
      {parts.map(([k, v]) => (
        <div key={k} className="row xs" style={{ gap: 6 }}>
          <span className="faint" style={{ width: 62 }}>{PART_FA[k]}</span>
          <span style={{ flex: 1, height: 5, borderRadius: 3, background: "var(--sunk)", overflow: "hidden" }}>
            <i style={{ display: "block", height: "100%", width: `${Math.max(4, 100 - (v / max) * 100)}%`, background: v / max < 0.34 ? "var(--ok)" : v / max < 0.67 ? "var(--warn)" : "var(--bad)" }} />
          </span>
        </div>
      ))}
      {conf < -0.05 && <span className="xs" style={{ color: "var(--ok)" }}>+ تأیید فروشنده یا سابقهٔ خوب</span>}
      {conf > 0.05 && <span className="xs" style={{ color: "var(--bad)" }}>− هشدار در آگهی یا «ندارم» اخیر</span>}
    </div>
  );
}
