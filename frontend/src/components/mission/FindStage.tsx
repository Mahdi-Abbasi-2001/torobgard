"use client";
// Steps 2 and 3 (canvas F3 + F4 / D3): where the shops are and which of them to ask. The map shows price pins, the one-trip hub and a
// time scrubber that re-judges every shop's opening hours; the shortlist compares the chosen shops. Phone: map first, then the list;
// desktop: the map stays in the middle and the list sits beside it.
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ShopCard, type ShopFilters } from "@/lib/api";
import { fa } from "@/lib/fa";
import { useIsDesktop } from "@/lib/media";
import type { Mission } from "@/lib/mission";
import { Icon } from "@/components/Icon";
import { ShopMap } from "@/components/ShopMap";
import { WhereToLook } from "@/components/WhereToLook";
import { ZonesCard } from "@/components/discover";
import { Bidi, Empty, ErrorState, Note } from "@/components/ui";
import { AskSheet, useAsk } from "./AskSheet";
import { ComparePanel } from "./ComparePanel";
import { MallSheet } from "./MallSheet";
import { ModeChips, WhenScrubber } from "./Scrubber";
import { ShopSheet } from "./ShopSheet";
import { Shell } from "./chrome";
import type { StageProps } from "./stage";

const BASE_KEYS = ["stock", "price"];
const seedPicks = (listed: ShopCard[]) => {
  const ok = listed.filter((s) => s.open.state !== "closed");
  return (ok.length >= 2 ? ok : listed).slice(0, 4).map((s) => s.shop_id);
};
const filtersOf = (m: Mission): ShopFilters => ({ installment: m.cond.installment, open_now: m.cond.open, radius_km: m.cond.near ? 1.2 : null, sort: "best", priority: m.priority });

