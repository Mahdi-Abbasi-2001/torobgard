"use client";
// What the server knows about a mission's product: the newest question per shop, the holds and re-checks hanging under each,
// the "ask in waves" campaign. Everything about progress (stage, counts, the hold code) is derived from this, not stored.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, type Campaign, type Inquiry } from "./api";
import { fa } from "./fa";
import type { Mission, Stage } from "./mission";
import { useSession } from "./session";
import { useInquiries } from "./useInquiries";

export type Ripeness = 0 | 1 | 2 | 3 | 4; // 0 sold out / silent · 1 listed · 2 asked · 3 confirmed · 4 held

export interface ShopProgress {
  q: Inquiry; kids: Inquiry[]; ripeness: Ripeness; gone: boolean;
  hold: { code: string; until: string | null } | null;
  /** the price a shop agreed to after the shopper offered one (lower than its first answer), else null */
  deal: number | null;
}
export interface MissionStatus {
  loading: boolean; connected: boolean;
  items: ShopProgress[]; camp?: Campaign;
  asked: number; waiting: number; confirmed: number; unavailable: number; silent: number;
  held: (ShopProgress & { shopId: string }) | null;
  /** the confirmed, still-standing shop with the lowest confirmed price */
  best: ShopProgress | null;
  stage: Stage; finished: boolean; headline: string;
}

export const isWaitingQ = (q: Inquiry) => q.status === "sent" || q.status === "delivered";

export function ripenessOf(q: Inquiry, kids: Inquiry[]): { r: Ripeness; gone: boolean; hold: ShopProgress["hold"] } {
  const hold = kids.find((k) => k.kind === "hold" && k.answer?.hold_accepted);
  const lastRe = [...kids].filter((k) => k.kind === "recheck" && (k.status === "answered" || k.status === "unavailable")).sort((a, b) => (b.created_at > a.created_at ? 1 : -1))[0];
  const gone = lastRe?.status === "unavailable";
  if (q.status === "unavailable" || gone) return { r: 0, gone: true, hold: null };
  if (q.status === "no_reply") return { r: 0, gone: false, hold: null };
  if (q.status === "answered" && q.answer?.available !== false) {
    if (hold) return { r: 4, gone: false, hold: { code: hold.answer?.hold_code ?? "", until: hold.answer?.hold_until ?? hold.hold_until } };
    return { r: 3, gone: false, hold: null };
  }
  return { r: 2, gone: false, hold: null };
}

export function useMissionStatus(m: Pick<Mission, "productId" | "going" | "done"> & Partial<Pick<Mission, "createdAt">> | undefined, { live = true }: { live?: boolean } = {}): MissionStatus {
  const { sid } = useSession();
  const inq = useInquiries(sid, { live });
  const pid = m?.productId ?? null;
  const camps = useQuery({ queryKey: ["campaigns", sid], queryFn: () => api.campaigns(sid), enabled: !!sid && !!pid, refetchInterval: live ? 15_000 : false });

  return useMemo<MissionStatus>(() => {
    const all = inq.items;
    // inquiries belong to the session, not the mission: a question from an earlier journey for the same model must not count here
    const since = (m?.createdAt ?? 0) - 60_000;
    const mine = (iso: string) => { const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z"); return !(t < since); };
    // newest question per shop (asking again replaces the old card); holds and re-checks hang under the card they belong to
    const seen = new Set<string>();
    const asks = all.filter((i) => i.kind === "ask" && pid && mine(i.created_at) && i.product?.product_id === pid && i.shop && !seen.has(i.shop.shop_id) && seen.add(i.shop.shop_id));
    const byId = new Map(all.map((i) => [i.id, i]));
    const cardOf = new Map(asks.map((i) => [`${i.shop!.shop_id}:${i.product?.product_id}`, i.id]));
    const kidsOf = new Map<string, Inquiry[]>();
    all.forEach((i) => {
      if (!i.parent_id) return;
      const p = byId.get(i.parent_id);
      const card = (p?.shop && cardOf.get(`${p.shop.shop_id}:${p.product?.product_id}`)) || i.parent_id;
      kidsOf.set(card, [...(kidsOf.get(card) ?? []), i]);
    });
    const items: ShopProgress[] = asks.map((q) => {
      const kids = kidsOf.get(q.id) ?? [];
      const { r, gone, hold } = ripenessOf(q, kids);
      const deals = kids.filter((k) => k.kind === "bargain" && k.answer?.bargain_accepted && k.answer.price).map((k) => k.answer!.price!);
      return { q, kids, ripeness: r, gone, hold, deal: deals.length ? Math.min(...deals) : null };
    });
    const waiting = items.filter((x) => isWaitingQ(x.q)).length;
    const confirmed = items.filter((x) => x.ripeness >= 3).length;
    const unavailable = items.filter((x) => x.q.status === "unavailable" || x.gone).length;
    const silent = items.filter((x) => x.q.status === "no_reply").length;
    const held = items.find((x) => x.ripeness === 4);
    const cost = (x: ShopProgress) => Math.min(x.q.answer?.price ?? 9e12, x.deal ?? 9e12);
    const best = items.filter((x) => x.ripeness >= 3 && x.q.answer?.price).sort((a, b) => cost(a) - cost(b))[0] ?? items.find((x) => x.ripeness >= 3) ?? null;
    const camp = camps.data?.items.find((c) => c.product_id === pid && mine(c.created_at));
    const finished = !!m?.done;
    const stage: Stage = finished || m?.going || held ? 3 : items.length || camp ? 2 : pid ? 1 : 0;
    const bits = [confirmed && `${fa(confirmed)} تأیید`, unavailable && `${fa(unavailable)} ناموجود`, waiting && `${fa(waiting)} در حال پرسیدن`, silent && `${fa(silent)} بی‌پاسخ`].filter(Boolean);
    return {
      loading: inq.isLoading, connected: inq.connected, items, camp, asked: items.length, waiting, confirmed, unavailable, silent,
      held: held ? { ...held, shopId: held.q.shop!.shop_id } : null, best, stage, finished,
      headline: bits.length ? bits.join("، ") : pid ? "هنوز از هیچ فروشگاهی نپرسیده‌اید" : "هنوز مدلی انتخاب نشده",
    };
  }, [inq.items, inq.isLoading, inq.connected, camps.data, pid, m?.going, m?.done]);
}
