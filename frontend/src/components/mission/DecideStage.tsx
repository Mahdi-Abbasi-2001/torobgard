"use client";
// Step 1 (canvas F2 / D2): which model? Two models face off on the shopper's own need; they tap the one they prefer and the next
// challenger comes in. Only the rows that matter are shown, the winner of each is marked, unknowns say «نامشخص».
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, type Preset, type Product } from "@/lib/api";
import { duelRows, nextChallenger, type DuelRow } from "@/lib/duel";
import { fa, mil } from "@/lib/fa";
import { useIsDesktop } from "@/lib/media";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { WhereToLook } from "@/components/WhereToLook";
import { Bidi, Empty, ErrorState, Note, Sheet, Thumb } from "@/components/ui";
import { fitsNeed } from "@/lib/need";
import { IntakeAgent, intakeToMission } from "./IntakeAgent";
import { Shell } from "./chrome";
import { ProductDetails } from "./ProductDetails";
import type { StageProps } from "./stage";

const norm = (s: string) => s.replace(/ی$/, "").replace(/\s+/g, "");
/** the need preset that matches the words the shopper used («ورزش» ↔ «ورزشی») */
const matchNeed = (presets: Preset[] | undefined, need: string | null) =>
  need && presets ? presets.find((p) => norm(p.label).includes(norm(need)) || norm(need).includes(norm(p.label)) || p.why.includes(need)) ?? null : null;
export const shortName = (p: { title: string; brand: string | null }) => {
  const i = p.title.indexOf(" مدل ");
  const after = i > 0 ? p.title.slice(i + 5).trim() : "";
  // «… مدل 2021» ends in a bare number: that says nothing, so fall back to the opening words of the title
  return after.length >= 5 && /[A-Za-z\u0600-\u06FF]/.test(after) ? `${p.brand ?? ""} ${after}`.trim() : p.title.split(" ").slice(0, 4).join(" ");
};
const asMissionProduct = (p: Product) => ({ product_id: p.product_id, title: p.title, image: p.image, brand: p.brand, category: p.category, price_min: p.price_min, price_median: p.price_median, price_max: p.price_max, shop_count: p.shop_count });

