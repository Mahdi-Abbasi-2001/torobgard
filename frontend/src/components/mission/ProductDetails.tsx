"use client";
// Everything about one model, in three tabs (canvas S1): what matters for you, the specs, strengths and weaknesses. Docked on the
// left on desktop, a sheet on phones. Every claim cites a real spec; there are no user reviews in the data and it says so.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type ProductReview } from "@/lib/api";
import { fa, mil } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { FairPriceNote } from "@/components/discover";
import { Bidi, Thumb } from "@/components/ui";

type Line = { mark: "✓" | "–" | "•" | "i" | ""; tone: string; text: string; src?: string };
const TONE = { "✓": "var(--ok)", "–": "var(--bad)", "•": "var(--info)", i: "var(--info)", "": "var(--ink)" } as const;

function lines(r: ProductReview | undefined): { you: Line[]; sw: Line[] } {
  if (!r) return { you: [], sw: [] };
  const pro = (x: ProductReview["pros"][number]): Line => ({ mark: "✓", tone: TONE["✓"], text: x.text, src: `${x.spec_key}: ${x.spec_value}` });
  const con = (x: ProductReview["cons"][number]): Line => ({ mark: "–", tone: TONE["–"], text: x.text, src: `${x.spec_key}: ${x.spec_value}` });
  const tips: Line[] = r.tips.slice(0, 2).map((t) => ({ mark: "•", tone: TONE["•"], text: t, src: "در مغازه چک کنید" }));
  return {
    you: [...r.pros.slice(0, 3).map(pro), ...r.cons.slice(0, 1).map(con), ...tips],
    sw: [...r.pros.map(pro), ...r.cons.map(con),
      ...(r.reputation ? [{ mark: "i" as const, tone: TONE.i, text: `طبق اطلاعات عمومی (تأییدنشده): ${r.reputation.text}`, src: "شفافیت" }] : []),
      { mark: "i", tone: TONE.i, text: "ترب نظر کاربران ندارد؛ این‌ها از مشخصات ساخته شده‌اند.", src: "شفافیت" }],
  };
}

export function ProductDetails({ id, onChallenge, onClose }: { id: string; onChallenge?: (id: string) => void; onClose?: () => void }) {
  const { state } = useSession();
  const [tab, setTab] = useState<"you" | "specs" | "sw">("you");
  const p = useQuery({ queryKey: ["product", id], queryFn: () => api.product(id) });
  const ins = useQuery({ queryKey: ["insights", id, state.place.lat, state.place.lon, state.when], queryFn: () => api.insights(id, state.place, state.when) });
  const rev = useQuery({ queryKey: ["review", id], queryFn: () => api.review(id), staleTime: Infinity, retry: 0 });
  const d = p.data;
  const L = lines(rev.data);
  const pos = d?.price_min != null && d.price_max != null && d.price_median != null && d.price_max > d.price_min ? Math.round(((d.price_median - d.price_min) / (d.price_max - d.price_min)) * 100) : 50;
  const tabs: ["you" | "specs" | "sw", string][] = [["you", "برای شما"], ["specs", "مشخصات"], ["sw", "قوت و ضعف"]];

  return (
    <div className="stack" style={{ gap: 14 }}>
      {onClose && <div className="row between"><span className="mc-label">جزئیات کالا</span><button className="iconbtn soft" onClick={onClose} aria-label="بستن"><Icon n="x" /></button></div>}
      {p.isLoading && <><div className="sk" style={{ height: 72 }} /><div className="sk" style={{ height: 160 }} /></>}
      {d && (
        <>
          <div className="row" style={{ gap: 12 }}>
            <Thumb src={d.image} alt="" size={72} brand={d.brand} />
            <div><div className="b" style={{ fontSize: 16, lineHeight: 1.5 }}><Bidi text={d.title} /></div>
              <div className="xs faint">{fa(d.shop_count)} فروشگاه{ins.data?.availability?.near ? `، ${fa(ins.data.availability.near)} تا ${fa(15)} دقیقه پیاده` : ""}</div></div>
          </div>
          {d.price_min != null && d.price_max != null && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row between xs muted"><span>{mil(d.price_min)}</span>{d.price_median != null && <span>میانه {mil(d.price_median)}</span>}<span>{mil(d.price_max)}</span></div>
              <div style={{ position: "relative", height: 10, borderRadius: 5, background: "linear-gradient(to left, var(--ok-soft), var(--bad-soft))" }}>
                <span style={{ position: "absolute", insetInlineStart: `${pos}%`, top: -4, width: 4, height: 18, borderRadius: 2, background: "var(--ink)", marginInlineStart: -2 }} />
              </div>
              <FairPriceNote fp={ins.data?.fair_price} />
            </div>
          )}
          <div className="seg" role="tablist" aria-label="جزئیات">
            {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          <div className="stack" style={{ gap: 0, minHeight: 120 }}>
            {tab === "specs"
              ? d.specs.filter((s, i, a) => a.findIndex((x) => x.key === s.key) === i).slice(0, 14).map((s) => (
                <div key={s.key} className="row between" style={{ padding: "8px 0", borderBottom: "1px solid var(--line)", gap: 12, alignItems: "flex-start" }}>
                  <span className="xs faint" style={{ flex: "0 0 38%" }}>{s.key}</span><span className="sm" style={{ textAlign: "end" }}><Bidi text={fa(s.value)} /></span>
                </div>))
              : rev.isLoading ? <div className="toolline" style={{ alignSelf: "flex-start", padding: 10 }}><span className="spin" />در حال تهیه نقد کوتاه…</div>
              : (tab === "you" ? L.you : L.sw).length ? (tab === "you" ? L.you : L.sw).map((l, i) => (
                <div key={i} className="row" style={{ gap: 10, padding: "9px 0", borderBottom: "1px solid var(--line)", alignItems: "flex-start" }}>
                  <b style={{ color: l.tone, width: 16, flex: "0 0 auto" }}>{l.mark}</b>
                  <span className="stack" style={{ gap: 1 }}><span className="sm" style={{ lineHeight: 1.65 }}><Bidi text={l.text} /></span>{l.src && <span className="xs faint"><Bidi text={fa(l.src)} /></span>}</span>
                </div>))
              : <span className="mc-note" style={{ padding: 10 }}>نقد هوشمند الان در دسترس نیست؛ مشخصات را ببینید.</span>}
          </div>
          {onChallenge && ins.data && ins.data.variants.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="b sm">نسخه‌های دیگر همین مدل</div>
              {ins.data.variants.slice(0, 3).map((v) => (
                <div key={v.product_id} className="card row" style={{ padding: "8px 10px", gap: 10 }}>
                  <div className="grow"><div className="xs b"><Bidi text={v.variant} /></div>
                    <div className="xs faint">{v.price_min ? `از ${mil(v.price_min)}` : "قیمت نامشخص"}{v.vs_price_pct ? `، ${v.vs_price_pct < 0 ? "−" : "+"}${fa(Math.abs(v.vs_price_pct))}٪` : ""}، {v.near?.near ? `${fa(v.near.near)} فروشگاه نزدیک` : `${fa(v.shop_count)} فروشگاه`}</div></div>
                  <button className="btn sec" style={{ minHeight: 36, padding: "0 12px", fontSize: 12.5 }} onClick={() => onChallenge(v.product_id)}>مقایسه با این</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
