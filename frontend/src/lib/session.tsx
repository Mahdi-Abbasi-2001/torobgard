"use client";
// Anonymous shopping session: one uuid per device (localStorage), mirrored to PUT /api/sessions/{id}
// so chat, inquiries and alternatives all see the same location, filters and shortlist.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, type ShopFilters } from "./api";
import { DEFAULT_PLACE, type Place } from "./geo";

export interface SessionState {
  place: Place;
  compare: string[];                 // product ids, max 4
  picks: Record<string, string[]>;   // product id → shop ids chosen for inquiry, max 5
  filters: ShopFilters;
  locationAsked: boolean;
}
const INITIAL: SessionState = { place: DEFAULT_PLACE, compare: [], picks: {}, filters: { sort: "best", radius_km: null }, locationAsked: false };
const KEY = "hk-session-v1";

interface Ctx {
  sid: string; ready: boolean; state: SessionState;
  update: (fn: (s: SessionState) => SessionState) => void;
  toggleCompare: (id: string) => void;
  togglePick: (productId: string, shopId: string) => boolean;
  setPicks: (productId: string, ids: string[]) => void;
}
const SessionCtx = createContext<Ctx | null>(null);

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sid, setSid] = useState("");
  const [state, setState] = useState<SessionState>(INITIAL);
  const [ready, setReady] = useState(false);
  const push = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let id = "", saved: Partial<SessionState> = {};
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const j = JSON.parse(raw); id = j.sid; saved = j.state ?? {}; }
    } catch {}
    if (!id) id = newId();
    // Hydrate from localStorage after mount: the server render has no storage, so this cannot be initial state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSid(id);
    setState((s) => ({ ...s, ...saved, filters: { ...s.filters, ...saved.filters } }));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !sid) return;
    try { localStorage.setItem(KEY, JSON.stringify({ sid, state })); } catch {}
    if (push.current) clearTimeout(push.current);
    push.current = setTimeout(() => {
      api.putSession(sid, { location: { lat: state.place.lat, lon: state.place.lon, label: state.place.label }, filters: state.filters, compare: state.compare }).catch(() => {});
    }, 600);
  }, [state, sid, ready]);

  const update = useCallback((fn: (s: SessionState) => SessionState) => setState(fn), []);
  const toggleCompare = useCallback((id: string) => setState((s) => {
    const has = s.compare.includes(id);
    return { ...s, compare: has ? s.compare.filter((x) => x !== id) : [...s.compare, id].slice(-4) };
  }), []);
  const togglePick = useCallback((productId: string, shopId: string) => {
    let ok = true;
    setState((s) => {
      const cur = s.picks[productId] ?? [];
      if (cur.includes(shopId)) return { ...s, picks: { ...s.picks, [productId]: cur.filter((x) => x !== shopId) } };
      if (cur.length >= 5) { ok = false; return s; }
      return { ...s, picks: { ...s.picks, [productId]: [...cur, shopId] } };
    });
    return ok;
  }, []);
  const setPicks = useCallback((productId: string, ids: string[]) =>
    setState((s) => ({ ...s, picks: { ...s.picks, [productId]: ids.slice(0, 5) } })), []);

  const value = useMemo(() => ({ sid, ready, state, update, toggleCompare, togglePick, setPicks }), [sid, ready, state, update, toggleCompare, togglePick, setPicks]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}