export default function DecideStage(sp: StageProps) {
  const { m, set, go, patchSlots } = sp;
  const desk = useIsDesktop();
  const { state } = useSession();
  const [sheet, setSheet] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [showAll, setShowAll] = useState(false); // «none is made for that need»: the shopper may still look at everything

  const presets = useQuery({ queryKey: ["presets", m.category], queryFn: () => api.presets(m.category!), enabled: !!m.category, staleTime: Infinity });
  const auto = m.presetId === null ? matchNeed(presets.data?.presets, m.need) : null;
  const preset = presets.data?.presets.find((x) => x.id === (m.presetId === null ? auto?.id : m.presetId)) ?? null;
  const waitPresets = !!m.category && presets.isLoading;

  const res = useQuery({
    queryKey: ["dsearch", m.query, m.category, m.budgetMin, m.budgetMax, preset?.id ?? null, m.cond, m.when, m.place.lat, m.place.lon],
    queryFn: () => api.search({ q: m.query, category: m.category ?? undefined, price_min: m.budgetMin, price_max: m.budgetMax, limit: 30 }, m.place,
      { prefs: preset?.constraints, near_only: m.cond.near, installment_only: m.cond.installment, open_only: m.cond.open, sort: preset?.sort ?? null, when: m.when }),
    placeholderData: keepPreviousData, enabled: !waitPresets && !!m.query,
  });
  // in-person shopping is about availability: among models that fit equally well, the ones more shops near you have come first
  // (a partial match keeps the server's relevance order: stock must not push unrelated products up)
  // «for a boy» hides what is clearly for girls; if nothing else is left the full list stays and says so
  const found = useMemo(() => res.data?.items ?? [], [res.data]);
  const forNeed = useMemo(() => found.filter((p) => fitsNeed(p.title, m.need)), [found, m.need]);
  const hidden = forNeed.length ? found.length - forNeed.length : 0, noneForNeed = found.length > 0 && forNeed.length === 0;
  const pool = useMemo(() => (forNeed.length ? forNeed : showAll ? found : []), [forNeed, showAll, found]);
  const items = useMemo(() => (res.data?.applied.relaxed ? [...pool] : [...pool].sort((a, b) =>
    (b.fit_score ?? 0) - (a.fit_score ?? 0) || (b.near?.near ?? 0) - (a.near?.near ?? 0) || b.shop_count - a.shop_count)), [res.data, pool]);
  const relaxed = !!res.data?.applied.relaxed;
  // only an exact match says which category the shopper means; a partial one is a guess
  useEffect(() => { if (!m.category && !relaxed && items[0]?.category) set({ category: items[0].category }); }, [m.category, relaxed, items, set]);

  // models the assistant suggested join the duel first
  const missing = m.extras.filter((id) => !items.some((x) => x.product_id === id)).slice(0, 3);
  const extra = useQueries({ queries: missing.map((id) => ({ queryKey: ["product", id], queryFn: () => api.product(id) })) });
  const all: Product[] = [...extra.flatMap((q) => (q.data ? [q.data as Product] : [])), ...items];
  const lead = all.find((x) => x.product_id === m.champion) ?? all.find((x) => x.product_id === m.productId) ?? all[0] ?? null;
  const challenger = lead ? nextChallenger(all, lead.product_id, m.beaten, m.extras) : null;
  const total = Math.max(1, Math.min(all.length - 1, 5));
  // a duel needs models that several shops list; one-off listings (clothes, decor...) are browsed and picked directly
  const browse = !!res.data && items.length > 0 && (relaxed || items.slice(0, 12).filter((p) => p.shop_count >= 3).length < 3);
  const needText = preset?.label ?? m.need;

  const cmp = useQuery({ queryKey: ["dcmp", lead?.product_id, challenger?.product_id], queryFn: () => api.compare([lead!.product_id, challenger!.product_id], m.place), enabled: !!lead && !!challenger, staleTime: 5 * 60_000 });
  const verdict = useQuery({
    queryKey: ["dverdict", lead?.product_id, challenger?.product_id, needText], retry: 0, staleTime: Infinity, enabled: !!lead && !!challenger,
    queryFn: () => api.compareVerdict([lead!.product_id, challenger!.product_id], needText, m.place),
  });
  const rows: DuelRow[] = lead && challenger ? duelRows(lead, challenger, cmp.data) : [];

  const choose = (p: Product) => { set({ productId: p.product_id, product: asMissionProduct(p), champion: p.product_id, picks: [], extras: [] }); go("find"); };
  const next = () => challenger && set((x) => ({ champion: lead!.product_id, beaten: [...x.beaten, challenger.product_id], extras: x.extras.filter((e) => e !== challenger.product_id) }));
  const swap = () => challenger && set((x) => ({ champion: challenger.product_id, beaten: [...x.beaten, lead!.product_id], extras: x.extras.filter((e) => e !== challenger.product_id) }));
  const showDetails = (id: string) => (desk ? setFocus(id) : setSheet(id));
  const detailId = focus ?? lead?.product_id ?? null;

  const pickPreset = (id: string) => set({ presetId: preset?.id === id ? "" : id, beaten: [], champion: null });

  const Card = ({ p, leader }: { p: Product; leader: boolean }) => (
    <div className={`duel-card ${leader ? "lead" : ""}`}>
      <button type="button" className="duel-hit" onClick={() => showDetails(p.product_id)} aria-label={`جزئیات ${p.title}`}>
        <Thumb src={p.image} alt="" size={desk ? 96 : "100%"} h={desk ? 96 : 92} brand={p.brand} />
        <span className="duel-name"><Bidi text={shortName(p)} /></span>
        <span className="duel-price">{p.price_min != null ? <>{p.price_max && p.price_max !== p.price_min ? `${mil(p.price_min)} تا ${mil(p.price_max)}` : mil(p.price_min)}</> : "قیمت نامشخص"}</span>
        <span className="xs faint">{fa(p.shop_count)} فروشگاه{p.near?.near ? `، ${fa(p.near.near)} تایش نزدیک شماست` : ""}</span>
      </button>
      {!leader && <button type="button" className="duel-pref" onClick={swap}>این را می‌پسندم</button>}
    </div>
  );

  const body = (
    <div className="mc-main">
      <div className="mc-pad row between" style={{ alignItems: "flex-end", marginTop: desk ? 0 : 4 }}>
        {browse ? <div><div className="xs faint">{fa(items.length)} نتیجه</div><h2 style={{ margin: 0, fontSize: desk ? 26 : 19, fontWeight: 800 }}>یکی را انتخاب کنید</h2></div> :
        <div><div className="xs faint">{challenger ? `مقایسهٔ ${fa(Math.min(m.beaten.length + 1, total))} از ${fa(total)}` : "پیشنهاد ما"}</div>
          <h2 style={{ margin: 0, fontSize: desk ? 26 : 19, fontWeight: 800 }}>{challenger ? (needText ? `برای ${needText}، کدام بهتر است؟` : "کدام بهتر است؟") : "گزینهٔ برتر شما"}</h2>{challenger && m.beaten.length > 0 && <div className="xs muted" style={{ marginTop: 2 }}>الان در صدر: <Bidi text={shortName(lead!)} /></div>}</div>}
      </div>

      {presets.data && presets.data.presets.length > 0 && (
        <div className="mc-pad wrapr" role="group" aria-label="نیاز شما">
          {presets.data.presets.slice(0, 6).map((x) => <button key={x.id} type="button" className={`chip ${preset?.id === x.id ? "on" : ""}`} aria-pressed={preset?.id === x.id} title={x.why} onClick={() => pickPreset(x.id)}>{x.label}</button>)}
        </div>
      )}

      {hidden > 0 && <div className="mc-pad"><Note tone="unk" icon="alert">{fa(hidden)} کالای مخصوص جنس دیگر کنار گذاشته شد تا فقط مناسب «{m.need}» ببینید.</Note></div>}
      {noneForNeed && !showAll && (
        <div className="mc-pad stack" style={{ gap: 10 }}>
          <Empty icon="store" title={`کالایی مخصوص «${m.need}» پیدا نشد`}>در داده‌ها برای «{m.query}» فقط کالاهای مخصوص جنس دیگر یا نامشخص ثبت شده است. از ترب‌گرد بخواهید دقیق‌ترش کند، یا همه را ببینید و در فروشگاه چک کنید.</Empty>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn pri" onClick={() => setHelp(true)}><Icon n="spark" s />از ترب‌گرد کمک بگیر</button>
            <button type="button" className="btn sec" onClick={() => setShowAll(true)}>همه را نشان بده</button>
          </div>
        </div>
      )}
      {noneForNeed && showAll && <div className="mc-pad"><Note tone="warn" icon="alert">این‌ها مخصوص «{m.need}» نیستند؛ خودتان در فروشگاه چک کنید.</Note></div>}
      {relaxed && items.length > 0 && (
        <div className="mc-pad stack" style={{ gap: 8 }}>
          <Note tone="warn" icon="alert">عبارت «{m.query}» را دقیقاً پیدا نکردیم؛ این‌ها نزدیک‌ترین نتیجه‌ها هستند و شاید همان چیزی نباشند که می‌خواهید. دقیق‌ترش کنید:</Note>
          <button type="button" className="btn sec" style={{ alignSelf: "flex-start", minHeight: 42 }} onClick={() => setHelp(true)}><Icon n="spark" s />از ترب‌گرد کمک بگیر</button>
          <div className="wrapr">
            {m.query.split(/\s+/).filter(Boolean).length > 1 && m.query.split(/\s+/).filter(Boolean).map((w) => (
              <button key={w} type="button" className="chip" onClick={() => set({ query: m.query.split(/\s+/).filter((x) => x && x !== w).join(" "), beaten: [], champion: null })}>بدون «{w}»</button>
            ))}
            {(res.data?.facets.categories ?? []).slice(0, 4).map((c) => (
              <button key={c.name} type="button" className="chip" onClick={() => set({ category: c.name, presetId: null, beaten: [], champion: null })}>فقط «{c.name}»</button>
            ))}
          </div>
        </div>
      )}

      {(res.isLoading || waitPresets) && <div className="mc-pad stack" style={{ gap: 10 }} aria-busy="true"><div className="sk mc-skel" style={{ height: 200 }} /><div className="sk mc-skel" style={{ height: 150 }} /></div>}
      {res.isError && <ErrorState error={res.error} retry={() => res.refetch()} />}
      {res.data && !items.length && !res.isFetching && <NoResults sp={sp} />}

      {lead && !browse && (
        <>
          <div className={`mc-pad duel-grid ${challenger ? "" : "single"}`}>
            <Card p={lead} leader />
            {challenger && <Card p={challenger} leader={false} />}
          </div>
          {challenger && (
            <div className="mc-pad">
              <div className="duel-rows" role="table" aria-label="مقایسهٔ دو مدل">
                {rows.map((r) => (
                  <div key={r.key} role="row" className="duel-row">
                    <span role="cell" className={`v ${r.a.side}`}>{r.a.side === "win" && "✓ "}<Bidi text={r.a.text} /></span>
                    <span role="cell" className="k">{r.key}</span>
                    <span role="cell" className={`v b ${r.b.side}`}>{r.b.side === "win" && "✓ "}<Bidi text={r.b.text} /></span>
                  </div>
                ))}
                {cmp.isLoading && <div className="sk" style={{ height: 36, marginBlock: 8 }} />}
              </div>
            </div>
          )}
          {challenger && (
            <div className="mc-pad">
              {verdict.isLoading ? <div className="sk mc-skel" style={{ height: 56 }} />
                : verdict.data ? <div className="mc-verdict"><b>{fa(verdict.data.headline)}</b>{verdict.data.tradeoff ? <> {fa(verdict.data.tradeoff)}</> : verdict.data.reasons[0] ? <> {fa(verdict.data.reasons[0])}</> : null}</div> : null}
            </div>
          )}
          {!challenger && (
            <div className="mc-pad"><div className="mc-note">{all.length > 1 ? "همهٔ گزینه‌ها را دیدید." : "برای این جست‌وجو فقط یک مدل پیدا شد."}{" "}
              {m.beaten.length > 0 && <button type="button" className="mc-links" style={{ display: "inline", background: "none", border: 0, color: "var(--accent-ink)", fontWeight: 700 }} onClick={() => set({ beaten: [], champion: null })}>از اول مقایسه کن</button>}</div></div>
          )}
          {challenger && all.filter((x) => x.product_id !== lead.product_id && x.product_id !== challenger.product_id && !m.beaten.includes(x.product_id))[0] && (
            <div className="mc-pad mc-note">گزینهٔ بعدی: <Bidi text={shortName(all.filter((x) => x.product_id !== lead.product_id && x.product_id !== challenger.product_id && !m.beaten.includes(x.product_id))[0])} />{" "}
              <a href={`/compare?ids=${[lead.product_id, challenger.product_id, ...all.filter((x) => x.product_id !== lead.product_id && x.product_id !== challenger.product_id).slice(0, 2).map((x) => x.product_id)].join(",")}`} style={{ color: "var(--accent-ink)", fontWeight: 700 }}>مقایسهٔ کامل جدولی</a></div>
          )}
          {res.data && res.data.capped && <div className="mc-pad mc-note">فقط بهترین گزینه‌های این جست‌وجو بررسی شد.</div>}
        </>
      )}
      {browse && (
        <div className="mc-pad browse-list">
          {items.slice(0, 12).map((p) => (
            <div key={p.product_id} className="card browse-card">
              <button type="button" className="browse-hit" onClick={() => showDetails(p.product_id)} aria-label={`جزئیات ${p.title}`}>
                <Thumb src={p.image} alt="" size={64} brand={p.brand} />
                <span className="stack" style={{ gap: 2, minWidth: 0, textAlign: "start" }}>
                  <span className="b sm" style={{ lineHeight: 1.6 }}><Bidi text={p.title} /></span>
                  <span className="xs muted">{p.price_min != null ? `${mil(p.price_min)}` : "قیمت نامشخص"}، {fa(p.shop_count)} فروشگاه{p.near?.near ? `، ${fa(p.near.near)} تایش نزدیک شماست` : ""}</span>
                </span>
              </button>
              <button type="button" className="btn sec" style={{ minHeight: 42, fontSize: 14 }} onClick={() => choose(p)}>همین را می‌خواهم</button>
            </div>
          ))}
        </div>
      )}
      {desk && lead && !browse && <Actions />}
    </div>
  );

  function Actions() {
    return (
      <div className="mc-pad row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button className="btn pri grow" style={{ minHeight: 52, fontSize: 16 }} onClick={() => choose(lead!)}>{shortName(lead!)} را انتخاب می‌کنم</button>
        {challenger && <button className="btn sec" style={{ minHeight: 52 }} onClick={next}>گزینهٔ بعدی</button>}
      </div>
    );
  }

  return (
    <>
      <Shell {...sp} patch={patchSlots} mapStage={false}
        center={body}
        panel={desk && detailId ? <ProductDetails id={detailId} onChallenge={(id) => set((x) => ({ extras: [id, ...x.extras.filter((e) => e !== id)] }))} /> : undefined}
        cta={!desk && lead && !browse ? (
          <div className="mc-cta-row">
            <button className="btn pri" onClick={() => choose(lead)}>{shortName(lead)} را انتخاب می‌کنم</button>
            {challenger && <button className="btn sec" onClick={next}>گزینهٔ بعدی</button>}
          </div>
        ) : undefined}
        slotsCount={null} />
      <Sheet open={help} onClose={() => setHelp(false)} label="کمک ترب‌گرد" className="tall">
        {help && (
          <IntakeAgent seed={{ text: m.text || m.query, context: "نتیجهٔ دقیقی پیدا نشد؛ کمک کن درست‌ترش کنیم." }} cta="جست‌وجوی دوباره" onEdit={() => setHelp(false)}
            onReady={(r, gps) => { set({ ...intakeToMission(r, gps), beaten: [], champion: null, presetId: null }); setHelp(false); }} />
        )}
      </Sheet>
      <Sheet open={!desk && !!sheet} onClose={() => setSheet(null)} label="جزئیات کالا" className="tall">
        {sheet && <ProductDetails id={sheet} onClose={() => setSheet(null)} onChallenge={(id) => { set((x) => ({ extras: [id, ...x.extras.filter((e) => e !== id)] })); setSheet(null); }} />}
        {sheet && lead && <div className="sheet-foot"><button className="btn pri block" onClick={() => { const p = all.find((x) => x.product_id === sheet); if (p) choose(p); }}>همین را انتخاب می‌کنم</button></div>}
      </Sheet>
    </>
  );
  void state;
}

