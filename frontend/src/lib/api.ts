// Typed client for the FastAPI backend (docs/openapi.json, docs/api-contract.md). Calls go through the /api rewrite.

export type Freshness = "fresh" | "recent" | "stale" | "very_stale" | "no_price" | "unknown_age";
export type OpenState = "open" | "closing_soon" | "closed" | "unknown";

export interface Product {
  product_id: string; title: string; brand: string | null; category: string | null; image: string | null;
  price_min: number | null; price_median: number | null; price_max: number | null; shop_count: number; offer_count: number;
  /** shops listing it, within 15 min walk, open at the chosen time, with installments */
  near?: Availability; fit?: Fit[]; fit_score?: number;
}
export interface Availability { shops: number; near: number; open: number; installment: number; nearest_min: number | null }
export interface Fit { key: string; wanted: string; value: string | null; ok: boolean | null }
export interface Constraint { key: string; op: ">=" | "<=" | "has"; value: number | string }
export interface Preset { id: string; label: string; why: string; constraints: Constraint[]; sort?: "price" | "near" }
export interface SpecFacet { key: string; products: number; values: { value: string; count: number }[] }
export interface Variant extends Product { variant: string; vs_price_pct?: number }
export interface FairPrice {
  low: number; high: number; median: number; min: number; max: number; offers: number; outliers: number; fresh_offers: number;
  oldest_days: number | null; newest_days: number | null; confidence: "high" | "medium" | "low"; note: string;
}
export interface Insights { product_id: string; variants: Variant[]; fair_price: FairPrice | null; availability: Availability | null; when: string }
export interface CompareInsights { cheapest: number | null; most_available: number | null; per_product: { product_id: string; wins: string[]; text: string }[] }
export interface Verdict {
  pick: string; headline: string; reasons: string[]; tradeoff: string | null; per_need: { need: string; product_id: string }[];
  source: "llm" | "rules"; need: string | null;
}
export interface Flag { code: string; label: string; tone: "bad" | "warn" }
export interface Travel { walk: number; taxi: number; car: number; car_note: string | null }
export interface Zone {
  key: string; kind: "mall" | "area"; name: string; area: string | null; shop_count: number; open_count: number; confirmed_count: number;
  price_min: number | null; distance_km: number | null; walk_min: number | null; lat: number | null; lon: number | null; shop_ids: string[]; why: string;
}
export interface Area { label: string; shop_count: number; lat: number; lon: number; malls: number; shops_with_prices: number }
export type Priority = "balanced" | "price" | "near" | "trust" | "now";
export interface ShopCompare {
  shops: ShopCard[]; priority: Priority; priority_label: string; when: string; fair_price: FairPrice | null;
  winners: Record<"price" | "distance" | "freshness" | "closes" | "warranty" | "trust", string[]>;
  verdict: { for: string; shop_id: string; name: string; why: string }[]; one_trip: { mall: string; count: number } | null;
}
export interface Spec { section: string; key: string; value: string }
export interface ProductDetail extends Product { images: string[]; model: string | null; specs: Spec[] }
export interface SearchResult {
  total: number; items: Product[];
  facets: { categories: { name: string; count: number }[]; brands: { name: string; count: number }[] };
  applied: { price_min: number | null; price_max: number | null; budget_from_query: boolean; when?: string; relaxed?: boolean };
  capped?: boolean;
}
export interface Offer {
  offer_id: string; product_id: string; seller_title: string; title?: string; description?: string | null;
  warranty?: string | null; warranty_months?: number | null; price: number | null; changed_at: string | null;
  age_days: number | null; freshness: Freshness; suspicious: boolean; verified_by_seller: boolean;
  flags?: Flag[]; fair?: { level: "ok" | "warn"; text: string } | null;
  /** the seller replaced the dataset price while answering an inquiry */
  updated_by_seller?: boolean; listed_before_update?: number | null;
  confirmation?: Confirmation | null;
}
/** Shared "what is true now" layer: newest seller answer / visit / call report for this shop + product. */
export interface Confirmation {
  available: boolean | null; price: number | null; source: "seller" | "visit" | "call"; at: string; age_min: number;
  state: "fresh" | "aging" | "expired"; simulated: boolean; inquiry_id: string | null; count: number;
}
export interface Reliability {
  asked: number; replied: number; reply_rate: number | null; median_reply_s: number | null; price_checks: number; rating?: { avg: number; n: number } | null;
  price_match_rate: number | null; visits: number; visit_ok: number; score: number; known: boolean; label: string | null;
}
export interface Payment { provider: string; channel: string; confirmed_in_store: boolean }
export interface OpenInfo { state: OpenState; label: string; closes_at: string | null; opens_at: string | null; quality: "ok" | "missing" | "suspicious" }
export interface ShopCard {
  shop_id: string; name: string; name_is_verified: boolean; address: string; area: string | null;
  lat: number; lon: number; mall: string | null; mall_key: string | null; floor: number | null; floor_label: string | null;
  unit: string | null; plaque: string | null; distance_km: number | null; walk_min: number | null; open: OpenInfo;
  payments: Payment[]; installment: boolean; fast_delivery: boolean | null; in_traffic_zone: boolean;
  instagram: { handle: string | null; profile_url: string } | null; website: string | null; phone_is_placeholder: boolean; phone?: string | null;
  tier?: "listed" | "category_only"; offer?: Offer | null; why?: string; score?: number;
  confirmation?: Confirmation | null; reliability?: Reliability | null;
  travel?: Travel | null; score_parts?: Record<"price" | "distance" | "freshness" | "open" | "confirmations", number>; trust_score?: number;
}
export interface Shift { start_time: string; end_time: string }
export interface DayHours { shifts: Shift[]; status: "declared" | "closed" | "unsupported" }
export type Weekday = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
export interface ShopDetail extends ShopCard {
  categories: string[]; weekly_hours: Record<Weekday, DayHours> | null; offer_count: number; offers: Offer[];
}
/** Shops near a point with the shifts (minutes since midnight) they declare for a weekday; `known: false` means no declared hours. */
export interface Pulse { weekday: string; total: number; shops: { shop_id: string; name: string; lat: number; lon: number; mall: string | null; km: number; known: boolean; closed_day: boolean; shifts: [number, number][] }[] }
/** An accessory of the chosen product, sold in the same mall as the stop. */
export interface Extra { product_id: string; title: string; price: number; shop_id: string; shop: string; floor_label: string | null; unit: string | null; plaque: string | null; why: string }
/** One trip for a basket: the fewest stops that cover it, each item at the stop where it is cheapest. */
export interface BasketStop { shop_id: string; name: string; mall: string | null; area: string | null; floor_label: string | null; unit: string | null; plaque: string | null; lat: number; lon: number;
  open: string | null; open_state: string | null; walk_min_from_prev: number; items: { product_id: string; title: string; price: number }[] }
