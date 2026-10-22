"use client";
// Desktop breakpoint as a hook, for the few places where layout needs JS (map size, sheets → side panels).
// Everything else is CSS behind @media (min-width: 960px). Server render and first paint use the mobile value.
import { useSyncExternalStore } from "react";

const Q = "(min-width: 960px)";
const sub = (cb: () => void) => {
  const m = window.matchMedia(Q);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
export const useIsDesktop = () => useSyncExternalStore(sub, () => window.matchMedia(Q).matches, () => false);

// Effective theme: the desktop toggle's choice (data-theme on <html>, event "tg-theme") or else the system setting.
const themeSub = (cb: () => void) => {
  const m = window.matchMedia("(prefers-color-scheme: dark)");
  m.addEventListener("change", cb); window.addEventListener("tg-theme", cb);
  return () => { m.removeEventListener("change", cb); window.removeEventListener("tg-theme", cb); };
};
const isDark = () => {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "dark"; // light unless the shopper chose dark
};
export const useDarkTheme = () => useSyncExternalStore(themeSub, isDark, () => false);
