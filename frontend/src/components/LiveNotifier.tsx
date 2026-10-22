"use client";
// App-wide: when a seller answers, say so wherever the shopper is. In-app toast on other pages; a system notification
// (and a vibration) when the tab is in the background. The tracker page shows its own richer toasts.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, type Inquiry } from "@/lib/api";
import { fa, money } from "@/lib/fa";
import { useMissions } from "@/lib/mission";
import { useSession } from "@/lib/session";
import { Icon } from "./Icon";

const FINAL = new Set(["answered", "unavailable", "no_reply"]);

export function describe(q: Inquiry): string {
  const shop = q.shop?.name ?? "فروشگاه";
  const a = q.answer;
  if (q.kind === "hold") return a?.hold_accepted ? `${shop} برایتان نگه می‌دارد، کد ${fa(a.hold_code ?? "")}` : `${shop} نمی‌تواند نگه دارد`;
  if (q.kind === "recheck") return q.status === "answered" ? `${shop}: هنوز موجود است` : q.status === "unavailable" ? `${shop}: دیگر موجود نیست` : `${shop} به سؤال دوباره جواب نداد`;
  if (q.status === "no_reply") return `${shop} جواب نداد؛ گزینه‌های دیگر آماده است`;
  if (q.status === "unavailable") return `${shop}: موجود نیست`;
  return `${shop}: موجود است${a?.price ? `، ${money(a.price)} تومان` : ""}`;
}

export function LiveNotifier() {
  const { sid, ready } = useSession();
  const { missions } = useMissions();
  const missionsRef = useRef(missions);
  useEffect(() => { missionsRef.current = missions; }, [missions]);
  const path = usePathname();
  const qc = useQueryClient();
  const [toast, setToast] = useState<{ text: string; href: string } | null>(null);
  const pathRef = useRef(path);
  useEffect(() => { pathRef.current = path; }, [path]);

  useEffect(() => {
    if (!ready || !sid || typeof EventSource === "undefined") return;
    const seen = new Set<string>();
    const es = new EventSource(api.eventsUrl(sid));
    let timer: ReturnType<typeof setTimeout> | undefined;
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data);
        if (ev.type === "campaign") { qc.invalidateQueries({ queryKey: ["campaigns", sid] }); return; }
        if (ev.type !== "inquiry") return;
        const q: Inquiry = ev.inquiry;
        const key = `${q.id}:${q.status}`;
        if (!FINAL.has(q.status) || seen.has(key)) return;
        seen.add(key);
        const text = describe(q);
        const mine = missionsRef.current.find((m) => m.productId === q.product?.product_id);
        const href = mine ? `/m/${mine.id}?s=confirm` : "/missions";
        if (typeof document !== "undefined" && document.hidden) {
          try {
            if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("ترب‌گرد", { body: text, tag: q.id, lang: "fa", dir: "rtl" });
            navigator.vibrate?.(120);
          } catch {}
        }
        if (pathRef.current?.startsWith("/m/") || pathRef.current?.startsWith("/seller")) return; // a mission screen shows its answers live
        setToast({ text, href });
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setToast(null), 7000);
      } catch {}
    };
    return () => { es.close(); if (timer) clearTimeout(timer); };
  }, [sid, ready, qc]);

  if (!toast) return null;
  return (
    <Link href={toast.href} className="toast" role="status" onClick={() => setToast(null)} style={{ textDecoration: "none" }}>
      <Icon n="bell" /><span className="grow">{toast.text}</span><span className="xs b">پیگیری</span>
    </Link>
  );
}
