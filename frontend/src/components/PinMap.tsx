"use client";
// Tap the map to choose where you'll start from (when GPS is off or you plan for another place).
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export default function PinMap({ lat, lon, onPick }: { lat: number; lon: number; onPick: (lat: number, lon: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const cb = useRef(onPick);
  useEffect(() => { cb.current = onPick; }, [onPick]);
  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: true, attributionControl: true }).setView([lat, lon], 14);
    m.attributionControl.setPrefix(false);
    L.tileLayer(TILES, { maxZoom: 19, attribution: "© OpenStreetMap", className: "lm-tiles" }).addTo(m);
    const icon = L.divIcon({ className: "lm-me", html: "<i></i>", iconSize: [18, 18] }); // same dot as "you" on the shops map
    const mk = L.marker([lat, lon], { icon }).addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => { mk.setLatLng(e.latlng); cb.current(e.latlng.lat, e.latlng.lng); });
    return () => { m.remove(); };
    // the map is created once per opening; the marker follows taps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={el} className="map lmap" style={{ height: 240, borderRadius: 14 }} />;
}
