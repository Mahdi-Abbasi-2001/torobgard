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
