// Areas the user can pick when location permission is denied. Coordinates are area centres (approximate).
export interface Place { lat: number; lon: number; label: string; source: "gps" | "area" | "default" }

export const AREAS: Place[] = [
  { label: "حافظ × جمهوری", lat: 35.6955, lon: 51.413, source: "area" },
  { label: "فردوسی", lat: 35.6985, lon: 51.4205, source: "area" },
  { label: "لاله‌زار", lat: 35.6915, lon: 51.423, source: "area" },
  { label: "بهارستان", lat: 35.692, lon: 51.4315, source: "area" },
  { label: "شیخ هادی", lat: 35.695, lon: 51.4075, source: "area" },
];
export const DEFAULT_PLACE: Place = { ...AREAS[0], source: "default" };

export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Walking minutes on Tehran bazaar streets (~4.5 km/h, +30% for indirect routes). */
export const walkMin = (d: number) => Math.round((d * 1.3) / 4.5 * 60);