export interface BasketPlan { items: { product_id: string; title: string; image: string | null; listed: boolean }[]; stops: BasketStop[]; uncovered: { product_id: string; title: string }[];
  total_walk_min: number; total_price: number; when: string }
/** A route to draw: street geometry, Persian turns, distance and minutes (source "straight": the street server was unreachable). */
export interface RouteStep { text: string; distance_m: number; at_m: number; lat: number; lon: number; type: string; modifier: string; street: string }
export interface RoutePlan { source: "osrm" | "straight"; mode: "walk" | "car"; distance_m: number; minutes: number; points: [number, number][]; steps: RouteStep[] }
/** Which shops to ask first and why: the model's pick over the real candidates (source "rules": the catalogue's own ranking). */
export interface Advice { picks: { shop_id: string; reason: string }[]; headline: string | null; tip: string | null; source: "llm" | "rules"; when: string }
export interface ShopsForProduct {
  origin: [number, number] | null; listed: ShopCard[]; category_only: ShopCard[]; counts: { listed: number; category_only: number };
  zones?: Zone[]; fair_price?: FairPrice | null; when?: string; at?: string | null;
}
export interface CompareResult {
  products: ProductDetail[]; rows: { key: string; values: (string | null)[]; differs: boolean; best?: number[] | null }[];
  insights?: CompareInsights; availability?: Record<string, Availability>;
}
export interface Mall { mall_key: string; mall: string; area: string | null; shop_count: number }
export interface MallDirectory extends Mall {
  lat: number; lon: number;
  floors: { floor: number | null; label: string; shops: { shop_id: string; name: string; unit: string | null; plaque: string | null; offer_count: number; categories: string[] }[] }[];
}
export type InquiryStatus = "sent" | "delivered" | "answered" | "unavailable" | "no_reply";
export type InquiryKind = "ask" | "hold" | "recheck" | "arrive" | "bargain";
export interface Drift {
  price: number; listed: number | null; vs_listed_pct: number | null; market_median: number | null; vs_market_pct: number | null;
  cheaper_nearby: { shop_id: string; name: string; price: number; confirmed: boolean; distance_km: number | null; mall: string | null }[];
  shops_compared: number; alert: boolean; summary: string | null;
}
export interface Answer {
  available: boolean | null; price: number | null; message: string | null; closes_at: string | null; installment: boolean | null; simulated: boolean;
  channel?: "web" | "bale" | "sim"; summary?: string; parsed_by?: "llm" | "rules";
  restock?: string; opens_at?: string; warranty?: string; original?: boolean; variants_available?: string[]; variants_unavailable?: string[];
  alt_suggestion?: string; answers?: Record<string, string>; same_as_listed?: boolean; listing_updated?: boolean; drift?: Drift | null;
  hold_accepted?: boolean | null; hold_code?: string; hold_until?: string; bargain_accepted?: boolean | null;
}
export interface ThreadMsg { role: "buyer" | "seller" | "agent" | "system"; text: string; channel: string; simulated: boolean; at: string }
export interface Inquiry {
  id: string; session_id: string; status: InquiryStatus; label: string; kind: InquiryKind; parent_id: string | null;
  campaign_id: string | null; auto_from: string | null; hold_until: string | null; hold_code?: string | null; eta_min: number | null; target?: number | null;
  created_at: string; delivered_at: string | null; answered_at: string | null; deadline_at: string;
  questions: { key: string; text: string; custom?: boolean }[]; note: string | null; answer: Answer | null;
  thread: ThreadMsg[]; awaiting_seller: boolean; simulated_seller: boolean; listed_price: number | null;
  shop: Pick<ShopCard, "shop_id" | "name" | "mall" | "floor_label" | "unit" | "area" | "address" | "lat" | "lon"> | null;
  product: { product_id: string; title: string; image: string | null } | null;
  alternatives?: { kind: "same_product" | "similar_product"; shops: ShopCard[]; products: Product[] };
}

