"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { fa } from "@/lib/fa";

/** Isolates Latin runs (model names like "Life U2i", unit "A41") so they never break RTL layout. */
export function Bidi({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const parts = text.split(/([A-Za-z][A-Za-z0-9.\-_/()+]*(?:\s[A-Za-z0-9.\-_/()+]+)*)/g);
  return <>{parts.map((p, i) => (i % 2 ? <bdi key={i}>{p}</bdi> : p))}</>;
}

export function AppBar({ title, sub, back = true, end }: { title?: ReactNode; sub?: ReactNode; back?: boolean | string; end?: ReactNode }) {
  const router = useRouter();
  return (
    <header className="appbar">
      {back && (
        <button className="iconbtn" aria-label="بازگشت" onClick={() => (typeof back === "string" ? router.push(back) : history.length > 1 ? router.back() : router.push("/"))}>
          <Icon n="back" />
        </button>
      )}
      <h1>{title}{sub && <span className="t2">{sub}</span>}</h1>
      {end}
    </header>
  );
}

const STEPS = ["انتخاب کالا", "فروشگاه‌ها", "مقایسهٔ فروشگاه‌ها", "استعلام و بازدید"];
export function Steps({ at }: { at: 0 | 1 | 2 | 3 }) {
  return (
    <ol className="steps" aria-label={`مرحله ${fa(at + 1)} از ۴`} style={{ listStyle: "none", margin: 0 }}>
      {STEPS.map((s, i) => <li key={s} className={i < at ? "done" : i === at ? "now" : ""} aria-current={i === at ? "step" : undefined}>{s}</li>)}
    </ol>
  );
}

export function BottomNav({ badge = 0 }: { badge?: number }) {
  const path = usePathname();
  const items: [string, IconName, string][] = [["/", "home", "خانه"], ["/chat", "chat", "گفتگو"], ["/missions", "bag", "مأموریت‌ها"]];
  return (
    <nav className="nav" aria-label="ناوبری اصلی">
      {items.map(([href, ic, label]) => {
        const on = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
            <Icon n={ic} />{label}
            {href === "/missions" && badge > 0 && <span className="dot">{fa(badge)}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sheet({ open, onClose, children, label, className = "" }: { open: boolean; onClose: () => void; children: ReactNode; label: string; className?: string }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className={`sheet ${className}`} role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} />;
}

export function Seg<T extends string | number | boolean | null>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === value} className={v === value ? "on" : ""} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children, tone = "", action }: { icon: IconName; title: string; children?: ReactNode; tone?: "" | "bad" | "ok" | "unk"; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className={`art ${tone}`}><Icon n={icon} /></div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : "مشکلی پیش آمد.";
  return (
    <Empty icon="alert" tone="bad" title="مشکلی پیش آمد" action={retry && <button className="btn sec" onClick={retry}><Icon n="refresh" s />تلاش دوباره</button>}>
      {msg}
    </Empty>
  );
}

export function Note({ tone, icon, children }: { tone: "bad" | "warn" | "info" | "ok" | "unk"; icon: IconName; children: ReactNode }) {
  return <div className={`note ${tone}`}><Icon n={icon} s /><span>{children}</span></div>;
}

export function SkeletonCards({ n = 4 }: { n?: number }) {
  return (
    <div className="pad stack" style={{ gap: 10 }} aria-busy="true" aria-label="در حال بارگذاری">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card pcard">
          <div className="sk" style={{ width: 76, height: 76, borderRadius: 14 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
            <div className="sk" style={{ height: 14, width: "90%" }} />
            <div className="sk" style={{ height: 14, width: "60%" }} />
            <div className="sk" style={{ height: 18, width: "40%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Product image from Torob's CDN, with a designed fallback when it is missing or fails to load. */
export function Thumb({ src, alt, size = 76, h, brand }: { src?: string | null; alt: string; size?: number | string; h?: number; brand?: string | null }) {
  const [bad, setBad] = useState(!src);
  const st = { width: size, height: h ?? (typeof size === "number" ? size : 190) };
  if (bad) return <div className="thumb none" style={st} aria-label="بدون تصویر"><span>بدون<br />تصویر{brand ? <><br /><b>{brand}</b></> : null}</span></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <div className="thumb" style={st}><img src={src!} alt={alt} loading="lazy" onError={() => setBad(true)} /></div>;
}

const subOnline = (cb: () => void) => {
  window.addEventListener("online", cb); window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
};
export const useOnline = () => useSyncExternalStore(subOnline, () => navigator.onLine, () => true);

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return <div className="banner unk" role="status"><Icon n="wifi" s /><span>اینترنت قطع یا ضعیف است. آخرین نتایج ذخیره‌شده را می‌بینید؛ پاسخ فروشنده‌ها بعد از اتصال می‌رسد.</span></div>;
}
