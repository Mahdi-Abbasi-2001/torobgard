"use client";
// Start a mission for a model the shopper already chose (photo check, the product page, an old link): the mission begins at "find"
// with the product set and, optionally, shops already shortlisted.
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import type { Product } from "./api";
import { blankMission, useMissions, type Mission, type View } from "./mission";
import { useSession } from "./session";

export const asMissionProduct = (p: Product): NonNullable<Mission["product"]> => ({
  product_id: p.product_id, title: p.title, image: p.image, brand: p.brand, category: p.category,
  price_min: p.price_min, price_median: p.price_median, price_max: p.price_max, shop_count: p.shop_count,
});

export function useStartMission() {
  const router = useRouter();
  const { state, update } = useSession();
  const { create, missions, patch } = useMissions();
  return useCallback((p: Product, o: { picks?: string[]; view?: View; fresh?: boolean } = {}) => {
    const open = o.fresh ? undefined : missions.find((m) => m.productId === p.product_id && !m.done);
    const base = blankMission();
    const m = open ?? create({ ...base, text: p.title, query: p.title, category: p.category, productId: p.product_id, product: asMissionProduct(p), champion: p.product_id,
      place: state.place, when: state.when, mode: state.mode, picks: o.picks ?? [] });
    if (open && o.picks) patch(open.id, { picks: o.picks });
    update((s) => s); // keep the session as is; the mission carries its own place / time / way
    router.push(`/m/${m.id}${o.view ? `?s=${o.view}` : ""}`);
  }, [router, state.place, state.when, state.mode, create, missions, patch, update]);
}
