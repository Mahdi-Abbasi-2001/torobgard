"use client";
// Old links (chat proposals, the product page, notifications, bookmarks) land here and continue in the mission for that product:
// the open one if there is, else a new one that starts from the product (and the shops already picked).
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useMissions, blankMission, type View } from "@/lib/mission";
import { useSession } from "@/lib/session";
import { asMissionProduct } from "@/lib/useStartMission";
import { Empty } from "@/components/ui";

export default function GoMission({ productId, view, ids }: { productId?: string | null; view: View; ids?: string[] }) {
  const router = useRouter();
  const { sid, ready: sessionReady, state } = useSession();
  const { missions, create, patch, ready } = useMissions();
  const started = useRef(false);
  useEffect(() => {
    if (!ready || !sessionReady || !sid || started.current) return;
    started.current = true;
    (async () => {
      let pid = productId ?? null;
      if (!pid) pid = (await api.inquiries(sid).catch(() => ({ items: [] }))).items.find((i) => i.product)?.product?.product_id ?? null;
      if (!pid) { router.replace("/missions"); return; }
      const picks = (ids?.length ? ids : state.picks[pid]) ?? [];
      let m = missions.find((x) => x.productId === pid && !x.done);
      if (!m) {
        const p = await api.product(pid).catch(() => null);
        if (!p) { router.replace("/missions"); return; }
        m = create({ ...blankMission(), text: p.title, query: p.title, category: p.category, productId: pid, product: asMissionProduct(p), champion: pid, place: state.place, when: state.when, mode: state.mode, picks });
      } else if (ids?.length) patch(m.id, { picks: ids });
      router.replace(`/m/${m.id}?s=${view}`);
    })();
  }, [ready, sessionReady, sid]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="mc"><div style={{ padding: 40 }}><Empty icon="route" title="در حال رفتن به مأموریت…">{" "}</Empty></div></div>;
}
