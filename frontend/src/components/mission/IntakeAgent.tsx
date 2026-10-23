"use client";
// The intake agent's card. It reads what the shopper wrote, checks it against the real catalogue (you see each check as it happens),
// fills the mission's slots and asks only what it cannot know, with tap-able answers. It runs again after every answer until nothing
// important is open; then one tap starts the mission. Used on the start screen and, when a search finds nothing exact, inside a mission.
import { useCallback, useEffect, useRef, useState } from "react";
import { fa } from "@/lib/fa";
import { kmFromTehran, outsideTehran, type Place } from "@/lib/geo";
import { streamIntake } from "@/lib/chat";
import type { IntakeQuestion, IntakeResult } from "@/lib/api";
import type { Mission } from "@/lib/mission";
import { useSession } from "@/lib/session";
import { Icon, Radish } from "@/components/Icon";
import { Bidi, Note } from "@/components/ui";
import { budgetLabel, MODE_LABEL, whenText } from "./slots";

type Msg = { role: "user" | "agent"; text: string };
export type IntakeSeed = { text: string; slots?: Record<string, unknown>; pinned?: string[]; context?: string };

/** What the agent decided, as the fields of a mission. Anything it left open stays as the caller had it. */
export function intakeToMission(r: IntakeResult, gps: Place | null): Partial<Mission> {
  const s = r.slots, out: Partial<Mission> = { brief: r.summary || null };
  if (s.query) out.query = s.query;
  if (s.category !== undefined) out.category = s.category;
  if (s.need !== undefined) out.need = s.need;
  if (s.budget) { out.budgetMin = s.budget.min; out.budgetMax = s.budget.max; }
  if (gps) out.place = gps;
  else if (s.place) out.place = { label: s.place.label, lat: s.place.lat, lon: s.place.lon, source: "area" };
  if (s.when) out.when = s.when;
  if (s.mode) out.mode = s.mode;
  out.cond = { installment: s.conditions.installment, open: s.conditions.open, near: false };
  return out;
}

/** What the agent already settled, in the shape it reads back, so an answer adds to it instead of starting over. */
function slotsOf(r: IntakeResult, base?: Record<string, unknown>): Record<string, unknown> {
  const s = r.slots;
  return { ...base, ...(s.query && { query: s.query }), ...(s.category && { category: s.category }), ...(s.need && { need: s.need }), ...(s.budget && { budget: s.budget }),
    ...(s.place && { place: s.place.label }), ...(s.when && { when: s.when }), ...(s.mode && { mode: s.mode }), conditions: s.conditions };
}

