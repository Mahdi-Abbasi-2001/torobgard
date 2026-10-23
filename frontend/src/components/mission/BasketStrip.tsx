"use client";
// Every trip has a basket; a single item is a basket of one. The strip shows the trip's items (tap one to switch to it), lets you add another
// at any time («+ کالا»), and, once two items have a model chosen, plans the whole basket as one trip.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fa, mil } from "@/lib/fa";
import { spreeOf, useAddItem, useMissions, useSpree, type Mission } from "@/lib/mission";
import { useMissionStatus } from "@/lib/useMissionStatus";
import { Icon } from "@/components/Icon";
import { BasketTrip, ITEM_COLORS } from "@/components/BasketTrip";
import { Bidi, Sheet } from "@/components/ui";
import { missionHref, missionTitle } from "./chrome";
import { asMissionProduct, shortName } from "./DecideStage";

function ItemChip({ it, n, on }: { it: Mission; n: number; on: boolean }) {
  const st = useMissionStatus(it, { live: false });
  const dot = st.finished ? "ok" : st.held ? "held" : st.confirmed > 0 ? "ok" : st.asked > 0 ? "ask" : "";
  const title = missionTitle(it);
  return (
    <Link href={missionHref(it.id)} className={`bs-chip ${on ? "on" : ""}`} aria-current={on ? "page" : undefined}>
      <i style={{ background: ITEM_COLORS[(n - 1) % ITEM_COLORS.length] }}>{fa(n)}</i>
      <span className="t"><Bidi text={title.length > 22 ? shortName({ title, brand: it.product?.brand ?? null }).slice(0, 22) : title} /></span>
      {dot && <span className={`d ${dot}`} aria-label={dot === "held" ? "نگه داشته" : dot === "ok" ? "تأیید شد" : "پرسیده شد"} />}
    </Link>
  );
}

export function AddItemSheet({ open, onClose, from }: { open: boolean; onClose: () => void; from: Mission }) {
  const add = useAddItem();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (open) Promise.resolve().then(() => { setQ(""); setAdded(null); }); }, [open]);
  const sug = useQuery({ queryKey: ["add-sug", dq, from.place.lat, from.place.lon], enabled: open && dq.length >= 2, staleTime: 60_000, queryFn: () => api.search({ q: dq, limit: 6 }, from.place) });
  return (
    <Sheet open={open} onClose={onClose} label="کالای دیگر" className="tall">
      <div className="row between"><div><div className="mc-label">به همین سفر</div><div className="b" style={{ fontSize: 17 }}>یک کالای دیگر هم بخرید</div></div>
        <button className="iconbtn soft" onClick={onClose} aria-label="بستن"><Icon n="x" /></button></div>
      <div className="field" style={{ minHeight: 50 }}><label htmlFor="add-q" className="sr">کالا</label>
        <input id="add-q" value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder="مثلاً: قاب گوشی، شارژر…"
          onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { const it = add(from, { query: q.trim() }); setAdded(it.query); setQ(""); } }} /></div>
      {added && <span className="xs" style={{ color: "var(--ok)" }}>«{added}» به سفر اضافه شد. می‌توانید کالای دیگری هم اضافه کنید.</span>}
      {dq.length >= 2 && sug.data && (
        <div className="stack" style={{ gap: 6 }}>
          {sug.data.items.length === 0 && <span className="xs faint">چیزی پیدا نشد؛ Enter را بزنید تا همین نوشته اضافه شود.</span>}
          {sug.data.items.map((p) => (
            <button key={p.product_id} type="button" className="card row between" style={{ padding: "10px 14px", textAlign: "start" }}
              onClick={() => { add(from, { query: shortName(p), product: asMissionProduct(p) }); setAdded(shortName(p)); setQ(""); }}>
              <span className="stack" style={{ gap: 2, minWidth: 0 }}><b className="sm"><Bidi text={shortName(p)} /></b><span className="xs faint">{p.price_min != null ? `از ${mil(p.price_min)}، ` : ""}{fa(p.shop_count)} فروشگاه</span></span>
              <span className="chip on"><Icon n="plus" s />اضافه</span>
            </button>
          ))}
        </div>
      )}
      <span className="xs faint">هر کالا مرحله‌های خودش را دارد (مدل، فروشگاه، تأیید)، و مسیر برای کل سبد با هم چیده می‌شود.</span>
    </Sheet>
  );
}

export function BasketStrip({ m }: { m: Mission }) {
  const { ready } = useMissions();
  const items = useSpree(m);
  const [addOpen, setAddOpen] = useState(false);
  const [tripOpen, setTripOpen] = useState(false);
  const chosen = items.filter((i) => i.productId && i.product);
  if (!ready) return null;
  return (
    <div className="bs" aria-label="سبد این سفر" data-spree={spreeOf(m)}>
      {items.length > 1 && items.map((it, i) => <ItemChip key={it.id} it={it} n={i + 1} on={it.id === m.id} />)}
      <button type="button" className="bs-add" onClick={() => setAddOpen(true)}><Icon n="plus" s />{items.length > 1 ? "کالا" : "کالای دیگر هم می‌خواهم"}</button>
      {chosen.length >= 2 && <button type="button" className="bs-trip" onClick={() => setTripOpen(true)}><Icon n="route" s />مسیر کل سبد</button>}
      <AddItemSheet open={addOpen} onClose={() => setAddOpen(false)} from={m} />
      <Sheet open={tripOpen} onClose={() => setTripOpen(false)} label="مسیر کل سبد" className="tall">
        <div className="row between"><div><div className="mc-label">یک سفر برای کل سبد</div><div className="b" style={{ fontSize: 17 }}>کمترین توقف برای {fa(chosen.length)} کالا</div></div>
          <button className="iconbtn soft" onClick={() => setTripOpen(false)} aria-label="بستن"><Icon n="x" /></button></div>
        {tripOpen && <BasketTrip items={chosen.map((i) => ({ productId: i.productId!, title: shortName({ title: i.product!.title, brand: i.product!.brand }) }))} />}
      </Sheet>
    </div>
  );
}
