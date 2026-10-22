"use client";
// Shopping session: one uuid per device (localStorage), mirrored to PUT /api/sessions/{id} so chat, inquiries and
// alternatives all see the same location, filters and shortlist. Accounts are optional: signing in switches this device
// to the account's session (on any device); signing out starts a fresh anonymous one so a shared phone shows nothing.
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, authStore, type ShopFilters, type User } from "./api";
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
  user: User | null;
  signIn: (mode: "login" | "signup", username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}
const SessionCtx = createContext<Ctx | null>(null);

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sid, setSid] = useState("");
  const [state, setState] = useState<SessionState>(INITIAL);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const push = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    let id = "", saved: Partial<SessionState> = {};
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const j = JSON.parse(raw); id = j.sid; saved = j.state ?? {}; }
    } catch {}
    const auth = authStore.get();
    if (auth) id = auth.user.session_id; // signed in: always the account's session
    if (!id) id = newId();
    // Hydrate from localStorage after mount: the server render has no storage, so this cannot be initial state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSid(id);
    setUser(auth?.user ?? null);
    if (auth) api.me().catch((e) => { // expired or revoked token: fall back to a fresh anonymous session
      if (e?.status === 401) { authStore.set(null); setUser(null); setSid(newId()); }
    });
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

  const signIn = useCallback(async (mode: "login" | "signup", username: string, password: string) => {
    const r = mode === "signup" ? await api.signup(username, password, sid) : await api.login(username, password, sid);
    authStore.set(r);
    setUser(r.user);
    setSid(r.user.session_id);
    qc.invalidateQueries();
  }, [sid, qc]);
  const signOut = useCallback(async () => {
    await api.logout().catch(() => {});
    authStore.set(null);
    setUser(null);
    setSid(newId());
    setState(INITIAL);
    qc.clear();
  }, [qc]);

  const value = useMemo(() => ({ sid, ready, state, update, toggleCompare, togglePick, setPicks, user, signIn, signOut }),
    [sid, ready, state, update, toggleCompare, togglePick, setPicks, user, signIn, signOut]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}
