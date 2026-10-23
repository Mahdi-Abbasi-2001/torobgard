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
import { Icon } from "@/components/Icon";
import { Bidi, Note } from "@/components/ui";

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

export function IntakeAgent({ seed, onReady, onEdit, cta = "شروع کن", autoOption = false }: { seed: IntakeSeed; onReady: (r: IntakeResult, gps: Place | null, auto: boolean) => void; onEdit?: () => void; cta?: string; autoOption?: boolean }) {
  const { sid } = useSession();
  const [convo, setConvo] = useState<Msg[]>([]);
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
    setBusy(true); setError(null);
    try {
      await streamIntake({ session_id: sid || "anon", messages, slots: prev ? slotsOf(prev, seed.slots) : seed.slots ?? {}, pinned: seed.pinned ?? [] }, (e) => {
        if (e.type === "result") setResult(e);
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

  const open = result?.questions ?? [];
  // on the start screen nothing is left to ask: go straight on to the products instead of a card with only buttons
  const advanced = useRef(false);
  useEffect(() => {
    if (busy) { advanced.current = false; return; }
    if (autoOption && result && !error && open.length === 0 && !advanced.current) { advanced.current = true; onReady(result, gps, true); }
  }, [autoOption, result, busy, error, open.length]); // eslint-disable-line react-hooks/exhaustive-deps -- once per answer

  return (
    <section className="agent-card" aria-label="دستیار ترب‌گرد" aria-live="polite">
      {busy && <div className="agent-wait"><span className="spin" />یک لحظه…</div>}
      {error && <Note tone="bad" icon="alert">{error}</Note>}
      {result && !busy && (
        <div className="stack" style={{ gap: 10 }}>
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
            <button type="button" className="btn pri grow" style={{ flexBasis: "100%" }} onClick={() => (Object.keys(picked).length ? submit(picked) : onReady(result, gps, autoOption))}>{Object.keys(picked).length ? "ثبت جواب‌ها" : open.length ? "رد شدن؛ همهٔ کالاها را نشان بده" : autoOption ? "کالاها را نشانم بده" : cta}</button>
            {onEdit && <button type="button" className="btn sec" onClick={onEdit}>تغییر جمله</button>}
          </div>
        </div>
      )}
    </section>
  );
}
