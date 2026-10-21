"use client";
// Short product review without review data: pros/cons are each tied to a real spec (shown as the evidence); the model's general
// knowledge is a separate, clearly-labelled «تأییدنشده» line. Honest by design, see backend/app/services/review.py.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ProductReview } from "@/lib/api";
import { fa } from "@/lib/fa";
import { Icon } from "./Icon";
import { Bidi } from "./ui";

export function ReviewCardView({ r }: { r: ProductReview }) {
  const empty = !r.pros.length && !r.cons.length && !r.tips.length && !r.reputation;
  return (
    <section className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }} aria-label="نقد کوتاه">
      <div className="h4"><Icon n="check" s />نقد کوتاه</div>
      {empty && <div className="note unk"><Icon n="q" s /><span>نقد هوشمند الان در دسترس نیست؛ مشخصات کلیدی کالا را ببینید.</span></div>}
      {r.pros.map((x) => <Point key={x.text} tone="ok" x={x} />)}
      {r.cons.map((x) => <Point key={x.text} tone="warn" x={x} />)}
      {r.tips.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="sm b">موقع خرید حضوری چک کنید</div>
          {r.tips.map((t) => <div key={t} className="sm muted">• {t}</div>)}
        </div>
      )}
      {r.reputation && (
        <div className="note info" style={{ alignItems: "flex-start" }}>
          <Icon n="alert" s />
          <span><b>طبق اطلاعات عمومی (تأییدنشده):</b> {r.reputation.text}</span>
        </div>
      )}
      <div className="xs faint">مزایا و معایب از مشخصات ثبت‌شدهٔ کالا در ترب آمده است؛ نظر کاربران در دسترس نیست.</div>
    </section>
  );
}

function Point({ tone, x }: { tone: "ok" | "warn"; x: { text: string; spec_key: string; spec_value: string } }) {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <div className="sm" style={{ color: tone === "ok" ? "var(--ok-ink, var(--ink))" : "var(--warn-ink, var(--ink))" }}>{tone === "ok" ? "✓" : "!"} <Bidi text={x.text} /></div>
      <div className="xs faint">بر اساس مشخصه‌ی «{x.spec_key}»: <Bidi text={fa(x.spec_value)} /></div>
    </div>
  );
}

/** Tap-to-load so only products people actually look at cost an AI call (results are cached server-side anyway). */
export function ProductReview({ id }: { id: string }) {
  const [go, setGo] = useState(false);
  const q = useQuery({ queryKey: ["review", id], queryFn: () => api.review(id), enabled: go, staleTime: Infinity });
  if (!go) return <button className="btn sec block" onClick={() => setGo(true)}><Icon n="check" s />نقد کوتاه این کالا</button>;
  if (q.isLoading) return <div className="card" style={{ padding: 14 }}><span className="toolline"><span className="spin" />در حال تهیه نقد کوتاه…</span></div>;
  if (q.isError || !q.data) return <div className="note bad"><Icon n="alert" s /><span>نقد در دسترس نیست. دوباره امتحان کنید.</span></div>;
  return <ReviewCardView r={q.data} />;
}
