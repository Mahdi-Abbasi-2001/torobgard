"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type ShopCard } from "@/lib/api";
import { fa } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { AppBar, Bidi, Empty, ErrorState, Note, Seg, SkeletonCards, Steps } from "@/components/ui";

const DEFAULT_Q = ["stock", "price"];

export default function AskView({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { state, sid, togglePick } = useSession();
  const [edited, setQs] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  const [timeout, setTimeoutS] = useState(300);
  const p = useQuery({ queryKey: ["product", id], queryFn: () => api.product(id) });
  const shops = useQuery({ queryKey: ["pshops-all", id, state.place.lat], queryFn: () => api.productShops(id, state.place, { sort: "best" }, 100) });
  const questions = useQuery({ queryKey: ["questions"], queryFn: () => api.questions(), staleTime: Infinity });
  // product-aware questions (variant, original vs copy, registered...) from the product's specs
  const pq = useQuery({ queryKey: ["pquestions", id], queryFn: () => api.productQuestions(id), staleTime: Infinity });
  const custom = pq.data?.custom ?? [];
  const [mode, setMode] = useState<"direct" | "waves">("direct");
  const picks = state.picks[id] ?? [];
  const all: ShopCard[] = shops.data ? [...shops.data.listed, ...shops.data.category_only] : [];
  const chosen = picks.map((x) => all.find((s) => s.shop_id === x)).filter(Boolean) as ShopCard[];

  // A category-only shop has no price to confirm, so also ask about hours unless the user picked questions
  const qs = edited ?? [...(chosen.some((s) => s.tier === "category_only") ? [...DEFAULT_Q, "hours"] : DEFAULT_Q), ...custom.slice(0, 1).map((c) => c.key)];
  const customMap = Object.fromEntries(custom.filter((c) => qs.includes(c.key)).map((c) => [c.key, c.text]));

  const send = useMutation({
    mutationFn: async () => {
      const b = { session_id: sid, product_id: id, questions: qs, custom: customMap, note: note.trim() || null, timeout_s: timeout };
      if (mode === "waves") await api.smartInquiries({ ...b, shop_ids: picks, wave: 2, target: 1, max_shops: Math.max(6, picks.length) });
      else await api.createInquiries({ ...b, shop_ids: picks });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inquiries", sid] }); qc.invalidateQueries({ queryKey: ["campaigns", sid] }); router.push(`/track?product=${id}`); },
  });
  const smartOnly = useMutation({
    mutationFn: () => api.smartInquiries({ session_id: sid, product_id: id, questions: [...DEFAULT_Q, ...custom.slice(0, 1).map((c) => c.key)], custom: Object.fromEntries(custom.slice(0, 1).map((c) => [c.key, c.text])), timeout_s: 300 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inquiries", sid] }); qc.invalidateQueries({ queryKey: ["campaigns", sid] }); router.push(`/track?product=${id}`); },
  });

  if (shops.isLoading || p.isLoading) return <main className="main"><AppBar title="استعلام" /><SkeletonCards n={2} /></main>;
  if (shops.isError) return <main className="main"><AppBar title="استعلام" /><ErrorState error={shops.error} retry={() => shops.refetch()} /></main>;
  if (!picks.length) return (
    <main className="main"><AppBar title="استعلام" />
      <Empty icon="store" title="هنوز فروشگاهی انتخاب نشده" action={
        <div className="stack" style={{ gap: 8, width: "100%" }}>
          <button className="btn pri" disabled={smartOnly.isPending} onClick={() => smartOnly.mutate()}>{smartOnly.isPending ? <span className="spin" /> : <Icon n="spark" s />}بگذار ترب‌گرد انتخاب کند و موجی بپرسد</button>
          <Link className="btn sec" href={`/p/${id}/shops`}>خودم انتخاب می‌کنم</Link>
          {smartOnly.isError && <Note tone="bad" icon="alert">{(smartOnly.error as Error).message}</Note>}
        </div>}>از فهرست فروشگاه‌ها تا ۵ فروشگاه را تیک بزنید، یا بگذارید ترب‌گرد بهترین‌ها را دوتا‌دوتا بپرسد تا یکی تأیید کند.</Empty></main>
  );
  const qText = (k: string) => questions.data?.items.find((x) => x.key === k)?.text ?? custom.find((c) => c.key === k)?.text ?? k;

  return (
    <main className="main has-cta">
      <div className="lay lay-head">
      <AppBar title="استعلام" sub={p.data ? <Bidi text={p.data.title} /> : undefined} />
      <Steps at={3} />
      </div>
      <form className="pad stack ask-form" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
        <div className="stack" style={{ gap: 8 }}>
          <div className="h4">فروشگاه‌ها <span className="n">{fa(picks.length)} از ۵</span></div>
          <div className="wrapr">
            {chosen.map((s) => (
              <button key={s.shop_id} type="button" className="chip on" style={{ minHeight: 40 }} onClick={() => togglePick(id, s.shop_id)} aria-label={`حذف ${s.name}`}>
                {s.name}{s.tier === "category_only" && <span className="xs" style={{ opacity: .7 }}>· بپرسید</span>}<Icon n="x" s className="x" />
              </button>
            ))}
            {picks.length < 5 && <Link className="chip" href={`/p/${id}/shops`}><Icon n="plus" s />افزودن</Link>}
          </div>
          {picks.length >= 5 && <Note tone="unk" icon="alert">حداکثر ۵ فروشگاه. برای افزودن، یکی را بردارید.</Note>}
        </div>

        <fieldset className="stack ask-qs" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
          <legend className="h4" style={{ marginBottom: 8 }}>چه بپرسیم؟</legend>
          {(questions.data?.items ?? DEFAULT_Q.map((k) => ({ key: k, text: k }))).map((x) => {
            const on = qs.includes(x.key);
            return (
              <label key={x.key} className="card frow" style={{ padding: "0 12px", minHeight: 52, cursor: "pointer" }}>
                <span className="sm">{x.text}</span>
                <input type="checkbox" className="sr" checked={on} onChange={() => setQs(on ? qs.filter((k) => k !== x.key) : [...qs, x.key])} />
                <span className={`sel ${on ? "on" : ""}`} aria-hidden="true">{on && <Icon n="check" s />}</span>
              </label>
            );
          })}
        </fieldset>

        {custom.length > 0 && (
          <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
            <legend className="h4" style={{ marginBottom: 8 }}>مخصوص همین کالا <span className="n">{pq.data?.custom[0]?.source === "llm" ? "پیشنهاد هوشمند از روی مشخصات" : "پیشنهاد از روی دسته"}</span></legend>
            {custom.map((x) => {
              const on = qs.includes(x.key);
              return (
                <label key={x.key} className="card frow" style={{ padding: "8px 12px", minHeight: 52, cursor: "pointer" }}>
                  <span className="stack" style={{ gap: 2 }}><span className="sm"><Bidi text={x.text} /></span>{x.why && <span className="xs faint">{x.why}</span>}</span>
                  <input type="checkbox" className="sr" checked={on} onChange={() => setQs(on ? qs.filter((k) => k !== x.key) : [...qs, x.key])} />
                  <span className={`sel ${on ? "on" : ""}`} aria-hidden="true">{on && <Icon n="check" s />}</span>
                </label>
              );
            })}
          </fieldset>
        )}

        <div className="stack" style={{ gap: 6 }}>
          <span className="h4">روش پرسیدن</span>
          <Seg label="روش پرسیدن" value={mode} onChange={setMode} options={[["direct", `هم‌زمان از ${fa(picks.length)} فروشگاه`], ["waves", "موجی و هوشمند"]]} />
          <span className="xs faint">{mode === "waves"
            ? "اول دو فروشگاهِ اول را می‌پرسیم؛ اگر یکی «ندارم» گفت یا جواب نداد، سراغ بعدی می‌رویم (از انتخاب‌های شما و بعد بهترین‌های نزدیک) تا یکی تأیید کند. فروشگاه‌های بسته را نمی‌پرسیم."
            : "همه هم‌زمان پیام می‌گیرند."}</span>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <label htmlFor="note" className="h4">یادداشت <span className="n">اختیاری</span></label>
          <div className="field"><input id="note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: رنگ مشکی می‌خواهم." /></div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="h4">مهلت پاسخ</span>
          <Seg label="مهلت پاسخ" value={timeout} onChange={setTimeoutS} options={[[120, "۲ دقیقه"], [300, "۵ دقیقه"], [900, "۱۵ دقیقه"]]} />
          <span className="xs faint">اگر کسی تا {fa(timeout / 60)} دقیقه جواب ندهد، گزینهٔ دیگری پیشنهاد می‌دهیم.</span>
        </div>
        <div className="card" style={{ padding: 12, background: "var(--sunk)", borderStyle: "dashed" }}>
          <div className="xs faint" style={{ marginBottom: 4 }}>پیش‌نمایش پیام برای فروشنده</div>
          <div className="sm">سلام، مشتری‌ای نزدیک فروشگاه شماست و دربارهٔ «<Bidi text={p.data?.title} />» می‌پرسد: {qs.map(qText).join(" ")}{note.trim() ? ` «${note.trim()}»` : ""}</div>
        </div>
        {send.isError && <Note tone="bad" icon="alert">{(send.error as Error).message}</Note>}
        <div className="sticky-cta">
          <button className="btn pri block" type="submit" disabled={send.isPending || !qs.length}>
            {send.isPending ? <><span className="spin" style={{ borderTopColor: "var(--on-accent)" }} />در حال ارسال…</> : mode === "waves" ? <><Icon n="spark" s />شروع پرسیدن موجی</> : <><Icon n="send" s />ارسال به {fa(picks.length)} فروشگاه</>}
          </button>
        </div>
      </form>
    </main>
  );
}