export interface Campaign {
  id: string; session_id: string; product_id: string; status: "running" | "done" | "exhausted" | "stopped";
  wave: number; target: number; asked: number; queued: number; confirmed: number; failed: number; waiting: number;
  tomorrow: boolean; skipped_closed: number; next: { shop_id: string; name: string | null; why: string | null }[];
  reasons: Record<string, string>; created_at: string;
}
export interface CustomQuestion { key: string; text: string; why: string; source: "llm" | "rules" }
export interface Report { id: string; shop_id: string; product_id: string; kind: "visit" | "call"; available: boolean | null; price: number | null; price_matched: boolean | null; inquiry_id: string | null; created_at?: string }

export interface WherePlace {
  kind: "mall" | "area"; name: string; area: string; shop_count: number; shops_with_listed_prices: number; common_floors: (string | null)[];
  lat: number; lon: number; distance_km: number; walk_min: number; links: { neshan: string; balad: string; google: string };
}
export interface WhereToLook {
  query: string; confidence: "high" | "medium" | "low" | "none"; matched_categories: { name: string; shops: number }[];
  places: WherePlace[]; dataset_shops: number; search_link?: string | null;
}

export interface ReviewPoint { text: string; spec_key: string; spec_value: string }
export interface ProductReview {
  product_id: string; title: string; key_specs: { key: string; value: string }[]; pros: ReviewPoint[]; cons: ReviewPoint[]; tips: string[];
  reputation: { text: string; confidence: "high" | "medium"; source: "general_knowledge"; verified: false } | null;
  generated_by: string | null; cached: boolean; disclaimer: string;
}

export interface PhotoRead {
  brand: string | null; brand_fa: string | null; model: string | null; product_type: string | null; search_query: string | null;
  price_seen: number | null; price_text: string | null; visible_text: string | null; confidence: "high" | "medium" | "low";
}
export interface IdentifyResult {
  read: PhotoRead; query: string | null; candidates: Product[];
  /** exact: this model · related: only accessories/parts of it · type_only: no model readable · none */
  match: "exact" | "related" | "type_only" | "none";
}

export interface ParsedMission {
  text: string; query: string | null; need: string | null; category: string | null;
  budget: { min: number | null; max: number | null } | null;
  place: { kind: "mall" | "area"; label: string; lat: number; lon: number; mall_key?: string; area?: string } | null;
  when: string | null; mode: "walk" | "taxi" | "car" | null; conditions: { installment: boolean; open: boolean };
  understood: ("product" | "need" | "budget" | "place" | "when" | "mode" | "installment")[];
}

