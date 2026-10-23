"use client";
// A mission is one errand: what to buy, what it is for, budget, where / when / how, and everything that happens until the
// shopper is at the counter. It lives on this device (localStorage); the product's inquiries, holds and reports live on the
// server under the session, so a mission's stage is derived from them (see useMissionStatus), never stored twice.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Priority } from "./api";
import { DEFAULT_PLACE, type Place } from "./geo";

export type Mode = "walk" | "taxi" | "car";
export type Stage = 0 | 1 | 2 | 3;
/** the screens of a mission: decide → find (map, then compare) → confirm → go → done */
export type View = "decide" | "find" | "compare" | "confirm" | "go" | "done";
export const STAGE_OF: Record<View, Stage> = { decide: 0, find: 1, compare: 1, confirm: 2, go: 3, done: 3 };
export const STAGE_VIEW: View[] = ["decide", "find", "confirm", "go"];
export const STAGE_LABEL = ["مدل", "فروشگاه", "تأیید", "رفتن"];

export interface MissionProduct {
  product_id: string; title: string; image: string | null; brand: string | null; category: string | null;
  price_min: number | null; price_median: number | null; price_max: number | null; shop_count: number;
}
/** one line of the conversation kept with the mission: what was said, and what the assistant changed in the journey */
export interface ChatLine { me: boolean; text: string; changes?: string[] }
export interface Mission {
  id: string; createdAt: number; updatedAt: number;
  /** the shopper's own words */
  text: string;
  /** product words to search, and the category they resolved to */
  query: string; category: string | null;
  /** what it is for («ورزش») and the need preset chosen for it */
  need: string | null; presetId: string | null;
  budgetMin: number | null; budgetMax: number | null;
  cond: { installment: boolean; open: boolean; near: boolean };
  place: Place; when: string; mode: Mode;
  productId: string | null; product: MissionProduct | null;
  /** duel state: the model currently leading and the ones already beaten */
  champion: string | null; beaten: string[];
  /** models the assistant suggested: they join the duel next */
  extras: string[];
  picks: string[]; priority: Priority;
  /** the shopper pressed «start the trip» */
  going: boolean;
  /** the trip this item belongs to: every shopping trip has a basket, a single item is a basket of one. Empty = its own trip (older missions). */
  spree: string;
  /** autopilot: the app runs the errand itself (pick the model, ask the shops, wait) and stops only at your decisions */
  auto: boolean;
  /** what the start-screen agent understood, and the conversation since */
  brief: string | null; chat: ChatLine[];
  /** visit reported: bought (shop id) or not */
  done: { shopId: string | null; paid: number | null; found: boolean | null; at: number; reportId?: string; rating?: number } | null;
}

const KEY = "tg-missions-v1";
const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const blankMission = (over: Partial<Mission> = {}): Mission => ({
  id: newId(), createdAt: Date.now(), updatedAt: Date.now(), text: "", query: "", category: null, need: null, presetId: null,
  budgetMin: null, budgetMax: null, cond: { installment: false, open: false, near: false },
  place: DEFAULT_PLACE, when: "now", mode: "walk", productId: null, product: null, champion: null, beaten: [], extras: [], picks: [], priority: "balanced",
  going: false, auto: false, spree: "", done: null, brief: null, chat: [], ...over,
});

interface Ctx {
  missions: Mission[]; ready: boolean;
  create: (init: Partial<Mission>) => Mission;
  patch: (id: string, p: Partial<Mission> | ((m: Mission) => Partial<Mission>)) => void;
  remove: (id: string) => void;
}
const MissionCtx = createContext<Ctx | null>(null);

export function MissionProvider({ children }: { children: React.ReactNode }) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [ready, setReady] = useState(false);
  const lastAt = useRef(0);

  useEffect(() => {
    // Hydrate from localStorage after mount: the server render has no storage, so this cannot be initial state.
    try {
      const raw = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setMissions((JSON.parse(raw) as Mission[]).map((m) => ({ ...blankMission(), ...m })));
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(missions)); } catch {}
  }, [missions, ready]);

  const create = useCallback((init: Partial<Mission>) => {
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = init; // a new mission always gets its own id and times
    void _i; void _c; void _u;
    const m = blankMission(rest);
    m.createdAt = Math.max(m.createdAt, lastAt.current + 1); lastAt.current = m.createdAt; // items made in one go keep the order they were made in
    setMissions((l) => [m, ...l]);
    return m;
  }, []);
  const patch = useCallback((id: string, p: Partial<Mission> | ((m: Mission) => Partial<Mission>)) =>
    setMissions((l) => l.map((m) => (m.id === id ? { ...m, ...(typeof p === "function" ? p(m) : p), updatedAt: Date.now() } : m))), []);
  const remove = useCallback((id: string) => setMissions((l) => l.filter((m) => m.id !== id)), []);

  const value = useMemo(() => ({ missions: [...missions].sort((a, b) => b.updatedAt - a.updatedAt), ready, create, patch, remove }), [missions, ready, create, patch, remove]);
  return <MissionCtx.Provider value={value}>{children}</MissionCtx.Provider>;
}

export function useMissions() {
  const c = useContext(MissionCtx);
  if (!c) throw new Error("useMissions outside MissionProvider");
  return c;
}

/** The trip an item belongs to (its own id when it has not been grouped). */
export const spreeOf = (m: Pick<Mission, "id" | "spree">) => m.spree || m.id;

/** The basket of a trip: its items, oldest first. */
export function useSpree(m: Mission | undefined) {
  const { missions } = useMissions();
  return useMemo(() => {
    if (!m) return [] as Mission[];
    const id = spreeOf(m);
    return missions.filter((x) => spreeOf(x) === id).sort((a, b) => a.createdAt - b.createdAt);
  }, [missions, m]);
}

/** Trips for lists and tabs: one entry per trip (the oldest item heads it), most recently touched first. */
export function groupMissions(list: Mission[]): { head: Mission; items: Mission[] }[] {
  const by = new Map<string, Mission[]>();
  list.forEach((m) => by.set(spreeOf(m), [...(by.get(spreeOf(m)) ?? []), m]));
  return [...by.values()].map((items) => {
    const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
    return { head: sorted[0], items: sorted };
  });
}

/** Add an item to the trip an existing mission belongs to: same place, time, way and autopilot choice; it starts at the model choice
 *  unless a product is already known. */
export function useAddItem() {
  const { create } = useMissions();
  return useCallback((from: Mission, item: { query: string; text?: string; category?: string | null; product?: MissionProduct | null }) => create({
    spree: spreeOf(from), text: item.text ?? item.query, query: item.query, category: item.category ?? item.product?.category ?? null,
    place: from.place, when: from.when, mode: from.mode, cond: from.cond, priority: from.priority, auto: from.auto,
    ...(item.product ? { productId: item.product.product_id, product: item.product, champion: item.product.product_id } : {}),
  }), [create]);
}

/** One mission by id with a patch helper bound to it. `m` is undefined until storage is read, or when the id is unknown. */
export function useMission(id: string) {
  const { missions, ready, patch } = useMissions();
  const m = missions.find((x) => x.id === id);
  const set = useCallback((p: Partial<Mission> | ((m: Mission) => Partial<Mission>)) => patch(id, p), [patch, id]);
  return { m, ready, set };
}
