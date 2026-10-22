"use client";
// Shops map: a real street map (see LeafletMap). Leaflet needs the browser, so it loads client-side only; until then the
// pane keeps its size with the map background.
import dynamic from "next/dynamic";
import type { ShopCard } from "@/lib/api";
import type { Hub } from "./LeafletMap";
import { useIsDesktop } from "@/lib/media";

type MapProps = {
  origin: { lat: number; lon: number; label?: string; source?: string }; listed: ShopCard[]; cat: ShopCard[]; selected: string[]; height?: number | string;
  hubs?: Hub[]; onHub?: (key: string) => void; labels?: Record<string, string>; states?: Record<string, string>; routes?: { pts: [number, number][]; alt?: boolean }[];
  onPick?: (id: string) => void; hover?: string | null; onHover?: (id: string | null) => void; className?: string;
};

const LeafletMap = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => <div className="map lmap" style={{ height: 300 }} aria-busy="true" />,
});

export function ShopMap(props: MapProps) {
  const desk = useIsDesktop();
  // phones: a taller map than the old schematic, since streets need room; desktop: CSS sizes the pane
  return <LeafletMap key={desk ? "d" : "m"} {...props} desk={desk} height={props.height ?? (desk ? 240 : 300)} />;
}
