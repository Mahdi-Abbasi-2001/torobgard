"use client";
import { useQuery } from "@tanstack/react-query";
import { api, type RoutePlan } from "./api";

/** The route to draw (shared by the map and the step list: react-query makes it one request). */
export function useRoute(from: { lat: number; lon: number } | null, to: { lat: number; lon: number } | null, mode: "walk" | "taxi" | "car") {
  const m = mode === "walk" ? "walk" : "car";
  return useQuery<RoutePlan>({
    queryKey: ["route", from?.lat.toFixed(5), from?.lon.toFixed(5), to?.lat.toFixed(5), to?.lon.toFixed(5), m],
    queryFn: () => api.route(from!, to!, m), enabled: !!from && !!to, staleTime: 10 * 60_000, retry: 1,
  });
}
