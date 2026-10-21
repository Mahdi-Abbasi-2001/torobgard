"use client";
// Session inquiries with live updates over SSE (/api/sessions/{id}/events).
// Events carry the inquiry without `alternatives`; when one fails we refetch so alternatives arrive too.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, type Inquiry } from "./api";

type OnChange = (next: Inquiry, prev: Inquiry | undefined) => void;

export function useInquiries(sid: string, { live = true, onChange }: { live?: boolean; onChange?: OnChange } = {}) {
  const qc = useQueryClient();
  const key = ["inquiries", sid];
  const q = useQuery({ queryKey: key, queryFn: () => api.inquiries(sid), enabled: !!sid, refetchInterval: live ? 20_000 : false });
  const [connected, setConnected] = useState(false);
  const items = useRef<Inquiry[]>([]);
  const cb = useRef<OnChange | undefined>(onChange);
  useEffect(() => { items.current = q.data?.items ?? []; cb.current = onChange; });

  useEffect(() => {
    if (!sid || !live || typeof EventSource === "undefined") return;
    const es = new EventSource(api.eventsUrl(sid));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data);
        if (ev.type !== "inquiry") return;
        const next: Inquiry = ev.inquiry;
        const prev = items.current.find((x) => x.id === next.id);
        qc.setQueryData<{ items: Inquiry[] }>(key, (old) => {
          const list = old?.items ?? [];
          const merged = { ...prev, ...next, alternatives: prev?.alternatives } as Inquiry;
          return { items: prev ? list.map((x) => (x.id === next.id ? merged : x)) : [next, ...list] };
        });
        if (next.status === "unavailable" || next.status === "no_reply") qc.invalidateQueries({ queryKey: key });
        if (prev?.status !== next.status) cb.current?.(next, prev);
      } catch {}
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, live]);

  return { ...q, items: q.data?.items ?? [], connected };
}

/** Ticks once a second so countdowns and "n minutes ago" stay current. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
