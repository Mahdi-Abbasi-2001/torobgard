"use client";
// Desktop app shell (≥ 960 px): replaces the bottom nav. Hidden by CSS on phones and tablets.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { fa } from "@/lib/fa";
import { useIsDesktop } from "@/lib/media";
import { useSession } from "@/lib/session";
import { useInquiries } from "@/lib/useInquiries";
import { CompareChip } from "./Compare";
import { Icon, Radish } from "./Icon";
import { LocationSheet } from "./LocationSheet";
import { SnapButton } from "./SnapButton";

const THEME_KEY = "tg-theme";
const themeSub = (cb: () => void) => {
  const m = window.matchMedia("(prefers-color-scheme: dark)");
  m.addEventListener("change", cb); window.addEventListener("tg-theme", cb);
  return () => { m.removeEventListener("change", cb); window.removeEventListener("tg-theme", cb); };
};
const effectiveDark = () => {
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
};

function ThemeToggle() {
  const dark = useSyncExternalStore(themeSub, effectiveDark, () => false);
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    window.dispatchEvent(new Event("tg-theme"));
  };
  return (
    <button type="button" className="tb-theme" onClick={flip} aria-label={dark ? "پوستهٔ روشن" : "پوستهٔ تیره"} title={dark ? "پوستهٔ روشن" : "پوستهٔ تیره"}>
      <Icon n={dark ? "sun" : "moon"} s />
    </button>
  );
}

export function TopBar() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const desk = useIsDesktop();
  const { state, sid, user } = useSession();
  const [locOpen, setLocOpen] = useState(false);
  const urlQ = path === "/search" ? sp.get("q") : null; // mirror only the results page's query
  const [text, setText] = useState(urlQ ?? "");
  const [lastQ, setLastQ] = useState(urlQ);
  if (lastQ !== urlQ) { setLastQ(urlQ); setText(urlQ ?? ""); }
  // badge only matters where the bar is visible; phones keep their single bottom-nav request
  const inq = useInquiries(desk ? sid : "", { live: false });
  const answered = inq.items.filter((i) => i.status === "answered").length;
  if (path.startsWith("/seller")) return null; // seller pages are a separate, narrow tool

  return (
    <header className="topbar">
      <Link href="/" className="tb-brand" aria-label="ترب‌گرد، صفحهٔ اصلی"><Radish size={28} />ترب‌گرد</Link>
      <form className="tb-search field search" role="search" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t) router.push(`/search?q=${encodeURIComponent(t)}`); }}>
        <button className="sbtn" type="submit" aria-label="جستجو"><Icon n="search" s /></button>
        <label htmlFor="tb-q" className="sr">جستجوی کالا</label>
        <input id="tb-q" value={text} onChange={(e) => setText(e.target.value)} placeholder="نام کالا یا نیازتان را بنویسید…" enterKeyHint="search" />
        <SnapButton className="iconbtn" label="عکس از کالا: مدل و قیمت را بسنجیم" />
      </form>
      <button type="button" className="chip" style={{ minHeight: 40 }} onClick={() => setLocOpen(true)} aria-label={`محدوده: ${state.place.label}. تغییر`}>
        <Icon n="pin" s />{state.place.label}<Icon n="fwd" s />
      </button>
      <CompareChip />
      <nav className="tb-links" aria-label="ناوبری اصلی">
        <Link href="/chat" className={path.startsWith("/chat") ? "on" : ""} aria-current={path.startsWith("/chat") ? "page" : undefined}><Icon n="chat" s />گفتگو</Link>
        <Link href="/mine" className={path.startsWith("/mine") || path.startsWith("/track") ? "on" : ""} aria-current={path.startsWith("/mine") ? "page" : undefined}>
          <Icon n="bag" s />خریدهای من{answered > 0 && <span className="dot" aria-label={`${fa(answered)} پاسخ تازه`}>{fa(answered)}</span>}
        </Link>
      </nav>
      {user
        ? <Link href="/login" className="chip" style={{ minHeight: 40 }} title="حساب کاربری"><span className="auth-avatar" style={{ width: 26, height: 26, fontSize: 12 }}>{user.username.slice(0, 1).toUpperCase()}</span><bdi>{user.username}</bdi></Link>
        : <Link href="/login" className="btn sec" style={{ minHeight: 40 }}>ورود / ثبت‌نام</Link>}
      <ThemeToggle />
      {locOpen && <LocationSheet open={locOpen} onClose={() => setLocOpen(false)} />}
    </header>
  );
}
