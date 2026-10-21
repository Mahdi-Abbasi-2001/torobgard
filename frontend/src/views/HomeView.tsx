"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fa } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { useInquiries } from "@/lib/useInquiries";
import { Icon, Radish } from "@/components/Icon";
import { LocationSheet } from "@/components/LocationSheet";
import { BottomNav, Bidi, OfflineBanner, Thumb } from "@/components/ui";

const EXAMPLES = ["هندزفری گردنی زیر ۳ میلیون", "گوشی ۱۰ تا ۱۵ میلیون، قسطی", "دوربین مداربسته ۴ کانال"];
const HOW: [Parameters<typeof Icon>[0]["n"], string][] = [["spark", "کالا را انتخاب کن"], ["map", "فروشگاه نزدیک"], ["compare", "مقایسه"], ["send", "استعلام و برو"]];

export default function HomeView() {
  const router = useRouter();
  const { state, sid } = useSession();
  const [q, setQ] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const cats = useQuery({ queryKey: ["topcats"], queryFn: () => api.topCategories(8) });
  const malls = useQuery({ queryKey: ["malls"], queryFn: () => api.malls(8) });
  const inq = useInquiries(sid, { live: false });

  const all = inq.items;
  const recent = useMemo(() => {
    const by = new Map<string, typeof all>();
    all.forEach((i) => { const k = i.product?.product_id ?? "?"; by.set(k, [...(by.get(k) ?? []), i]); });
    return [...by.values()].slice(0, 2);
  }, [all]);

  const go = (text: string) => { const t = text.trim(); if (t) router.push(`/search?q=${encodeURIComponent(t)}`); };
  const denied = state.locationAsked && state.place.source !== "gps" && state.place.source !== "area";

  return (
    <main className="main has-nav">
      <OfflineBanner />
      <div className="pad stack" style={{ paddingTop: 12, gap: 14 }}>
        <div className="row between">
          <span className="row" style={{ gap: 8 }}><Radish /><span style={{ fontWeight: 900, fontSize: 20, lineHeight: 1 }}>ترب‌گرد</span></span>
          <button className="chip" style={{ minHeight: 40 }} onClick={() => setLocOpen(true)} aria-label={`محدوده: ${state.place.label}. تغییر`}>
            <Icon n="pin" s />{state.place.label}<Icon n="fwd" s />
          </button>
        </div>
        <div>
          <h2 style={{ margin: "4px 0 2px", fontSize: 22, fontWeight: 800, lineHeight: 1.5, textWrap: "balance" }}>دنبال چه هستید؟</h2>
          <p className="lede">بگویید برای چه می‌خواهید و تا چقدر؛ بقیه‌اش با ما.</p>
        </div>
        <form className="field" style={{ flexDirection: "column", alignItems: "stretch", padding: "10px 12px", gap: 8 }} onSubmit={(e) => { e.preventDefault(); go(q); }}>
          <label htmlFor="need" className="sr">نیاز شما</label>
          <textarea id="need" rows={2} value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثلاً: یه هندزفری بی‌سیم برای ورزش زیر ۳ میلیون"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(q); } }} />
          <div className="row between">
            <Link href="/chat" className="btn ghost" style={{ paddingInline: 4 }}><Icon n="chat" s />پرسیدن از دستیار</Link>
            <button className="btn brand" style={{ minHeight: 44 }} type="submit"><Icon n="search" s />پیدا کن</button>
          </div>
        </form>
        <div className="stack" style={{ gap: 8 }}>
          <span className="xs faint">نمونه‌ها را امتحان کنید</span>
          <div className="wrapr">{EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => go(e)}>{e}</button>)}</div>
        </div>

        {recent.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="h4">ادامهٔ خرید قبلی</div>
            {recent.map((g) => {
              const p = g[0].product, ok = g.filter((i) => i.status === "answered").length, wait = g.filter((i) => i.status === "sent" || i.status === "delivered").length;
              return (
                <Link key={g[0].id} href="/track" className="card row" style={{ padding: "12px 14px", gap: 12 }}>
                  <Thumb src={p?.image} alt={p?.title ?? ""} size={52} />
                  <div className="grow"><div className="b sm"><Bidi text={p?.title} /></div>
                    <div className="xs muted">{fa(g.length)} استعلام{ok ? <> · <span style={{ color: "var(--ok)", fontWeight: 650 }}>{fa(ok)} پاسخ</span></> : null}{wait ? ` · ${fa(wait)} در انتظار` : ""}</div></div>
                  <Icon n="fwd" />
                </Link>
              );
            })}
          </div>
        )}

        <div className="card" style={{ padding: "12px 14px" }}>
          <div className="xs faint" style={{ marginBottom: 8 }}>از «نمی‌دانم کدام» تا «جلوی واحد درست»</div>
          <ol style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, textAlign: "center", listStyle: "none", margin: 0, padding: 0 }}>
            {HOW.map(([i, t], k) => (
              <li key={t} className="xs" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, color: "var(--ink-2)" }}>
                <span style={{ width: 36, height: 36, borderRadius: 11, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon n={i} s /></span>
                {fa(k + 1)}. {t}
              </li>
            ))}
          </ol>
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <div className="h4">دسته‌های پرفروشگاه</div>
          <div className="wrapr">
            {cats.isLoading && Array.from({ length: 6 }, (_, i) => <span key={i} className="sk" style={{ width: 110, height: 38, borderRadius: 999 }} />)}
            {cats.data?.items.map((c) => (
              <Link key={c.name} href={`/search?category=${encodeURIComponent(c.name)}`} className="chip">{c.name} <span className="xs faint">{fa(c.multi_shop_products)}</span></Link>
            ))}
          </div>
        </div>
      </div>

      <div className="stack" style={{ gap: 8, marginTop: 16 }}>
        <div className="h4 pad">پاساژهای بزرگ <span className="n">راهنمای طبقه‌به‌طبقه</span></div>
        <div className="hscroll">
          {malls.data?.items.map((m) => (
            <Link key={m.mall_key} href={`/mall/${encodeURIComponent(m.mall_key)}`} className="card" style={{ padding: "10px 12px", minWidth: 140, flex: "0 0 auto" }}>
              <div className="row" style={{ gap: 6, color: "var(--accent)" }}><Icon n="layers" s /><span className="b sm" style={{ color: "var(--ink)" }}>{fa(m.mall)}</span></div>
              <div className="xs faint">{m.area} · {fa(m.shop_count)} فروشگاه</div>
            </Link>
          ))}
        </div>
      </div>

      <LocationSheet open={locOpen} onClose={() => setLocOpen(false)} denied={denied} />
      <BottomNav badge={inq.items.filter((i) => i.status === "answered").length} />
    </main>
  );
}
