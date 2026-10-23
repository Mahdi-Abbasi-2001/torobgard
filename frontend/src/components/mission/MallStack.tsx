"use client";
// Arrival (board 4): the mall as a stack of floors. The floors rise one by one, yours lights up and slides out of the stack, its units
// appear and yours pulses with its neighbours named, and the hold code card flips in. It is a simple layout drawn from the floor and
// unit numbers the data has; it is NOT the mall's real floor plan (nothing indoors, no escalators or entrances), and it says so.
import { useEffect, useMemo, useState } from "react";
import type { MallDirectory } from "@/lib/api";
import { fa, floorLabel } from "@/lib/fa";
import { Icon } from "@/components/Icon";
import { Bidi, Sheet } from "@/components/ui";

const num = (s: string | null | undefined) => { const n = parseInt(String(s ?? "").replace(/\D/g, ""), 10); return Number.isFinite(n) ? n : null; };
export type StackTarget = { shopId: string; name: string; mall: string | null; floor: number | null; floorLabel: string | null; unit: string | null; plaque: string | null; hold?: { code: string; until: string | null } | null };

export function MallStack({ mall, t, replay }: { mall?: MallDirectory; t: StackTarget; replay: number }) {
  const [stage, setStage] = useState(0); // 0 rising, 1 your floor lit, 2 your floor out with its units
  useEffect(() => {
    const a = setTimeout(() => setStage(1), 1800), b = setTimeout(() => setStage(2), 3000);
    return () => { clearTimeout(a); clearTimeout(b); setStage(0); };
  }, [replay]);

  const mine = num(t.unit) ?? num(t.plaque);
  const floors = useMemo(() => {
    const all = (mall?.floors ?? []).filter((f) => f.floor != null).sort((a, b) => a.floor! - b.floor!);
    if (!all.length) return t.floor == null ? [] : [t.floor - 1, t.floor, t.floor + 1].map((f) => ({ floor: f, label: f === 0 ? "همکف" : `طبقه ${f}`, shops: [] as MallDirectory["floors"][number]["shops"] }));
    const at = Math.max(0, all.findIndex((f) => f.floor === t.floor));
    const from = Math.max(0, Math.min(at - 2, all.length - 6));
    return all.slice(from, from + 6);
  }, [mall, t.floor]);
  const here = floors.find((f) => f.floor === t.floor);
  const sorted = (here?.shops ?? []).map((s) => ({ s, n: num(s.unit) ?? num(s.plaque) })).filter((x) => x.n != null).sort((a, b) => a.n! - b.n!);
  const idx = Math.max(0, sorted.findIndex((x) => x.s.shop_id === t.shopId));
  const start = Math.max(0, Math.min(idx - 5, sorted.length - 12));
  const cells = sorted.length ? sorted.slice(start, start + 12) : [];
  const neighbours = mine == null ? [] : sorted.filter((x) => x.s.shop_id !== t.shopId).sort((a, b) => Math.abs(a.n! - mine) - Math.abs(b.n! - mine)).slice(0, 2);
  const tIdx = Math.max(0, floors.findIndex((f) => f.floor === t.floor));

  if (t.floor == null || floors.length === 0) return <div className="note unk"><Icon n="q" s /><span>طبقهٔ این فروشگاه ثبت نشده؛ از نگهبان یا تابلوی ورودی بپرسید.</span></div>;

  return (
    <div className="ms">
      <div className="ms-stage" key={replay} aria-hidden="true">
        <div className="ms-plane">
          {floors.map((f, i) => {
            const isMe = i === tIdx;
            const cls = `ms-slab${isMe && stage >= 1 ? " lit" : ""}${isMe && stage >= 2 ? " out" : ""}${stage >= 1 && !isMe ? (i > tIdx ? " far" : " dim") : ""}`;
            return (
              <div key={f.floor} className={cls} style={{ ["--z" as string]: `${i * 46}px`, ["--d" as string]: `${i * 0.16}s` }}>
                <span className="ms-name">{f.floor === 0 ? "همکف" : floorLabel(f.label)}</span>
                {isMe && stage >= 2 && cells.length > 0 && (
                  <div className="ms-units">
                    {cells.map((c) => <div key={c.s.shop_id} className={c.s.shop_id === t.shopId ? "me" : ""}>{c.n != null ? fa(c.n) : ""}</div>)}
                  </div>
                )}
                {isMe && stage >= 2 && cells.length === 0 && (t.unit || t.plaque) && <div className="ms-units one"><div className="me">{fa(t.unit ?? t.plaque)}</div></div>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="ms-info">
        <span className="xs faint">{mall ? `${t.mall ?? mall.mall} ${fa(floors.length)}${mall.floors.length > floors.length ? "+" : ""} طبقه` : t.mall}</span>
        <b className="ms-title">{stage < 1 ? "دارم طبقه‌ها را می‌چینم…" : stage < 2 ? floorLabel(t.floorLabel) ?? "طبقه" : [floorLabel(t.floorLabel), t.unit ? `واحد ${fa(t.unit)}` : t.plaque ? `پلاک ${fa(t.plaque)}` : null].filter(Boolean).join("، ")}</b>
        {stage >= 2 && <span className="xs muted">{neighbours.length ? <>کنار <Bidi text={neighbours.map((n) => n.s.name).join(" و ")} />. اگر گم شدید، اسم یکی‌شان را از نگهبان بپرسید.</> : "اگر گم شدید، نام فروشگاه را از نگهبان یا فروشنده‌های اطراف بپرسید."}</span>}
      </div>
    </div>
  );
}

export function ArrivalSheet({ open, onClose, mall, t }: { open: boolean; onClose: () => void; mall?: MallDirectory; t: StackTarget }) {
  const [replay, setReplay] = useState(0);
  return (
    <Sheet open={open} onClose={onClose} label="طبقه و واحد" className="tall">
      <div className="row between"><div><div className="mc-label">رسیدید؛ حالا کدام طبقه؟</div><div className="b" style={{ fontSize: 17 }}><Bidi text={t.name} /></div></div>
        <button className="iconbtn soft" onClick={onClose} aria-label="بستن"><Icon n="x" /></button></div>
      {open && <MallStack mall={mall} t={t} replay={replay} />}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn sec grow" onClick={() => setReplay((x) => x + 1)}><Icon n="refresh" s />دوباره نشان بده</button>
      </div>
      <span className="xs faint">طرح ساده از روی طبقه و شمارهٔ واحدها؛ نقشهٔ داخلی واقعی پاساژ نیست (جای پله، آسانسور و ورودی‌ها را نداریم).</span>
    </Sheet>
  );
}
