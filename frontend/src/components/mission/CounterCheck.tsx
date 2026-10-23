"use client";
// At the counter, before paying: a photo of the item (or its box / price tag) checked against what the seller confirmed.
// Same model? Same price? A mismatch can be reported in one tap so the shop's reliability reflects it. The photo is read and dropped.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api, type IdentifyResult } from "@/lib/api";
import { fa, mil, money, parseNum } from "@/lib/fa";
import { normalize } from "@/lib/text";
import { shrinkPhoto } from "@/lib/photo";
import type { Mission } from "@/lib/mission";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { Bidi, Note, Sheet } from "@/components/ui";

type Line = { tone: "ok" | "bad" | "unk"; text: string };

function modelLine(r: IdentifyResult, m: Mission): Line & { wrong: boolean } {
  const same = r.match === "exact" && r.candidates.some((c) => c.product_id === m.productId);
  if (same) return { tone: "ok", text: "همان مدل است.", wrong: false };
  if (r.read.model && m.product && normalize(m.product.title).includes(normalize(r.read.model))) return { tone: "ok", text: `مدل روی عکس (${r.read.model}) با نام کالا جور است.`, wrong: false };
  if (r.match === "exact" && r.candidates[0]) return { tone: "bad", text: `به نظر مدل دیگری است: ${r.candidates[0].title}`, wrong: true };
  return { tone: "unk", text: "مدل از روی عکس خوانده نشد؛ مدل چاپ‌شده روی جعبه را با نام کالا مقایسه کنید.", wrong: false };
}

