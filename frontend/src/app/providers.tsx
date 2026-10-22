"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { SessionProvider } from "@/lib/session";
import { MissionProvider } from "@/lib/mission";
import { CompareProvider } from "@/components/Compare";
import { LiveNotifier } from "@/components/LiveNotifier";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
  }));
  return (
    <QueryClientProvider client={qc}>
      <SessionProvider><MissionProvider><CompareProvider>{children}</CompareProvider><LiveNotifier /></MissionProvider></SessionProvider>
    </QueryClientProvider>
  );
}
