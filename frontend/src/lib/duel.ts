// Step 1 as a duel: two models, only the rows that matter for the shopper's need, a winner per row, unknowns shown as unknown.
import type { CompareResult, Product } from "./api";
import { fa, mil } from "./fa";

export type Side = "win" | "plain" | "unk";
export interface DuelRow { key: string; a: { text: string; side: Side }; b: { text: string; side: Side }; kind: "need" | "fixed" | "spec" }

const UNK = "نامشخص";
const side = (win: boolean, known: boolean): Side => (!known ? "unk" : win ? "win" : "plain");

/** a wins when `cmp` says so; equal or unknown values have no winner. */
function pair(key: string, kind: DuelRow["kind"], av: number | null, bv: number | null, fmt: (n: number) => string, lowerWins: boolean): DuelRow {
  const known = av != null && bv != null;
  const aw = known && (lowerWins ? av < bv : av > bv);
  const bw = known && (lowerWins ? bv < av : bv > av);
  return { key, kind, a: { text: av == null ? UNK : fmt(av), side: av == null ? "unk" : aw ? "win" : "plain" }, b: { text: bv == null ? UNK : fmt(bv), side: bv == null ? "unk" : bw ? "win" : "plain" } };
}

export function duelRows(a: Product, b: Product, cmp?: CompareResult, max = 6): DuelRow[] {
  const rows: DuelRow[] = [];
  // 1) what the shopper said they need: the preset's constraints with each model's real value
  const used = new Set<string>();
  for (const fa_ of a.fit ?? []) {
    const fb = b.fit?.find((x) => x.key === fa_.key);
    const okA = fa_.ok, okB = fb?.ok ?? null;
    rows.push({
      key: fa_.key, kind: "need",
      a: { text: fa_.value ? fa(fa_.value.slice(0, 22)) : UNK, side: okA === null ? "unk" : okA && okB !== true ? "win" : "plain" },
      b: { text: fb?.value ? fa(fb.value.slice(0, 22)) : UNK, side: okB === null ? "unk" : okB && okA !== true ? "win" : "plain" },
    });
    used.add(fa_.key);
  }
  // 2) the things every shopper compares in person
  rows.push(pair("کمترین قیمت", "fixed", a.price_min, b.price_min, (n) => `${mil(n)}`, true));
  rows.push(pair("فروشندهٔ این کالا", "fixed", a.shop_count, b.shop_count, (n) => `${fa(n)} فروشگاه`, false));
  if (a.near || b.near) rows.push(pair("تا ۱۵ دقیقه پیاده", "fixed", a.near?.near ?? null, b.near?.near ?? null, (n) => `${fa(n)} فروشگاه`, false));
  // 3) the specs where they differ most
  for (const r of cmp?.rows ?? []) {
    if (rows.length >= max) break;
    if (!r.differs || used.has(r.key) || r.best == null) continue;
    const [va, vb] = r.values;
    const win = (i: number) => side(r.best!.includes(i) && r.best!.length === 1, (i === 0 ? va : vb) != null);
    rows.push({ key: r.key, kind: "spec", a: { text: va ? fa(va.slice(0, 22)) : UNK, side: win(0) }, b: { text: vb ? fa(vb.slice(0, 22)) : UNK, side: win(1) } });
  }
  // keep the shopper's needs first, then fixed rows, then specs; never more than `max`
  const order = { need: 0, fixed: 1, spec: 2 } as const;
  return rows.sort((x, y) => order[x.kind] - order[y.kind]).slice(0, max);
}

/** The next challenger: first candidate not beaten, not the leader, extras (assistant suggestions) first. */
export function nextChallenger(all: Product[], champion: string | null, beaten: string[], extras: string[]) {
  const ok = (p: Product) => p.product_id !== champion && !beaten.includes(p.product_id);
  const ex = extras.map((id) => all.find((p) => p.product_id === id)).filter((p): p is Product => !!p && ok(p));
  return ex[0] ?? all.find(ok) ?? null;
}