export function IntakeAgent({ seed, onReady, onEdit, cta = "شروع کن" }: { seed: IntakeSeed; onReady: (r: IntakeResult, gps: Place | null) => void; onEdit?: () => void; cta?: string }) {
  const { sid } = useSession();
  const [convo, setConvo] = useState<Msg[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({}); // answers chosen so far, by question; sent together
  const [gps, setGps] = useState<Place | null>(null);
  const [far, setFar] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const started = useRef(false);

  const run = useCallback(async (messages: Msg[], prev?: IntakeResult | null) => {
    abort.current?.abort();
    const ac = new AbortController(); abort.current = ac;
    setBusy(true); setError(null); setSteps([]);
    try {
      await streamIntake({ session_id: sid || "anon", messages, slots: prev ? slotsOf(prev, seed.slots) : seed.slots ?? {}, pinned: seed.pinned ?? [] }, (e) => {
        if (e.type === "status") setSteps((s) => [...s, e.text]);
        else if (e.type === "result") setResult(e);
        else if (e.type === "error") setError(e.message);
      }, ac.signal);
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message);
    } finally { if (!ac.signal.aborted) setBusy(false); }
  }, [sid, seed.slots, seed.pinned]);


  useEffect(() => {
    if (started.current || !sid) return;
    started.current = true;
    const first: Msg[] = [{ role: "user", text: seed.context ? `${seed.context}\n${seed.text}` : seed.text }];
    setConvo(first); run(first);
  }, [sid, seed.text, seed.context, run]);
  // leaving aborts the call; the guard is released too, so a dev-mode remount starts the run again instead of hanging
  useEffect(() => () => { abort.current?.abort(); started.current = false; }, []);

  const answer = (q: IntakeQuestion, text: string) => {
    if (busy) return;
    if (q.slot === "place" && text === "موقعیت فعلی من") { locate(q); return; }
    choose(q, text);
  };
  // one tap picks an answer; when every open question has one they all go to the agent in a single turn
  const choose = (q: IntakeQuestion, text: string) => {
    const now = { ...picked, [q.text]: text };
    setPicked(now);
    if ((result?.questions ?? []).every((x) => now[x.text])) submit(now);
  };
  const submit = (answers: Record<string, string>) => {
    const pairs = Object.entries(answers).flatMap(([q, a]) => [{ role: "agent" as const, text: q }, { role: "user" as const, text: a }]);
    if (!pairs.length) return;
    const next: Msg[] = [...convo, ...pairs];
    setConvo(next); setTyped(""); setPicked({}); run(next, result);
  };
  const send = (question: string | null, text: string) => submit({ ...picked, ...(question ? { [question]: text } : {}) });
  const locate = (q: IntakeQuestion) => {
    if (!("geolocation" in navigator)) { setFar(-1); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const here = { lat: p.coords.latitude, lon: p.coords.longitude };
        if (outsideTehran(here)) { setFar(Math.round(kmFromTehran(here))); return; } // never pretend a start point outside Tehran
        setFar(null); setGps({ ...here, label: "موقعیت فعلی شما", source: "gps" });
        choose(q, "از موقعیت فعلی‌ام شروع می‌کنم");
      },
      () => setFar(-1), { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 },
    );
  };

  const s = result?.slots;
  const chips: [string, string][] = s ? [
    ["کالا", s.query ?? ""], ["برای", s.need ?? ""], ["بودجه", budgetLabel(s.budget?.min ?? null, s.budget?.max ?? null) ?? ""],
    ["از کجا", gps ? "موقعیت فعلی شما" : s.place?.label ?? ""], ["چه ساعتی", s.when ? whenText(s.when) : ""], ["با", s.mode ? MODE_LABEL[s.mode] : ""],
  ].filter((x): x is [string, string] => !!x[1]) : [];
  const open = result?.questions ?? [];
  const assumed = (result?.assumed ?? []).map((k) => ({ when: "الان", mode: "پیاده", place: "مرکز تهران", budget: "بدون محدودیت بودجه", need: "بدون نیاز خاص" }[k])).filter(Boolean);

  return (
    <section className="agent-card" aria-label="دستیار ترب‌گرد" aria-live="polite">
      <div className="agent-head"><Radish size={26} /><b>ترب‌گرد</b><span className="tb info">دستیار</span>{result?.engine === "rules" && <span className="tb unk">تحلیل ساده</span>}</div>
      {(busy || steps.length > 0) && (
        <ul className="agent-steps">
          {steps.map((t, i) => <li key={i} className={busy && i === steps.length - 1 ? "now" : "done"}>{busy && i === steps.length - 1 ? <span className="spin" /> : <Icon n="check" s />}{t}</li>)}
          {busy && steps.length === 0 && <li className="now"><span className="spin" />دارم جمله‌تان را می‌خوانم…</li>}
        </ul>
      )}
      {error && <Note tone="bad" icon="alert">{error}</Note>}
      {result && !busy && (
        <div className="stack" style={{ gap: 10 }}>
          {result.summary && <div className="agent-sum"><Bidi text={fa(result.summary)} /></div>}
          {chips.length > 0 && <div className="mc-slots">{chips.map(([k, v]) => <span key={k} className="slot"><span className="k">{k}</span><Bidi text={fa(v)} /></span>)}</div>}
          {assumed.length > 0 && <div className="xs muted">فرض کردم: {assumed.join("، ")}. اگر این‌طور نیست، بعداً عوضش کنید.</div>}
          {open.map((q) => (
            <div key={q.text} className="agent-q">
              <div className="b sm">{fa(q.text)}</div>
              {q.options.length > 0 && <div className="wrapr">{q.options.map((o) => <button key={o} type="button" className={`chip ${picked[q.text] === o || (o === "موقعیت فعلی من" && gps && q.slot === "place") ? "on" : ""}`} aria-pressed={picked[q.text] === o} onClick={() => answer(q, o)}>{o === "موقعیت فعلی من" && <Icon n="loc" s />}<Bidi text={fa(o)} /></button>)}</div>}
            </div>
          ))}
          {far != null && <Note tone="warn" icon="pin">{far > 0 ? `به نظر می‌رسد در تهران نیستید؛ حدود ${fa(far)} کیلومتر با تهران فاصله دارید. یکی از محله‌ها را انتخاب کنید یا بنویسید کجا می‌روید.` : "به موقعیت شما دسترسی نداریم؛ یکی از محله‌ها را انتخاب کنید."}</Note>}
          {open.length > 0 && (
            <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (typed.trim()) send(open[0].text, typed.trim()); }}>
              <div className="field grow" style={{ minHeight: 44 }}><label htmlFor="intake-reply" className="sr">جواب شما</label><input id="intake-reply" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={open[0].options.length ? "یا خودتان بنویسید…" : open.length > 1 ? "جواب سؤال اول را اینجا بنویسید…" : "جوابتان را اینجا بنویسید…"} maxLength={200} /></div>
              <button className="iconbtn" style={{ background: "var(--accent)", color: "var(--on-accent)", borderRadius: 12 }} aria-label="ارسال" disabled={!typed.trim()}><Icon n="send" s /></button>
            </form>
          )}
          {!result.exact && open.length === 0 && <Note tone="unk" icon="q">«{result.slots.query}» را دقیقاً در فروشگاه‌ها پیدا نکردم؛ نزدیک‌ترین‌ها را نشان می‌دهم.</Note>}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn pri grow" onClick={() => (Object.keys(picked).length ? submit(picked) : onReady(result, gps))}>{Object.keys(picked).length ? "ثبت جواب‌ها" : open.length ? "همین‌ها خوب است؛ ادامه" : cta}</button>
            {onEdit && <button type="button" className="btn sec" onClick={onEdit}>ویرایش جمله</button>}
          </div>
        </div>
      )}
    </section>
  );
}