export default function FindStage(sp: StageProps) {
  const { m, view, set, go, patchSlots } = sp;
  const desk = useIsDesktop();
  const pid = m.productId!;
  const [shopId, setShopId] = useState<string | null>(null);
  const [mallKey, setMallKey] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [onlyShop, setOnlyShop] = useState<string | null>(null);
  const [warn, setWarn] = useState("");
  const [hov, setHov] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["fshops", pid, m.place.lat, m.place.lon, m.when, m.cond, m.priority], placeholderData: keepPreviousData,
    queryFn: () => api.productShops(pid, m.place, filtersOf(m), 40, m.when),
  });
  const d = q.data;
  const listed = useMemo(() => d?.listed ?? [], [d]);
  const cat = useMemo(() => d?.category_only ?? [], [d]);
  const pq = useQuery({ queryKey: ["pquestions", pid], queryFn: () => api.productQuestions(pid), staleTime: Infinity }); // warm for the ask sheet
  const ask = useAsk(m);

  // first time shops load: pick the best open ones so the shortlist is never empty
  const seeded = useRef(m.picks.length > 0);
  useEffect(() => { if (d && !seeded.current && listed.length) { seeded.current = true; set({ picks: seedPicks(listed) }); } }, [d, listed, set]);

  const toggle = (id: string) => {
    if (m.picks.includes(id)) { set({ picks: m.picks.filter((x) => x !== id) }); return; }
    if (m.picks.length >= 5) { setWarn("حداکثر ۵ فروشگاه؛ برای افزودن، یکی را حذف کنید."); setTimeout(() => setWarn(""), 2500); return; }
    set({ picks: [...m.picks, id] });
  };
  const zone = d?.zones?.[0];
  const hubs = zone && zone.lat != null && zone.lon != null ? [{
    key: zone.key, lat: zone.lat, lon: zone.lon, shopIds: zone.shop_ids, dim: zone.open_count === 0 && m.when !== "now",
    title: `${fa(zone.open_count || zone.shop_count)} فروشگاه`, sub: zone.open_count || m.when === "now" ? fa(zone.name) : `${fa(zone.name)}، بسته`,
  }] : undefined;
  const hitIds = useMemo(() => new Set(listed.map((s) => s.shop_id)), [listed]);

  const askNow = () => {
    const chosen = [...listed, ...cat].filter((s) => m.picks.includes(s.shop_id));
    const custom = pq.data?.custom.slice(0, 1) ?? [];
    ask.mutate({ shopIds: chosen.map((s) => s.shop_id), keys: [...BASE_KEYS, ...(chosen.some((s) => s.tier === "category_only") ? ["hours"] : []), ...custom.map((c) => c.key)],
      custom: Object.fromEntries(custom.map((c) => [c.key, c.text])), mode: "waves", timeout: 300 }, { onSuccess: () => go("confirm") });
  };

  const noShops = !!d && listed.length === 0;
  const few = !!d && listed.length > 0 && listed.length < 3;

  const conds = (
    <div className="hscroll cond-row" role="group" aria-label="شرایط خرید">
      {([["installment", "قسطی", "card"], ["open", "هنگام رسیدن باز باشد", "clock"], ["near", "نزدیک من", "walk"]] as const).map(([k, l, ic]) => (
        <button key={k} type="button" className={`chip ${m.cond[k] ? "on" : ""}`} aria-pressed={m.cond[k]} onClick={() => patchSlots({ cond: { ...m.cond, [k]: !m.cond[k] } })}><Icon n={m.cond[k] ? "check" : ic} s />{l}</button>
      ))}
    </div>
  );

  const map = d && listed.length + cat.length > 0 ? (
    <ShopMap origin={m.place} listed={listed} cat={cat.slice(0, 12)} selected={m.picks} onPick={toggle} hover={hov} onHover={setHov}
      hubs={hubs} onHub={(key) => { if (!key.startsWith("~")) setMallKey(key); }} height={desk ? "100%" : 300} />
  ) : q.isLoading ? <div className="sk" style={{ height: desk ? "100%" : 300, borderRadius: 18 }} aria-busy="true" /> : null;

  const timeCard = (
    <div className="mc-card scrub-card">
      <WhenScrubber when={m.when} onChange={(w) => patchSlots({ when: w })} compact={!desk} />
      <ModeChips mode={m.mode} onChange={(mode) => patchSlots({ mode })} />
      {m.mode === "car" && <Note tone="warn" icon="alert">بازار مرکزی داخل طرح ترافیک است؛ بدون مجوز نمی‌شود با ماشین رفت.</Note>}
    </div>
  );

  const hubCard = d?.zones && d.zones.length > 0 ? <ZonesCard zones={d.zones} onFocus={(z) => set({ picks: z.shop_ids.slice(0, 5) })} /> : null;

  const empty = noShops ? <NoShops sp={sp} catCount={cat.length} /> : null;
  const compare = <ComparePanel m={m} set={set} listed={listed} onShop={setShopId} />;
  const askCta = (
    <>
      <button className="btn pri" disabled={!m.picks.length || ask.isPending} onClick={askNow}>
        {ask.isPending ? <span className="spin" style={{ borderTopColor: "var(--on-accent)" }} /> : <Icon n="spark" s />}از فروشنده‌ها بپرس
      </button>
      <div className="mc-links"><button type="button" onClick={() => { setOnlyShop(null); setAskOpen(true); }} disabled={!m.picks.length}>سؤال‌ها را ببینید یا تغییر دهید</button></div>
      {ask.isError && <Note tone="bad" icon="alert">{(ask.error as Error).message}</Note>}
      <div className="hint">موجودی، قیمت امروز و ساعت کاری را یک‌جا می‌پرسیم</div>
    </>
  );

  const sheets = (
    <>
      <ShopSheet shopId={shopId} productId={pid} onClose={() => setShopId(null)} onMall={(k) => setMallKey(k)}
        onAsk={(id) => { setOnlyShop(id); setShopId(null); setAskOpen(true); }} />
      <MallSheet mallKey={mallKey} hits={hitIds} onClose={() => setMallKey(null)} onShop={(id) => setShopId(id)} />
      <AskSheet open={askOpen} onClose={() => setAskOpen(false)} m={m} shops={[...listed, ...cat]} only={onlyShop} onSent={() => go("confirm")} />
      {warn && <div className="toast" role="status"><Icon n="alert" />{warn}</div>}
    </>
  );

  if (desk) {
    return (
      <>
        <Shell {...sp} patch={patchSlots} mapStage slotsCount={listed.length}
          center={
            <>
              <div className="map-fill">{q.isError ? <ErrorState error={q.error} retry={() => q.refetch()} /> : empty ?? map}</div>
              <div className="map-top">{conds}</div>
              {!noShops && <div className="map-bottom">{timeCard}</div>}
            </>
          }
          panel={<div className="stack" style={{ gap: 12 }}>{few && <FewNote go={go} n={listed.length} />}{hubCard}{noShops ? null : compare}</div>}
          cta={noShops ? undefined : askCta} />
        {sheets}
      </>
    );
  }
  return (
    <>
      <Shell {...sp} patch={patchSlots} slotsCount={listed.length}
        center={
          <div className="mc-main">
            {view === "compare" ? (
              <div className="mc-pad stack" style={{ gap: 12 }}>
                {compare}
                <div className="mc-links"><button type="button" onClick={() => go("find")}>برگشت به نقشه</button></div>
              </div>
            ) : (
              <>
                {conds}
                {q.isError ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
                {empty ?? <div className="mc-pad">{map}</div>}
                {!noShops && <div className="mc-pad stack" style={{ gap: 12 }}>{timeCard}{few && <FewNote go={go} n={listed.length} />}{hubCard}</div>}
              </>
            )}
          </div>
        }
        cta={noShops ? undefined : view === "compare" ? askCta : (
          <button className="btn pri" disabled={!listed.length} onClick={() => go("compare")}>مقایسهٔ این فروشگاه‌ها</button>
        )} />
      {sheets}
    </>
  );
}

