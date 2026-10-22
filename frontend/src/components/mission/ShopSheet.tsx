"use client";
// One shop, everything the shopper needs before walking in (canvas S2): where in the mall, the three separate facts (listed price age,
// seller confirmation, stock), reliability, weekly hours, the seller's own listing text, installments, ways to get there.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fa } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { MallLocator } from "@/components/cards";
import { Hours, looksWrong } from "@/components/hours";
import { FastChip, FlagChips, InstallmentChips, OpenChip, PriceBadge, ReliabilityLine, ShopName, SourceNote, TruthRow, confirmedPrice } from "@/components/honesty";
import { Bidi, ErrorState, Note, Sheet } from "@/components/ui";

export function ShopSheet({ shopId, productId, onClose, onMall, onAsk, askLabel = "فقط از همین فروشگاه بپرس" }: {
  shopId: string | null; productId: string | null; onClose: () => void; onMall?: (mallKey: string) => void; onAsk?: (shopId: string) => void; askLabel?: string;
}) {
  const { state } = useSession();
  const q = useQuery({ queryKey: ["shop", shopId, state.place.lat, state.place.lon], queryFn: () => api.shop(shopId!, state.place), enabled: !!shopId });
  const s = q.data;
  const offer = s?.offers.find((o) => o.product_id === productId) ?? null;
  const wrong = s?.weekly_hours && Object.values(s.weekly_hours).some(looksWrong);
  return (
    <Sheet open={!!shopId} onClose={onClose} label="فروشگاه" className="tall">
      <div className="row between"><span className="mc-label">فروشگاه</span><button className="iconbtn soft" onClick={onClose} aria-label="بستن"><Icon n="x" /></button></div>
      {q.isLoading && <><div className="sk" style={{ height: 40 }} /><div className="sk" style={{ height: 140 }} /></>}
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {s && (
        <>
          <div className="stack" style={{ gap: 6 }}>
            <ShopName shop={s} />
            {!s.name_is_verified && <span className="xs faint">نام از داده‌ها نمایش داده می‌شود؛ ممکن است با تابلوی فروشگاه فرق کند.</span>}
            <div className="wrapr"><OpenChip open={s.open} />{s.open.state === "closed" && s.open.opens_at && <span className="xs faint">باز می‌شود: {fa(s.open.opens_at)}</span>}</div>
          </div>
          {offer && (
            <div className="mc-card" style={{ padding: 12, gap: 8 }}>
              <PriceBadge offer={offer} confirmed={confirmedPrice(offer.confirmation ?? s.confirmation)} />
              <TruthRow offer={offer} c={offer.confirmation ?? s.confirmation} listedShown />
              <FlagChips flags={offer.flags} />
              {offer.seller_title && <div className="xs muted"><span className="faint">عنوان فروشنده: </span><Bidi text={offer.seller_title} /></div>}
              {offer.description && <div className="xs faint" style={{ lineHeight: 1.7 }}><span>متن خود فروشنده در ترب: </span><Bidi text={offer.description.slice(0, 220)} /></div>}
            </div>
          )}
          <ReliabilityLine r={s.reliability} />
          {s.mall_key ? <button type="button" className="card" style={{ padding: 0, border: 0, background: "none", textAlign: "start" }} onClick={() => onMall?.(s.mall_key!)}><MallLocator s={s} /><span className="xs" style={{ color: "var(--accent-ink)", fontWeight: 700 }}>نقشهٔ طبقه‌های پاساژ</span></button> : <MallLocator s={s} />}
          <div className="wrapr"><InstallmentChips shop={s} full /><FastChip v={s.fast_delivery} />{s.in_traffic_zone && <span className="tb warn"><Icon n="alert" s />داخل طرح ترافیک</span>}</div>
          <div className="stack" style={{ gap: 6 }}>
            <div className="h4">ساعت کاری</div>
            {wrong && <Note tone="warn" icon="alert"><b>ساعت‌ها ممکن است دقیق نباشد.</b> قبل از رفتن بپرسید.</Note>}
            {s.weekly_hours ? <Hours wh={s.weekly_hours} /> : <Note tone="unk" icon="clock"><b>ساعت کاری ثبت نشده.</b> قبل از رفتن بپرسید.</Note>}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <a className="btn sec grow" href={`https://nshn.ir/?lat=${s.lat}&lng=${s.lon}`} target="_blank" rel="noopener">نشان</a>
            <a className="btn sec grow" href={`https://balad.ir/location?latitude=${s.lat}&longitude=${s.lon}`} target="_blank" rel="noopener">بلد</a>
            <a className="btn sec grow" href={`https://maps.google.com/?q=${s.lat},${s.lon}`} target="_blank" rel="noopener">گوگل</a>
          </div>
          {(s.website || s.instagram) && (
            <div className="wrapr">
              {s.instagram && <a className="chip" href={s.instagram.profile_url} target="_blank" rel="noopener"><Icon n="link" s />اینستاگرام</a>}
              {s.website && <a className="chip" href={s.website} target="_blank" rel="noopener"><Icon n="link" s />وب‌سایت</a>}
            </div>
          )}
          <SourceNote>منبع: ترب{s.name_is_verified ? "، نام فروشگاه تأییدشده" : ""}</SourceNote>
          {onAsk && <div className="sheet-foot"><button className="btn pri block" onClick={() => onAsk(s.shop_id)}><Icon n="send" s />{askLabel}</button></div>}
        </>
      )}
    </Sheet>
  );
}
