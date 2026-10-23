"use client";
// Presenter-only controls (e.g. «pretend the shop sold out») are hidden from shoppers. Open any page once with ?demo=1 to switch them on for this
// browser; ?demo=0 switches them off again.
import { useEffect, useState } from "react";

const KEY = "tg-demo";

export function useDemo(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let v = false;
    try {
      const q = new URLSearchParams(window.location.search).get("demo");
      if (q === "1") localStorage.setItem(KEY, "1"); else if (q === "0") localStorage.removeItem(KEY);
      v = localStorage.getItem(KEY) === "1";
    } catch { /* storage blocked: demo controls stay off */ }
    Promise.resolve().then(() => setOn(v));
  }, []);
  return on;
}