function FewNote({ go, n }: { go: (v: "decide") => void; n: number }) {
  return (
    <Note tone="unk" icon="store">
      فقط {fa(n)} فروشگاه این مدل را ثبت کرده. <button type="button" style={{ background: "none", border: 0, padding: 0, color: "var(--accent-ink)", fontWeight: 700 }} onClick={() => go("decide")}>مدل یا نسخهٔ دیگری را هم ببینید</button>
    </Note>
  );
}

/** Nobody lists this model near you: loosen one condition at a time, or see where such shops are (canvas S4). */
function NoShops({ sp, catCount }: { sp: StageProps; catCount: number }) {
  const { m, patchSlots } = sp;
  const relax: { label: string; patch: Partial<Mission> }[] = [];
  if (m.cond.near) relax.push({ label: "«نزدیک من» را حذف کن", patch: { cond: { ...m.cond, near: false } } });
  if (m.cond.open) relax.push({ label: "«هنگام رسیدن باز باشد» را حذف کن", patch: { cond: { ...m.cond, open: false } } });
  if (m.cond.installment) relax.push({ label: "«قسطی» را حذف کن", patch: { cond: { ...m.cond, installment: false } } });
  if (m.when !== "now" && !relax.length) relax.push({ label: "زمان را «الان» کن", patch: { when: "now" } });
  const counts = useQueries({ queries: relax.map((r) => ({
    queryKey: ["frelax", m.productId, r.label, m.when, m.place.lat, JSON.stringify(m.cond)],
    queryFn: () => api.productShops(m.productId!, m.place, filtersOf({ ...m, ...r.patch } as Mission), 40, (r.patch.when as string | undefined) ?? m.when).then((x) => x.counts.listed),
  })) });
  return (
    <div className="stack" style={{ gap: 10 }}>
      <Empty icon="store" title={relax.length ? "هیچ فروشگاهی همهٔ این شرایط را ندارد" : "نزدیک شما فروشگاهی این کالا را ثبت نکرده"}>
        {relax.length ? "یکی از شرط‌ها را کنار بگذارید؛ تعداد نتیجه‌ها کنار هر کدام آمده است." : "فروشگاه‌های این دسته را می‌توانید بپرسید."}
      </Empty>
      <div className="mc-pad stack" style={{ gap: 8 }}>
        {relax.map((r, i) => (
          <button key={r.label} className="card row between" style={{ padding: "12px 14px" }} onClick={() => patchSlots(r.patch)}>
            <span className="sm">{r.label}</span>
            <span className="sm b" style={{ color: "var(--accent-ink)" }}>{counts[i]?.data != null ? `${fa(counts[i].data!)} فروشگاه` : <span className="spin" />} <Icon n="fwd" s /></span>
          </button>
        ))}
        {catCount > 0 && <Note tone="unk" icon="q">{fa(catCount)} فروشگاه در این دسته فعالیت دارند؛ می‌توانید بپرسید این مدل را دارند یا نه. «دسته» یعنی «شاید دارد»، نه «حتماً دارد».</Note>}
        <div className="xs faint"><Bidi text={m.product?.title ?? ""} /></div>
      </div>
      <WhereToLook q={m.product?.category ?? m.query} category={m.product?.category} />
    </div>
  );
}
