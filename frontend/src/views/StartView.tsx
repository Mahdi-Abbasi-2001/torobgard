"use client";
// New mission (canvas F1 / D1): one sentence becomes a mission. The slots it understood are shown at once and each can be changed;
// a photo of a price tag or "just browsing" are two other ways in to the same mission.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ParsedMission } from "@/lib/api";
import { fa } from "@/lib/fa";
import { useIsDesktop } from "@/lib/media";
import { blankMission, useMissions, type Mission } from "@/lib/mission";
import { useSession } from "@/lib/session";
import { useInquiries } from "@/lib/useInquiries";
import { Icon } from "@/components/Icon";
import { SnapButton } from "@/components/SnapButton";
import { Bidi, OfflineBanner } from "@/components/ui";
import { MissionBar, missionHref } from "@/components/mission/chrome";
import { MissionCard } from "@/components/mission/MissionCard";
import { SlotsSheet, type SlotsPatch } from "@/components/mission/SlotsSheet";
import { slotsOf, type SlotKey } from "@/components/mission/slots";
import type { Place } from "@/lib/geo";

const EXAMPLES = [
  "هندزفری گردنی برای ورزش، تا ۳٫۵ میلیون، نزدیک علاالدین، عصر",
  "گوشی سامسونگ ۱۰ تا ۱۵ میلیون، قسطی، فردا ساعت ۱۱",
  "دوربین مداربسته ۴ کانال، اطراف فردوسی",
];

