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
  const picks = state.picks[id] ?? [];
  const all: ShopCard[] = shops.data ? [...shops.data.listed, ...shops.data.category_only] : [];
  const chosen = picks.map((x) => all.find((s) => s.shop_id === x)).filter(Boolean) as ShopCard[];

  // A category-only shop has no price to confirm, so also ask about hours unless the user picked questions
  const qs = edited ?? (chosen.some((s) => s.tier === "category_only") ? [...DEFAULT_Q, "hours"] : DEFAULT_Q);

  const send = useMutation({
    mutationFn: () => api.createInquiries({ session_id: sid, shop_ids: picks, product_id: id, questions: qs, note: note.trim() || null, timeout_s: timeout }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inquiries", sid] }); router.push(`/track?product=${id}`); },
  });

  if (shops.isLoading || p.isLoading) return <main className="main"><AppBar title="استعلام" /><SkeletonCards n={2} /></main>;
  if (shops.isError) return <main className="main"><AppBar title="استعلام" /><ErrorState error={shops.error} retry={() => shops.refetch()} /></main>;
  if (!picks.length) return (
    <main className="main"><AppBar title="استعلام" />
      <Empty icon="store" title="هنوز فروشگاهی انتخاب نشده" action={<Link className="btn sec" href={`/p/${id}/shops`}>انتخاب فروشگاه‌ها</Link>}>از فهرست فروشگاه‌ها تا ۵ فروشگاه را تیک بزنید.</Empty></main>
  );
  const qText = (k: string) => questions.data?.items.find((x) => x.key === k)?.text ?? k;

  return (
    <main className="main has-cta">
      <AppBar title="استعلام" sub={p.data ? <Bidi text={p.data.title} /> : undefined} />
      <Steps at={3} />
      <form className="pad stack" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
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

        <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
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
            {send.isPending ? <><span className="spin" style={{ borderTopColor: "var(--on-accent)" }} />در حال ارسال…</> : <><Icon n="send" s />ارسال به {fa(picks.length)} فروشگاه</>}
          </button>
        </div>
      </form>
    </main>
  );
}