export function CounterCheck({ open, onClose, m, shopId, shopName, inquiryId, confirmed }: {
  open: boolean; onClose: () => void; m: Mission; shopId: string | null; shopName: string; inquiryId: string | null; confirmed: number | null;
}) {
  const id = useId();
  const { sid } = useSession();
  const qc = useQueryClient();
  const [price, setPrice] = useState("");
  const [sent, setSent] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const read = useMutation({
    mutationFn: async (f: File) => { setPreview(URL.createObjectURL(f)); return api.identify(await shrinkPhoto(f)); },
    onSuccess: (r) => { setPrice(r.read.price_seen ? money(r.read.price_seen) : ""); setSent(false); },
  });
  const r = read.data;
  const model = r ? modelLine(r, m) : null;
  const tag = price ? parseNum(price) : null;
  const ratio = tag && confirmed ? tag / confirmed : null;
  const odd = ratio != null && (ratio >= 4 || ratio <= 0.25); // most likely a dropped or extra zero in the reading
  const pct = ratio != null && !odd ? Math.round((ratio - 1) * 100) : null;
  const priceLine: Line | null = !confirmed ? null
    : !tag ? { tone: "unk", text: "قیمت روی برچسب خوانده نشد؛ اگر می‌بینید، در کادر بنویسید." }
    : odd ? { tone: "unk", text: "این قیمت با قیمت تأییدشده خیلی فاصله دارد؛ شاید یک صفر کم یا زیاد خوانده شده. اصلاحش کنید." }
    : Math.abs(pct!) <= 2 ? { tone: "ok", text: `همان قیمتی است که فروشنده تأیید کرده بود (${money(confirmed)} تومان).` }
    : { tone: "bad", text: `روی برچسب ${money(tag)} تومان است؛ فروشنده ${money(confirmed)} تأیید کرده بود (${fa(Math.abs(pct!))}٪ ${pct! > 0 ? "بیشتر" : "کمتر"}).` };
  const problem = model?.wrong || priceLine?.tone === "bad";

  const report = useMutation({
    mutationFn: () => api.report({ session_id: sid, shop_id: shopId!, product_id: m.productId!, kind: "visit", available: model?.wrong ? false : true,
      price_matched: priceLine?.tone === "bad" ? false : null, price: priceLine?.tone === "bad" ? tag : null, inquiry_id: inquiryId }),
    onSuccess: () => { setSent(true); qc.invalidateQueries({ queryKey: ["pshops-all"] }); },
  });

  return (
    <Sheet open={open} onClose={onClose} label="بررسی کالا قبل از پرداخت" className="tall">
      <div className="row between"><div><div className="mc-label">قبل از پرداخت</div><div className="b" style={{ fontSize: 17 }}>بررسی کالا با عکس</div></div>
        <button className="iconbtn soft" onClick={onClose} aria-label="بستن"><Icon n="x" /></button></div>
      <p className="lede" style={{ marginTop: -6 }}>از کالا یا جعبه یا برچسب قیمت عکس بگیرید؛ با آنچه {shopName} تأیید کرده مقایسه می‌کنیم.</p>
      <label htmlFor={id} className="btn pri block" style={{ cursor: "pointer" }}>
        {read.isPending ? <span className="spin" style={{ borderTopColor: "var(--on-accent)" }} /> : <Icon n="cam" s />}{r ? "عکس دیگر" : "عکس گرفتن"}
        <input id={id} type="file" accept="image/*" capture="environment" className="sr" onChange={(e) => { const f = e.target.files?.[0]; if (f) read.mutate(f); e.target.value = ""; }} />
      </label>
      {preview && (
        <div className="scan-box">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview of the photo just taken */}
          <img src={preview} alt="عکسی که گرفتید" />
          {read.isPending && <span className="scan-line" aria-hidden="true" />}{read.isPending && <span className="scan-tag">دارم می‌خوانم…</span>}
        </div>
      )}
      {read.isError && <Note tone="bad" icon="alert">{(read.error as Error).message}</Note>}
      {r && model && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="mc-card" style={{ padding: 12, gap: 8 }}>
            <div className="xs faint row" style={{ gap: 6 }}><Icon n="eye" s />از عکس خوانده شد: <span>{[r.read.product_type, r.read.brand_fa ?? r.read.brand, r.read.model].filter(Boolean).map((x, i) => <span key={i}>{i ? "، " : ""}<Bidi text={x!} /></span>)}</span></div>
            <div className={`note ${model.tone}`}><Icon n={model.tone === "ok" ? "check" : model.tone === "bad" ? "alert" : "q"} s /><span><Bidi text={model.text} /></span></div>
            {confirmed != null && (
              <>
                <div className="field" style={{ minHeight: 46 }}><label htmlFor={`${id}-p`} className="sr">قیمت روی برچسب</label>
                  <input id={`${id}-p`} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="قیمت روی برچسب" style={{ fontWeight: 800 }} /><span className="xs faint">تومان</span></div>
                {priceLine && <div className={`note ${priceLine.tone}`}><Icon n={priceLine.tone === "ok" ? "check" : priceLine.tone === "bad" ? "alert" : "q"} s /><span>{priceLine.text}</span></div>}
              </>
            )}
          </div>
          {problem && !sent && (
            <button className="btn sec block" disabled={report.isPending || !shopId} onClick={() => report.mutate()}>{report.isPending ? <span className="spin" /> : <Icon n="alert" s />}این را برای بقیهٔ خریدارها گزارش کن</button>
          )}
          {sent && <Note tone="ok" icon="check">گزارش ثبت شد؛ بقیه هم در کارت این فروشگاه می‌بینند.</Note>}
          {report.isError && <Note tone="bad" icon="alert">{(report.error as Error).message}</Note>}
          {!problem && model.tone === "ok" && (!priceLine || priceLine.tone === "ok") && <Note tone="ok" icon="check">همه‌چیز با تأیید فروشنده جور است. گارانتی و سالم بودن را هم خودتان ببینید.</Note>}
        </div>
      )}
      <span className="xs faint">عکس فقط برای همین خواندن فرستاده می‌شود و ذخیره نمی‌شود. این بررسی کمکی است و جای دیدن گارانتی و سلامت کالا را نمی‌گیرد. قیمت تأییدشده: {confirmed ? `${mil(confirmed)} تومان` : "ندارد"}.</span>
    </Sheet>
  );
}
