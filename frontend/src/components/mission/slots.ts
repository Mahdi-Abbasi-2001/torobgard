// The mission's slots as the shopper sees them: product, need, budget, where, when, how, conditions.
import { fa, mil } from "@/lib/fa";
import type { Mission } from "@/lib/mission";
import { whenLabel } from "@/components/discover";

export type SlotKey = "product" | "need" | "budget" | "place" | "when" | "mode" | "cond";
export type SlotInput = Pick<Mission, "query" | "need" | "budgetMin" | "budgetMax" | "cond" | "place" | "when" | "mode"> & { product?: { title: string } | null };
export interface Slot { key: SlotKey; label: string; value: string; open: boolean }

export const MODE_LABEL = { walk: "پیاده", taxi: "تاکسی", car: "ماشین" } as const;
export const budgetLabel = (min: number | null, max: number | null) =>
  min && max ? `${mil(min)} تا ${mil(max)}` : max ? `تا ${mil(max)}` : min ? `از ${mil(min)}` : null;
export const whenText = (w: string) => (w === "now" ? "الان" : w === "evening" ? "امروز عصر" : w === "tomorrow" ? "فردا صبح" : whenLabel(w));
export const condLabels = (c: SlotInput["cond"]) => [c.installment && "قسطی", c.open && "هنگام رسیدن باز باشد", c.near && "نزدیک من"].filter(Boolean) as string[];

export function slotsOf(m: SlotInput): Slot[] {
  const b = budgetLabel(m.budgetMin, m.budgetMax);
  const conds = condLabels(m.cond);
  return [
    { key: "product", label: "کالا", value: m.product?.title ? m.product.title : m.query || "", open: !m.product },
    { key: "need", label: "برای", value: m.need ?? "", open: !m.need },
    { key: "budget", label: "بودجه", value: b ?? "", open: !b },
    { key: "place", label: "از کجا", value: m.place.source === "default" ? "مرکز تهران" : m.place.label, open: m.place.source === "default" },
    { key: "when", label: "چه ساعتی", value: whenText(m.when), open: false },
    { key: "mode", label: "با", value: MODE_LABEL[m.mode], open: false },
    { key: "cond", label: "شرایط", value: conds.join("، "), open: !conds.length },
  ];
}

/** One line for a mission list or a phone head: «تا ۳٫۵ میلیون، علاالدین، امروز عصر، پیاده». */
export function slotSummary(m: SlotInput) {
  const s = slotsOf(m);
  const pick = (k: SlotKey) => s.find((x) => x.key === k)!;
  return [pick("budget"), pick("place"), pick("when"), pick("mode")].filter((x) => x.value && !x.open).map((x) => fa(x.value)).join("، ");
}
