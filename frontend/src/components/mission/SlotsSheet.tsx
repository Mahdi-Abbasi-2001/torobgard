"use client";
// "Where and conditions": every slot of a mission in one sheet (canvas S5). Used on the start screen (editing the sentence's slots)
// and inside a mission (every change re-runs the search for the same errand).
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fa, parseNum } from "@/lib/fa";
import { AREAS, kmFromTehran, outsideTehran, type Place } from "@/lib/geo";
import type { Mission, Mode } from "@/lib/mission";
import { Icon } from "@/components/Icon";
import { Note, Sheet, Toggle } from "@/components/ui";
import { MODE_LABEL, type SlotInput, type SlotKey } from "./slots";

const PinMap = dynamic(() => import("@/components/PinMap"), { ssr: false, loading: () => <div className="map lmap" style={{ height: 240 }} aria-busy="true" /> });

const WHEN: [string, string][] = [["now", "الان"], ["1h", "یک ساعت دیگر"], ["evening", "امروز عصر"], ["20:00", "امشب"], ["tomorrow", "فردا صبح"]];
export type SlotsPatch = Partial<Pick<Mission, "need" | "budgetMin" | "budgetMax" | "cond" | "place" | "when" | "mode">>;

export function SlotsSheet({ open, onClose, value, onChange, focus, count, cta = "نشانم بده", only }: {
  open: boolean; onClose: () => void; value: SlotInput; onChange: (p: SlotsPatch) => void; focus?: SlotKey | null;
  /** shops that pass the current conditions (known once a product is chosen) */
  count?: number | null; cta?: string;
  /** show just one part: «place» is the start-point picker on its own (the first page) */
  only?: "place";
}) {
  const [status, setStatus] = useState<"idle" | "asking" | "denied">("idle");
  const [far, setFar] = useState<number | null>(null);
  const locate = () => {
    if (!("geolocation" in navigator)) { setStatus("denied"); return; }
    setStatus("asking");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const here = { lat: p.coords.latitude, lon: p.coords.longitude };
        setStatus("idle");
        if (outsideTehran(here)) { setFar(Math.round(kmFromTehran(here))); return; } // not a starting point for Tehran shops: say so, never pretend
        setFar(null);
        onChange({ place: { ...here, label: "موقعیت فعلی شما", source: "gps" } });
      },
      () => setStatus("denied"), { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 },
    );
  };
  const areas = useQuery({ queryKey: ["areas"], queryFn: () => api.areas(), staleTime: Infinity, enabled: open });
  const [q, setQ] = useState("");
  const [map, setMap] = useState(false);
  const [clock, setClock] = useState("");
  useEffect(() => { if (open && focus) setTimeout(() => document.getElementById(`slot-${focus}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 80); }, [open, focus]);

  const list: (Place & { n?: number })[] = areas.data?.items.length
    ? areas.data.items.map((a) => ({ label: a.label, lat: a.lat, lon: a.lon, source: "area" as const, n: a.shop_count }))
    : AREAS;
  const shown = list.filter((a) => !q.trim() || a.label.includes(q.trim())).slice(0, q.trim() ? 30 : 10);
  const cur = value.place;
  const num = (v: string) => (v.trim() ? parseNum(v) : null);

  return (
    <Sheet open={open} onClose={onClose} label={only ? "از کجا شروع می‌کنید؟" : "محل، زمان و شرایط"}>
      <h2>{only ? "از کجا شروع می‌کنید؟" : "محل، زمان و شرایط"}</h2>

      <section id="slot-place" className="mc-sect" aria-label="کجا">
        {!only && <span className="b sm">از کجا شروع می‌کنید؟</span>}
        {far != null && <Note tone="warn" icon="pin">به نظر می‌رسد در تهران نیستید؛ حدود {fa(far)} کیلومتر با تهران فاصله دارید. ترب‌گرد فقط فروشگاه‌های تهران را دارد؛ محله‌ای را که می‌خواهید در آن خرید کنید انتخاب کنید تا مسیر و زمان رسیدن از همان‌جا حساب شود.</Note>}
        {status === "denied" && <Note tone="warn" icon="pin">به موقعیت شما دسترسی نداریم. محله را انتخاب کنید یا روی نقشه بزنید.</Note>}
        <div className="wrapr">
          <button type="button" className="chip" style={{ minHeight: 44 }} onClick={() => locate()} disabled={status === "asking"}>
            {status === "asking" ? <span className="spin" /> : <Icon n="loc" s />}مکان فعلی من
          </button>
          <button type="button" className={`chip ${map ? "on" : ""}`} style={{ minHeight: 44 }} onClick={() => setMap(!map)}><Icon n="map" s />انتخاب از روی نقشه</button>
        </div>
        <span className="xs faint">یا یکی از محله‌هایی که در ترب فروشگاه دارند</span>
        <div className="field" style={{ minHeight: 44 }}><Icon n="search" s /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی محله، مثلاً تجریش" aria-label="جستجوی محله" /></div>
        <div className="wrapr" role="radiogroup" aria-label="محله‌ها">
          {shown.map((a) => (
            <button key={a.label} type="button" role="radio" aria-checked={cur.label === a.label} className={`chip ${cur.label === a.label ? "on" : ""}`} onClick={() => onChange({ place: { label: a.label, lat: a.lat, lon: a.lon, source: "area" } })}>
              {cur.label === a.label && <Icon n="check" s />}{a.label}{a.n ? <span className="xs faint">{fa(a.n)}</span> : null}
            </button>
          ))}
        </div>
        {map && <PinMap lat={cur.lat} lon={cur.lon} onPick={(lat, lon) => onChange({ place: { lat, lon, label: "نقطهٔ انتخابی روی نقشه", source: "pin" } })} />}
        <span className="xs faint">الان: <b>{cur.source === "default" ? "مرکز تهران، حافظ × جمهوری (پیش‌فرض)" : cur.label}</b></span>
      </section>

      {!only && (
        <>
      <section id="slot-when" className="mc-sect" aria-label="کی و چطور">
        <span className="b sm">چه ساعتی می‌رسید؟ باز یا بسته بودن فروشگاه‌ها برای همان ساعت حساب می‌شود</span>
        <div className="wrapr">{WHEN.map(([v, l]) => <button key={v} type="button" className={`chip ${value.when === v ? "on" : ""}`} style={{ minHeight: 42 }} onClick={() => onChange({ when: v })}>{l}</button>)}</div>
        <label className="row xs muted" style={{ gap: 8 }}>یا ساعت دقیق:
          <input type="time" value={clock} onChange={(e) => { setClock(e.target.value); if (e.target.value) onChange({ when: e.target.value }); }} style={{ minHeight: 36 }} />
        </label>
        <span id="slot-mode" className="b sm" style={{ marginTop: 6 }}>با چه وسیله‌ای؟</span>
        <div className="seg" role="radiogroup" aria-label="وسیله">
          {(["walk", "taxi", "car"] as Mode[]).map((k) => <button key={k} type="button" role="radio" aria-checked={value.mode === k} className={value.mode === k ? "on" : ""} onClick={() => onChange({ mode: k })}>{MODE_LABEL[k]}</button>)}
        </div>
        {value.mode === "car" && <Note tone="warn" icon="alert">بازار مرکزی داخل طرح ترافیک است؛ بدون مجوز نمی‌شود با ماشین رفت. زمان‌ها با پارک حساب شده‌اند.</Note>}
      </section>

      <section id="slot-budget" className="mc-sect" aria-label="بودجه">
        <span className="b sm">بودجه (تومان)</span>
        <div className="row" style={{ gap: 8 }}>
          <div className="field grow" style={{ minHeight: 44 }}><label className="sr" htmlFor="bmin">از</label><input id="bmin" inputMode="numeric" placeholder="از" defaultValue={value.budgetMin ? String(value.budgetMin) : ""} onBlur={(e) => onChange({ budgetMin: num(e.target.value) })} /></div>
          <div className="field grow" style={{ minHeight: 44 }}><label className="sr" htmlFor="bmax">تا</label><input id="bmax" inputMode="numeric" placeholder="تا" defaultValue={value.budgetMax ? String(value.budgetMax) : ""} onBlur={(e) => onChange({ budgetMax: num(e.target.value) })} /></div>
        </div>
      </section>

      <section id="slot-cond" className="mc-sect" aria-label="شرایط خرید">
        {([["near", "نزدیک من", "تا ۱۵ دقیقه راه، با وسیله‌ای که انتخاب کرده‌اید"], ["open", "هنگام رسیدن باز باشد", "طبق ساعتی که گفتید"], ["installment", "فروشندهٔ قسطی", "فقط فروشگاه‌هایی که قسط اعلام کرده‌اند"]] as const).map(([k, l, h]) => (
          <div key={k} className="frow" style={{ borderBottom: "1px solid var(--line)" }}>
            <span className="stack" style={{ gap: 0 }}><span className="sm b">{l}</span><span className="xs faint">{h}</span></span>
            <Toggle on={value.cond[k]} onChange={(v) => onChange({ cond: { ...value.cond, [k]: v } })} label={l} />
          </div>
        ))}
      </section>
        </>
      )}

      <div className="sheet-foot"><button className="btn pri block" onClick={onClose}>{cta}{count != null ? `، ${fa(count)} فروشگاه` : ""}</button></div>
    </Sheet>
  );
}