export interface PlanStop {
  order: number; shop_id: string; name: string; mall: string | null; floor_label: string | null; unit: string | null; plaque: string | null; area: string | null;
  lat: number; lon: number; arrive_at: string; closes_at: string | null; walk_min_from_previous: number; confirmed_by_seller: boolean; confirmed_price: number | null;
  inquiry_id: string | null; hold: { code: string; until: string | null } | null; rechecked_at: string | null; late: boolean; tight: boolean;
  warnings: { level: "bad" | "warn"; text: string }[]; in_traffic_zone: boolean;
}
export interface VisitPlan {
  start: { label: string; lat: number; lon: number; time: string }; stops: PlanStop[]; total_walk_min: number; same_mall: string | null;
  transport: { in_traffic_zone: boolean; suggestion: string | null }; deep_links: { neshan: string; balad: string; google: string } | null; checklist: string[];
}

export interface IntakeQuestion { slot: "query" | "need" | "budget" | "place" | "when" | "mode" | "other"; text: string; options: string[] }
export interface IntakeResult {
  slots: {
    query: string | null; category: string | null; need: string | null; budget: { min: number | null; max: number | null } | null;
    place: { kind: "mall" | "area"; label: string; lat: number; lon: number; mall_key?: string; area?: string } | null;
    when: string | null; mode: "walk" | "taxi" | "car" | null; conditions: { installment: boolean; open: boolean };
    /** other products of the same sentence, each one the catalogue really lists: they join the trip's basket */
    more?: { query: string; category: string | null }[];
  };
  exact: boolean; questions: IntakeQuestion[]; assumed: string[]; summary: string; engine: "llm" | "rules"; trace: string[];
}
export type IntakeEvent = { type: "status"; text: string } | ({ type: "result" } & IntakeResult) | { type: "error"; message: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Login token (optional accounts). Kept in localStorage; sent on every API call so a user's session stays private.
const AUTH_KEY = "tg-auth";
export interface User { id: string; username: string; session_id: string }
export const authStore = {
  get(): { token: string; user: User } | null { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; } },
  set(v: { token: string; user: User } | null) { try { if (v) localStorage.setItem(AUTH_KEY, JSON.stringify(v)); else localStorage.removeItem(AUTH_KEY); } catch {} },
};
export const authHeader = (): Record<string, string> => { const a = typeof window === "undefined" ? null : authStore.get(); return a ? { Authorization: `Bearer ${a.token}` } : {}; };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${path}`, { ...init, headers: { "Content-Type": "application/json", ...authHeader(), ...init?.headers } });
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
  sort?: "best" | "price" | "distance" | "freshness"; priority?: Priority;
}
export interface SearchExtra {
  prefs?: Constraint[] | null; spec?: string[]; near_only?: boolean; installment_only?: boolean; open_only?: boolean;
  sort?: "price" | "near" | null; when?: string | null;
}

export const api = {
  search: (p: { q?: string; category?: string; brand?: string; price_min?: number | null; price_max?: number | null; limit?: number; offset?: number }, loc?: Loc, x: SearchExtra = {}) => {
    const spec = (x.spec ?? []).map((v) => `&spec=${encodeURIComponent(v)}`).join("");
    return req<SearchResult>(`/search/products${qs({ limit: 20, ...p, ...at(loc), prefs: x.prefs?.length ? JSON.stringify(x.prefs) : null, near_only: x.near_only,
      installment_only: x.installment_only, open_only: x.open_only, sort: x.sort, when: x.when && x.when !== "now" ? x.when : null })}${spec}`);
  },
  pulse: (p: { lat: number; lon: number; radius_km?: number; product_id?: string; weekday?: string; limit?: number }) => req<Pulse>(`/pulse${qs(p)}`),
  extras: (product_id: string, mall_key: string) => req<{ items: Extra[] }>(`/extras${qs({ product_id, mall_key })}`),
  basketPlan: (b: { product_ids: string[]; lat?: number; lon?: number; when?: string | null }) =>
    req<BasketPlan>(`/basket/plan`, { method: "POST", body: JSON.stringify({ ...b, when: b.when && b.when !== "now" ? b.when : null }) }),
  route: (from: { lat: number; lon: number }, to: { lat: number; lon: number }, mode: "walk" | "car") =>
    req<RoutePlan>(`/route${qs({ from_lat: from.lat, from_lon: from.lon, to_lat: to.lat, to_lon: to.lon, mode })}`),
  advise: (b: { product_id: string; lat?: number; lon?: number; when?: string | null; need?: string | null; priority?: Priority; budget_max?: number | null; installment?: boolean }) =>
    req<Advice>(`/mission/advise`, { method: "POST", body: JSON.stringify({ ...b, when: b.when && b.when !== "now" ? b.when : null }) }),
  missionParse: (text: string) => req<ParsedMission>(`/mission/parse`, { method: "POST", body: JSON.stringify({ text }) }),
  presets: (category: string) => req<{ category: string; presets: Preset[]; source: "llm" | "rules" }>(`/category-presets${qs({ category })}`),
  specFacets: (category: string) => req<{ items: SpecFacet[] }>(`/spec-facets${qs({ category })}`),
  areas: () => req<{ items: Area[] }>(`/areas`),
  insights: (id: string, loc: Loc, when?: string | null) => req<Insights>(`/products/${encodeURIComponent(id)}/insights${qs({ ...at(loc), when: when && when !== "now" ? when : null })}`),
  compareVerdict: (ids: string[], need: string | null, loc: Loc) => req<Verdict>(`/products/compare/verdict`, { method: "POST", body: JSON.stringify({ ids, need, ...at(loc) }) }),
  compareShops: (id: string, ids: string[], loc: Loc, priority: Priority, when?: string | null) =>
    req<ShopCompare>(`/products/${encodeURIComponent(id)}/shops/compare${qs({ ids: ids.join(","), ...at(loc), priority, when: when && when !== "now" ? when : null })}`),
  product: (id: string) => req<ProductDetail>(`/products/${encodeURIComponent(id)}`),
  similar: (id: string, limit = 6) => req<{ items: Product[] }>(`/products/${encodeURIComponent(id)}/similar${qs({ limit })}`),
  compare: (ids: string[], loc?: Loc) => req<CompareResult>(`/products/compare`, { method: "POST", body: JSON.stringify({ ids, ...at(loc) }) }),
  productShops: (id: string, loc: Loc, f: ShopFilters = {}, limit = 40, when?: string | null) =>
    req<ShopsForProduct>(`/products/${encodeURIComponent(id)}/shops${qs({ ...at(loc), ...f, priority: f.priority && f.priority !== "balanced" ? f.priority : null, limit, when: when && when !== "now" ? when : null })}`),
  shop: (id: string, loc: Loc) => req<ShopDetail>(`/shops/${encodeURIComponent(id)}${qs(at(loc))}`),
  malls: (limit = 12) => req<{ items: Mall[] }>(`/malls${qs({ limit })}`),
  mall: (key: string) => req<MallDirectory>(`/malls/${encodeURIComponent(key)}`),
  whereToLook: (p: { q: string; category?: string | null; hint?: string | null }, loc: Loc) =>
    req<WhereToLook>(`/where-to-look${qs({ q: p.q, category: p.category, hint: p.hint, ...at(loc) })}`),
  identify: (image: string) => req<IdentifyResult>(`/identify`, { method: "POST", body: JSON.stringify({ image }) }),
  review: (id: string) => req<ProductReview>(`/products/${encodeURIComponent(id)}/review`),
  topCategories: (limit = 8) => req<{ items: { name: string; multi_shop_products: number }[] }>(`/categories/top${qs({ limit })}`),
  getSession: (id: string) => req<Record<string, unknown>>(`/sessions/${id}`),
  putSession: (id: string, state: Record<string, unknown>) => req(`/sessions/${id}`, { method: "PUT", body: JSON.stringify({ state }) }),
  questions: () => req<{ items: { key: string; text: string }[] }>(`/inquiry-questions`),
  createInquiries: (b: { session_id: string; shop_ids: string[]; product_id: string; questions: string[]; custom?: Record<string, string>; note?: string | null; timeout_s?: number }) =>
    req<{ items: Inquiry[] }>(`/inquiries`, { method: "POST", body: JSON.stringify(b) }),
  productQuestions: (id: string) => req<{ base: { key: string; text: string }[]; custom: CustomQuestion[] }>(`/products/${encodeURIComponent(id)}/inquiry-questions`),
  smartInquiries: (b: { session_id: string; product_id: string; questions: string[]; custom?: Record<string, string>; note?: string | null; timeout_s?: number; wave?: number; target?: number; max_shops?: number; shop_ids?: string[] }) =>
    req<Campaign>(`/inquiries/smart`, { method: "POST", body: JSON.stringify(b) }),
  campaigns: (sid: string) => req<{ items: Campaign[] }>(`/sessions/${sid}/campaigns`),
  stopCampaign: (sid: string, id: string) => req<Campaign>(`/campaigns/${id}/stop`, { method: "POST", body: JSON.stringify({ session_id: sid }) }),
  hold: (sid: string, id: string, until: string) => req<Inquiry>(`/inquiries/${id}/hold`, { method: "POST", body: JSON.stringify({ session_id: sid, until }) }),
  recheck: (sid: string, id: string, eta_min?: number | null, demo_gone = false) => req<Inquiry>(`/inquiries/${id}/recheck`, { method: "POST", body: JSON.stringify({ session_id: sid, eta_min, demo_gone }) }),
  transcribe: async (audio: Blob): Promise<{ text: string }> => {
    const r = await fetch(`/api/transcribe`, { method: "POST", headers: { "Content-Type": audio.type || "audio/webm" }, body: audio });
    if (!r.ok) { let msg = "صدا خوانده نشد؛ بنویسید."; try { const j = await r.json(); if (typeof j.detail === "string") msg = j.detail; } catch { /* keep the default */ } throw new Error(msg); }
    return r.json();
  },
  bargain: (sid: string, id: string, target: number) => req<Inquiry>(`/inquiries/${id}/bargain`, { method: "POST", body: JSON.stringify({ session_id: sid, target }) }),
  arrive: (sid: string, id: string) => req<Inquiry>(`/inquiries/${id}/arrive`, { method: "POST", body: JSON.stringify({ session_id: sid }) }),
  visitPlan: (b: { session_id: string; product_id: string; lat?: number; lon?: number; order?: string[] }) => req<VisitPlan>(`/visit-plan`, { method: "POST", body: JSON.stringify(b) }),
  report: (b: { session_id: string; shop_id: string; product_id: string; kind: "visit" | "call"; available: boolean | null; price?: number | null; price_matched?: boolean | null; inquiry_id?: string | null; note?: string | null }) =>
    req<Report>(`/reports`, { method: "POST", body: JSON.stringify(b) }),
  rateReport: (reportId: string, session_id: string, rating: number) =>
    req<{ id: string; rating: number }>(`/reports/${encodeURIComponent(reportId)}/rating`, { method: "POST", body: JSON.stringify({ session_id, rating }) }),
  reports: (sid: string) => req<{ items: Report[] }>(`/sessions/${sid}/reports`),
  baleFollow: (sid: string) => req<{ enabled: boolean; bot_username?: string | null; command?: string; linked?: boolean }>(`/sessions/${sid}/bale`),
  inquiries: (sid: string) => req<{ items: Inquiry[] }>(`/sessions/${sid}/inquiries`),
  sellerInbox: (shop: string, token: string) =>
    req<{ shop: { shop_id: string; name: string; mall: string | null; unit: string | null }; bale?: { enabled: boolean; bot_username?: string | null; linked?: boolean; command?: string }; stats?: Partial<Reliability> & { listing_updates: number }; items: Inquiry[] }>(`/seller/${shop}/${token}/inquiries`),
  sellerAnswer: (shop: string, token: string, id: string, a: Partial<Answer> & { update_listing?: boolean }) =>
    req<Inquiry>(`/seller/${shop}/${token}/inquiries/${id}/answer`, { method: "POST", body: JSON.stringify(a) }),
  sellerReply: (shop: string, token: string, id: string, text: string) =>
    req<{ follow_up: string | null; inquiry: Inquiry }>(`/seller/${shop}/${token}/inquiries/${id}/reply`, { method: "POST", body: JSON.stringify({ text }) }),
  sellerUpdateListing: (shop: string, token: string, id: string) =>
    req<Inquiry>(`/seller/${shop}/${token}/inquiries/${id}/update-listing`, { method: "POST" }),
  // EventSource cannot send headers, so an account's token rides in the query string (HTTPS in production)
  eventsUrl: (sid: string) => { const a = typeof window === "undefined" ? null : authStore.get(); return `${process.env.NEXT_PUBLIC_EVENTS_BASE ?? ""}/api/sessions/${sid}/events${a ? `?token=${encodeURIComponent(a.token)}` : ""}`; },
  signup: (username: string, password: string, session_id: string) =>
    req<{ user: User; token: string }>(`/auth/signup`, { method: "POST", body: JSON.stringify({ username, password, session_id }) }),
  login: (username: string, password: string, session_id: string) =>
    req<{ user: User; token: string }>(`/auth/login`, { method: "POST", body: JSON.stringify({ username, password, session_id }) }),
  me: () => req<{ user: User }>(`/auth/me`),
  logout: () => req<{ ok: boolean }>(`/auth/logout`, { method: "POST" }),
};
