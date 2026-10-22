"use client";
// After the visit (canvas F9): did the shop have it, at that price? One tap. The answer goes to every other shopper's view of the shop
// and to its reliability score. Then the mission closes with what the shopper paid against the typical price.
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { fa, mil, money, parseNum } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { Bidi, Note } from "@/components/ui";
import { Shell } from "./chrome";
import { Progress } from "./MissionCard";
import type { StageProps } from "./stage";

const stamp = () => Date.now();

export default function DoneStage(sp: StageProps) {
  const { m, status, set, go, patchSlots } = sp;
  const { sid } = useSession();
  const qc = useQueryClient();
  const live = status.items.filter((x) => x.ripeness >= 3).sort((a, b) => Number(b.ripeness === 4) - Number(a.ripeness === 4) || (a.q.answer?.price ?? 9e12) - (b.q.answer?.price ?? 9e12));
  const [shopId, setShopId] = useState<string | null>(m.done?.shopId ?? null);
  const [pick, setPick] = useState<"same" | "diff" | "none" | null>(null);
  const [price, setPrice] = useState("");
  const chosen = live.find((x) => x.q.shop?.shop_id === shopId) ?? live[0];
  const listedPrice = chosen?.q.answer?.price ?? null;

  const send = useMutation({
    mutationFn: (o: { found: boolean; same: boolean | null; paid: number | null }) => api.report({ session_id: sid, shop_id: chosen!.q.shop!.shop_id, product_id: m.productId!, kind: "visit", available: o.found,
      price_matched: o.found ? o.same : null, price: o.found && o.same === false ? o.paid : null, inquiry_id: chosen!.q.id }),
    onSuccess: (_, o) => {
      set({ done: { shopId: chosen!.q.shop!.shop_id, paid: o.paid, found: o.found, at: stamp() } });
      qc.invalidateQueries({ queryKey: ["pshops-all"] });
    },
  });
  const choose = (k: "same" | "diff" | "none") => {
    setPick(k);
    if (k === "same") send.mutate({ found: true, same: true, paid: listedPrice });
    if (k === "none") send.mutate({ found: false, same: null, paid: null });
  };
  const done = m.done;
  const paid = done?.paid ?? null;
  const median = m.product?.price_median ?? null;
  const diff = paid && median ? median - paid : null;
  const shopName = live.find((x) => x.q.shop?.shop_id === done?.shopId)?.q.shop?.name ?? chosen?.q.shop?.name;

  const opts: ["same" | "diff" | "none", string][] = [["same", "بله، همان قیمت"], ["diff", "بود، ولی قیمت دیگری گفتند"], ["none", "نبود"]];
  const body = done ? (
    <div className="stack" style={{ gap: 12 }}>
      <div className="mc-card" style={{ padding: 20, gap: 14 }}>
        <div className="mc-label">{done.found === false ? "کالا نبود" : "خرید تمام شد"}</div>
        <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.4 }}>{done.found === false ? <>کالا در {shopName} نبود</> : <><Bidi text={m.product?.title ?? m.query} /> را از {shopName} گرفتید</>}</div>
        <Progress stage={3} finished />
        {done.found !== false && (
          <div className="facts">
            <div className="fact ok"><span className="xs">پرداختی</span><b>{paid ? money(paid) : "ثبت نشد"}</b></div>
            {diff != null && diff !== 0 && <div className={`fact ${diff > 0 ? "ok" : "bad"}`}><span className="xs">{diff > 0 ? "کمتر از میانه" : "بیشتر از میانه"}</span><b>{money(Math.abs(diff))}</b></div>}
            {median && <div className="fact unk"><span className="xs">قیمت میانه</span><b>{mil(median)}</b></div>}
          </div>
        )}
      </div>
      <Note tone="ok" icon="check">ثبت شد. حالا کارت {shopName} برای همه می‌گوید «خریدار تأیید کرد، همین الان».</Note>
      {done.found === false && <button className="btn sec block" onClick={() => { set({ done: null }); setPick(null); go("go"); }}>سراغ فروشگاه جایگزین برو</button>}
    </div>
  ) : (
    <div className="stack" style={{ gap: 12 }}>
      <div className="mc-card" style={{ padding: 18, gap: 12 }}>
        <div className="b" style={{ fontSize: 17 }}>کالا بود؟ با همان قیمت؟</div>
        <div className="xs muted" style={{ lineHeight: 1.7 }}>فقط یک ضربه؛ جواب شما به بقیهٔ خریدارها هم کمک می‌کند.</div>
        {live.length > 1 && (
          <label className="stack" style={{ gap: 4 }}><span className="xs faint">از کدام فروشگاه؟</span>
            <select className="sel-shop" value={chosen?.q.shop?.shop_id} onChange={(e) => setShopId(e.target.value)}>
              {live.map((x) => <option key={x.q.id} value={x.q.shop!.shop_id}>{x.q.shop!.name}</option>)}
            </select></label>
        )}
        {live.length === 1 && <div className="xs faint">فروشگاه: <b>{chosen.q.shop!.name}</b>{listedPrice ? `، قیمت تأییدشده ${money(listedPrice)}` : ""}</div>}
        {!chosen && <Note tone="unk" icon="store">هنوز فروشگاهی تأیید نکرده؛ به مرحلهٔ تأیید برگردید.</Note>}
        {chosen && opts.map(([k, l]) => (
          <button key={k} type="button" className={`pickbtn ${pick === k ? "on" : ""}`} aria-pressed={pick === k} disabled={send.isPending} onClick={() => choose(k)}>{l}</button>
        ))}
        {pick === "diff" && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="field" style={{ minHeight: 46 }}><label htmlFor="real-price" className="sr">قیمت واقعی</label><input id="real-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="قیمتی که گفت" /><span className="xs faint">تومان</span></div>
            <button className="btn pri block" disabled={!price || send.isPending} onClick={() => send.mutate({ found: true, same: false, paid: parseNum(price) })}>ثبت</button>
          </div>
        )}
        {send.isPending && <span className="toolline"><span className="spin" />در حال ثبت…</span>}
        {send.isError && <Note tone="bad" icon="alert">{(send.error as Error).message}</Note>}
      </div>
    </div>
  );

  const cta = done ? <Link className="btn pri" href="/">خرید تازه</Link> : <button className="btn sec" onClick={() => go("go")}>برگشت به مسیر</button>;
  return <Shell {...sp} patch={patchSlots} center={<div className="mc-main"><div className="mc-pad stack" style={{ gap: 12, paddingTop: 8 }}>{body}</div></div>} cta={cta} />;
  void fa;
}