/** Nothing matched: loosen the errand one condition at a time (with how many each gives back), and say where such shops are. */
function NoResults({ sp }: { sp: StageProps }) {
  const { m, set } = sp;
  const relax: { label: string; patch: Partial<typeof m> }[] = [];
  if (m.budgetMax || m.budgetMin) relax.push({ label: "بودجه را حذف کن", patch: { budgetMin: null, budgetMax: null } });
  if (m.cond.installment || m.cond.open || m.cond.near) relax.push({ label: "شرط‌های خرید را حذف کن", patch: { cond: { installment: false, open: false, near: false } } });
  if (m.presetId) relax.push({ label: "نیاز را حذف کن", patch: { presetId: "", need: null } });
  const counts = useQueries({ queries: relax.map((r) => ({
    queryKey: ["relax", m.query, m.category, r.label, m.budgetMax, m.cond],
    queryFn: () => api.search({ q: m.query, category: m.category ?? undefined, price_min: "budgetMin" in r.patch ? r.patch.budgetMin : m.budgetMin, price_max: "budgetMax" in r.patch ? r.patch.budgetMax : m.budgetMax, limit: 1 }, m.place,
      { near_only: (r.patch.cond ?? m.cond).near, installment_only: (r.patch.cond ?? m.cond).installment, open_only: (r.patch.cond ?? m.cond).open, when: m.when }).then((x) => x.total),
  })) });
  return (
    <div className="stack" style={{ gap: 12 }}>
      <Empty icon="store" title="با این شرایط چیزی پیدا نشد">{relax.length ? "یکی از شرط‌ها را کنار بگذارید؛ تعداد نتیجه‌ها کنار هر کدام آمده است." : "نام کالا را کوتاه‌تر بنویسید، یا ببینید چنین فروشگاه‌هایی کجا هستند."}</Empty>
      <div className="mc-pad stack" style={{ gap: 8 }}>
        {relax.map((r, i) => (
          <button key={r.label} className="card row between" style={{ padding: "12px 14px" }} onClick={() => set({ ...r.patch, beaten: [], champion: null } as Partial<typeof m>)}>
            <span className="sm">{r.label}</span>
            <span className="sm b" style={{ color: "var(--accent-ink)" }}>{counts[i]?.data != null ? `${fa(counts[i].data!)} کالا` : <span className="spin" />} <Icon n="fwd" s /></span>
          </button>
        ))}
      </div>
      <WhereToLook q={m.query} category={m.category} />
    </div>
  );
}
