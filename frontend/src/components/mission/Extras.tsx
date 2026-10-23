"use client";
// «While you're here»: accessories that go with the chosen product and are sold in the same mall as the shop you are walking to, cheapest
// listing each, with the shop and its floor and unit. Adding one puts it in this trip's basket. No purchase history is involved, so it never
// claims what other people bought.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { fa, floorLabel, money } from "@/lib/fa";
import { useAddItem, useSpree, type Mission } from "@/lib/mission";
import { Icon } from "@/components/Icon";
import { Bidi } from "@/components/ui";
import { asMissionProduct, shortName } from "./DecideStage";

export function Extras({ m, mallKey, mall }: { m: Mission; mallKey: string | null | undefined; mall: string | null }) {
  const basket = useSpree(m);
  const add = useAddItem();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["extras", m.productId, mallKey], enabled: !!mallKey && !!m.productId, staleTime: 10 * 60_000, queryFn: () => api.extras(m.productId!, mallKey!) });
  const list = q.data?.items ?? [];
  if (!list.length) return null;
  const take = async (id: string) => {
    setBusy(id);
    try { const p = await api.product(id); add(m, { query: shortName(p), product: asMissionProduct(p) }); } finally { setBusy(null); }
  };
  return (
    <div className="mc-card" style={{ padding: 14, gap: 10 }}>
      <div><div className="b sm">حالا که اینجا هستید</div><div className="xs muted">در همین {mall ?? "پاساژ"} هم می‌فروشند؛ چند قدم از مسیرت</div></div>
      {list.map((x) => {
        const inBasket = basket.some((b) => b.productId === x.product_id);
        return (
          <div key={x.product_id} className="row" style={{ gap: 10, alignItems: "center" }}>
            <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
              <span className="sm b"><Bidi text={shortName({ title: x.title, brand: null })} /></span>
              <span className="xs faint">{x.why}، {money(x.price)} تومان، <Bidi text={x.shop} />{x.floor_label ? `، ${floorLabel(x.floor_label)}` : ""}{x.unit ? `، واحد ${fa(x.unit)}` : x.plaque ? `، پلاک ${fa(x.plaque)}` : ""}</span>
            </span>
            <button type="button" className={`chip ${inBasket ? "on" : ""}`} disabled={inBasket || busy === x.product_id} onClick={() => take(x.product_id)}>
              {busy === x.product_id ? <span className="spin" /> : <Icon n={inBasket ? "check" : "plus"} s />}{inBasket ? "در سبد" : "به سبد"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