export default function StartView() {
  const router = useRouter();
  const desk = useIsDesktop();
  const { state, update, sid } = useSession();
  const { missions, create, ready } = useMissions();
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [over, setOver] = useState<SlotsPatch>({});
  const [slots, setSlots] = useState<{ open: boolean; focus: SlotKey | null }>({ open: false, focus: null });
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(text.trim()), 350); return () => clearTimeout(t); }, [text]);

  const parsed = useQuery({ queryKey: ["mparse", debounced], queryFn: () => api.missionParse(debounced), enabled: debounced.length > 1, staleTime: Infinity, placeholderData: keepPreviousData });
  const p: ParsedMission | undefined = text.trim() ? parsed.data : undefined;
  const cats = useQuery({ queryKey: ["topcats"], queryFn: () => api.topCategories(10) });
  const malls = useQuery({ queryKey: ["malls"], queryFn: () => api.malls(5), enabled: desk });
  const inq = useInquiries(sid, { live: false });

  // the draft mission: what was read from the sentence, then the shopper's own edits, then this device's usual place / time / way
  const draft: Mission = useMemo(() => {
    const parsedPlace: Place | null = p?.place ? { label: p.place.label, lat: p.place.lat, lon: p.place.lon, source: "area" } : null;
    return blankMission({
      text: text.trim(), query: p?.query ?? (text.trim() && !p ? text.trim() : ""), category: p?.category ?? null, need: over.need !== undefined ? over.need : p?.need ?? null,
      budgetMin: over.budgetMin !== undefined ? over.budgetMin : p?.budget?.min ?? null, budgetMax: over.budgetMax !== undefined ? over.budgetMax : p?.budget?.max ?? null,
      cond: { installment: over.cond?.installment ?? p?.conditions.installment ?? false, open: over.cond?.open ?? p?.conditions.open ?? false, near: over.cond?.near ?? false },
      place: over.place ?? parsedPlace ?? state.place, when: over.when ?? p?.when ?? state.when, mode: over.mode ?? p?.mode ?? state.mode,
    });
  }, [p, over, text, state.place, state.when, state.mode]);

  const begin = (m: Mission) => {
    const made = create(m);
    update((s) => ({ ...s, place: made.place, when: made.when, mode: made.mode, locationAsked: s.locationAsked || made.place.source !== "default" }));
    router.push(missionHref(made.id));
  };
  const start = () => { if (draft.query || draft.text) begin({ ...draft, query: draft.query || draft.text }); };
  const browse = (category: string) => begin(blankMission({ text: category, query: category, category, place: state.place, when: state.when, mode: state.mode }));

  const list = ready ? missions.slice(0, desk ? 3 : 2) : [];
  const recent = inq.items.filter((i) => i.kind === "ask" && (i.status === "answered" || i.status === "unavailable") && i.shop && i.product).slice(0, 4);
  const sl = slotsOf(draft);
  const understood = p?.understood ?? [];
  const ok = (k: SlotKey) => (k === "product" ? understood.includes("product") : k === "need" ? understood.includes("need") : k === "budget" ? understood.includes("budget") : k === "place" ? understood.includes("place") : k === "when" ? understood.includes("when") : k === "mode" ? understood.includes("mode") : false);

  return (
    <div className="mc">
      <MissionBar />
      <div className="mc-body two">
        {desk && (
          <aside className="mc-aside" aria-label="مأموریت‌های در جریان">
            <div className="b" style={{ fontSize: 15 }}>در جریان</div>
            {list.length ? list.map((m) => <MissionCard key={m.id} m={m} compact />) : <span className="xs faint">هنوز مأموریتی ندارید؛ یکی شروع کنید.</span>}
            {recent.length > 0 && (
              <>
                <div className="b" style={{ fontSize: 15, marginTop: 6 }}>تازه‌ها</div>
                <div className="stack" style={{ gap: 0 }}>
                  {recent.map((i) => (
                    <div key={i.id} className="row" style={{ gap: 10, padding: "9px 0", borderBottom: "1px solid var(--line)", alignItems: "flex-start" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, marginTop: 8, flex: "0 0 auto", background: i.status === "answered" ? "var(--accent)" : "var(--ink-3)" }} />
                      <span className="sm">{i.shop!.name}{i.status === "answered" ? " تأیید کرد" : " ندارد"}، <Bidi text={i.product!.title.slice(0, 26)} /></span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </aside>
        )}
        <main className="mc-center mc-main" style={{ paddingTop: desk ? 0 : 8 }}>
          <OfflineBanner />
          <div className={desk ? "mc-card" : "mc-pad"} style={desk ? { padding: "36px 40px", gap: 18, borderRadius: 28 } : { display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="stack" style={{ gap: 6 }}>
              <h1 style={{ margin: 0, fontSize: desk ? 36 : 26, fontWeight: 800, lineHeight: 1.3, textWrap: "balance" }}>امروز دنبال چه هستید؟</h1>
              <p className="lede" style={{ fontSize: desk ? 16 : 14 }}>یک جمله بنویسید. ترب‌گرد آن را مأموریت می‌کند و تا رسیدن به مغازه همراهتان است.</p>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <label htmlFor="errand" className="xs b muted">مأموریت</label>
              <div className="field" style={{ alignItems: "flex-start", borderColor: "var(--accent)", borderWidth: 2, padding: "6px 14px" }}>
                <textarea id="errand" ref={field} rows={2} value={text} onChange={(e) => { setText(e.target.value); setOver({}); }} placeholder="مثلاً: هندزفری گردنی برای ورزش، تا ۳٫۵ میلیون، نزدیک علاالدین، عصر"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); start(); } }} style={{ fontSize: desk ? 17 : 15 }} />
              </div>
            </div>
            <div className="mc-card" style={{ padding: 14, gap: 10, background: desk ? "var(--paper)" : "var(--card)" }}>
              <div className="mc-label">{text.trim() ? "ترب‌گرد این‌طور فهمید؛ هر کدام را لمس کنید تا عوض شود" : "تنظیمات پیش‌فرض شما؛ هر کدام را می‌توانید عوض کنید"}</div>
              <div className={`slot-rows ${desk ? "start-slots" : ""}`}>
                {sl.filter((s) => s.key !== "cond" || !s.open).map((s) => (
                  <button key={s.key} type="button" className={`slot-row ${s.key === "product" || s.key === "need" || s.key === "budget" || s.key === "cond" ? (s.open ? "open" : "") : ""}`} onClick={() => (s.key === "product" || s.key === "need" ? field.current?.focus() : setSlots({ open: true, focus: s.key }))}>
                    <span className="k">{s.label}{ok(s.key) ? " ✓" : ""}</span>
                    <span className="v">{s.value ? <Bidi text={fa(s.value)} /> : s.key === "product" ? "اینجا بنویسید" : "باز؛ بعداً با هم انتخاب می‌کنیم"}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <SnapButton className="btn sec grow" label="عکس برچسب قیمت یا کالا"><Icon n="cam" s />عکس برچسب قیمت</SnapButton>
              <button type="button" className="btn sec grow" onClick={() => (cats.data?.items[0] ? document.getElementById("browse")?.scrollIntoView({ behavior: "smooth", block: "center" }) : field.current?.focus())}><Icon n="search" s />فقط می‌خواهم بگردم</button>
            </div>
            {desk && <button className="btn pri" style={{ minHeight: 56, fontSize: 17, borderRadius: 18 }} disabled={!text.trim()} onClick={start}>مأموریت را شروع کن</button>}
          </div>

          <div className={desk ? "" : "mc-pad"} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="stack" style={{ gap: 8 }}>
              <span className="xs faint">نمونه‌ها را امتحان کنید</span>
              <div className="wrapr">{EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => { setText(e); setOver({}); field.current?.focus(); }}>{e}</button>)}</div>
            </div>
            <div id="browse" className="stack" style={{ gap: 8 }}>
              <div className="h4">فقط می‌گردم</div>
              <div className="wrapr">
                {cats.data?.items.map((c) => <button key={c.name} className="chip" onClick={() => browse(c.name)}>{c.name} <span className="xs faint">{fa(c.multi_shop_products)}</span></button>)}
              </div>
            </div>
            {desk && malls.data && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="h4">پاساژهای پرفروشنده</div>
                <div className="wrapr">{malls.data.items.map((mm) => <Link key={mm.mall_key} href={`/mall/${encodeURIComponent(mm.mall_key)}`} className="chip">{fa(mm.mall)} <span className="xs faint">{fa(mm.shop_count)} فروشگاه</span></Link>)}</div>
              </div>
            )}
            {!desk && list.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="h4">مأموریت‌های من</div>
                {list.map((m) => <MissionCard key={m.id} m={m} />)}
              </div>
            )}
          </div>
        </main>
        {!desk && <div className="mc-cta"><button className="btn pri" disabled={!text.trim()} onClick={start}>مأموریت را شروع کن</button></div>}
      </div>
      <SlotsSheet open={slots.open} onClose={() => setSlots({ open: false, focus: null })} value={draft} onChange={(patch) => setOver((o) => ({ ...o, ...patch, cond: patch.cond ? { ...(o.cond ?? draft.cond), ...patch.cond } : o.cond }))} focus={slots.focus} cta="تأیید" />
    </div>
  );
}
