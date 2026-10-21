// Typed client for the FastAPI backend (docs/openapi.json, docs/api-contract.md). Calls go through the /api rewrite.

export type Freshness = "fresh" | "recent" | "stale" | "very_stale" | "no_price" | "unknown_age";
export type OpenState = "open" | "closing_soon" | "closed" | "unknown";

export interface Product {
  product_id: string; title: string; brand: string | null; category: string | null; image: string | null;
  price_min: number | null; price_median: number | null; price_max: number | null; shop_count: number; offer_count: number;
}
export interface Spec { section: string; key: string; value: string }
export interface ProductDetail extends Product { images: string[]; model: string | null; specs: Spec[] }
export interface SearchResult {
  total: number; items: Product[];
  facets: { categories: { name: string; count: number }[]; brands: { name: string; count: number }[] };
  applied: { price_min: number | null; price_max: number | null; budget_from_query: boolean };
}
export interface Offer {
  offer_id: string; product_id: string; seller_title: string; title?: string; description?: string | null;
  warranty?: string | null; warranty_months?: number | null; price: number | null; changed_at: string | null;
  age_days: number | null; freshness: Freshness; suspicious: boolean; verified_by_seller: boolean;
}
export interface Payment { provider: string; channel: string; confirmed_in_store: boolean }
export interface OpenInfo { state: OpenState; label: string; closes_at: string | null; opens_at: string | null; quality: "ok" | "missing" | "suspicious" }
export interface ShopCard {
  shop_id: string; name: string; name_is_verified: boolean; address: string; area: string | null;
  lat: number; lon: number; mall: string | null; mall_key: string | null; floor: number | null; floor_label: string | null;
  unit: string | null; plaque: string | null; distance_km: number | null; walk_min: number | null; open: OpenInfo;
  payments: Payment[]; installment: boolean; fast_delivery: boolean | null; in_traffic_zone: boolean;
  instagram: string | null; website: string | null; phone_is_placeholder: boolean;
  tier?: "listed" | "category_only"; offer?: Offer | null; why?: string; score?: number;
}
export interface Shift { start_time: string; end_time: string }
export interface DayHours { shifts: Shift[]; status: "declared" | "closed" | "unsupported" }
export type Weekday = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
export interface ShopDetail extends ShopCard {
  categories: string[]; weekly_hours: Record<Weekday, DayHours> | null; offer_count: number; offers: Offer[];
}
export interface ShopsForProduct {
  origin: [number, number] | null; listed: ShopCard[]; category_only: ShopCard[]; counts: { listed: number; category_only: number };
}
export interface CompareResult { products: ProductDetail[]; rows: { key: string; values: (string | null)[]; differs: boolean }[] }
export interface Mall { mall_key: string; mall: string; area: string | null; shop_count: number }
export interface MallDirectory extends Mall {
  lat: number; lon: number;
  floors: { floor: number | null; label: string; shops: { shop_id: string; name: string; unit: string | null; plaque: string | null; offer_count: number; categories: string[] }[] }[];
}
export type InquiryStatus = "sent" | "delivered" | "answered" | "unavailable" | "no_reply";
export interface Answer { available: boolean | null; price: number | null; message: string | null; closes_at: string | null; installment: boolean | null; simulated: boolean }
export interface Inquiry {
  id: string; session_id: string; status: InquiryStatus; label: string;
  created_at: string; delivered_at: string | null; answered_at: string | null; deadline_at: string;
  questions: { key: string; text: string }[]; note: string | null; answer: Answer | null;
  shop: Pick<ShopCard, "shop_id" | "name" | "mall" | "floor_label" | "unit" | "area" | "address" | "lat" | "lon"> | null;
  product: { product_id: string; title: string; image: string | null } | null;
  alternatives?: { kind: "same_product" | "similar_product"; shops: ShopCard[]; products: Product[] };
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiError(0, "اتصال به اینترنت برقرار نیست.");
  }
  if (!r.ok) {
    let msg = "مشکلی پیش آمد. دوباره امتحان کنید.";
    try { const j = await r.json(); if (typeof j.detail === "string") msg = j.detail; } catch {}
    throw new ApiError(r.status, msg);
  }
  return r.json() as Promise<T>;
}

const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export type Loc = { lat: number; lon: number } | null | undefined;
const at = (loc: Loc) => (loc ? { lat: loc.lat, lon: loc.lon } : {});

export interface ShopFilters {
  radius_km?: number | null; installment?: boolean; open_now?: boolean; fast_delivery?: boolean;
  sort?: "best" | "price" | "distance" | "freshness";
}

export const api = {
  search: (p: { q?: string; category?: string; brand?: string; price_min?: number | null; price_max?: number | null; limit?: number; offset?: number }) =>
    req<SearchResult>(`/search/products${qs({ limit: 20, ...p })}`),
  product: (id: string) => req<ProductDetail>(`/products/${encodeURIComponent(id)}`),
  similar: (id: string, limit = 6) => req<{ items: Product[] }>(`/products/${encodeURIComponent(id)}/similar${qs({ limit })}`),
  compare: (ids: string[]) => req<CompareResult>(`/products/compare`, { method: "POST", body: JSON.stringify({ ids }) }),
  productShops: (id: string, loc: Loc, f: ShopFilters = {}, limit = 40) =>
    req<ShopsForProduct>(`/products/${encodeURIComponent(id)}/shops${qs({ ...at(loc), ...f, limit })}`),
  shop: (id: string, loc: Loc) => req<ShopDetail>(`/shops/${encodeURIComponent(id)}${qs(at(loc))}`),
  malls: (limit = 12) => req<{ items: Mall[] }>(`/malls${qs({ limit })}`),
  mall: (key: string) => req<MallDirectory>(`/malls/${encodeURIComponent(key)}`),
  topCategories: (limit = 8) => req<{ items: { name: string; multi_shop_products: number }[] }>(`/categories/top${qs({ limit })}`),
  getSession: (id: string) => req<Record<string, unknown>>(`/sessions/${id}`),
  putSession: (id: string, state: Record<string, unknown>) => req(`/sessions/${id}`, { method: "PUT", body: JSON.stringify({ state }) }),
  questions: () => req<{ items: { key: string; text: string }[] }>(`/inquiry-questions`),
  createInquiries: (b: { session_id: string; shop_ids: string[]; product_id: string; questions: string[]; note?: string | null; timeout_s?: number }) =>
    req<{ items: Inquiry[] }>(`/inquiries`, { method: "POST", body: JSON.stringify(b) }),
  inquiries: (sid: string) => req<{ items: Inquiry[] }>(`/sessions/${sid}/inquiries`),
  sellerInbox: (shop: string, token: string) =>
    req<{ shop: { shop_id: string; name: string; mall: string | null; unit: string | null }; items: Inquiry[] }>(`/seller/${shop}/${token}/inquiries`),
  sellerAnswer: (shop: string, token: string, id: string, a: Partial<Answer>) =>
    req<Inquiry>(`/seller/${shop}/${token}/inquiries/${id}/answer`, { method: "POST", body: JSON.stringify(a) }),
  eventsUrl: (sid: string) => `${process.env.NEXT_PUBLIC_EVENTS_BASE ?? ""}/api/sessions/${sid}/events`,
};
