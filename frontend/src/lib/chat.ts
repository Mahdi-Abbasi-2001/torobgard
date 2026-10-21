// Chat agent client: POST /api/chat/{sid}, parse the SSE stream into typed events (docs/api-contract.md).
import type { CompareResult, Inquiry, Product, ShopCard, WherePlace } from "./api";

export type Block =
  | { type: "product_cards"; query: string; total: number; items: Product[]; applied: { price_min?: number | null; price_max?: number | null }; title?: string }
  | { type: "comparison_table"; products: CompareResult["products"]; rows: CompareResult["rows"] }
  | { type: "shop_list"; product: { product_id: string; title: string; image: string | null } | null; listed: ShopCard[]; category_only: ShopCard[]; counts: { listed: number; category_only: number } }
  | { type: "chips"; question: string; options: string[] }
  | { type: "inquiry_proposal"; product: { product_id: string; title: string; image: string | null } | null; shops: { shop_id: string; name: string; mall: string | null; floor_label: string | null; unit: string | null; area: string | null }[]; questions: { key: string; text: string }[] }
  | { type: "inquiry_status"; items: Inquiry[] }
  | { type: "location_widget"; query: string; confidence: "high" | "medium" | "low" | "none"; matched_categories: { name: string; shops: number }[]; places: WherePlace[]; dataset_shops: number; knowledge_hint: string | null; search_link: string | null };

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool_status"; tool: string; text: string }
  | { type: "block"; block: Block }
  | { type: "degraded"; reason: string }
  | { type: "error"; message: string }
  | { type: "done" };

export async function streamChat(sid: string, message: string, onEvent: (e: ChatEvent) => void, signal?: AbortSignal) {
  let r: Response;
  try {
    r = await fetch(`/api/chat/${encodeURIComponent(sid)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }), signal });
  } catch {
    throw new Error("اتصال به اینترنت برقرار نیست.");
  }
  if (!r.ok || !r.body) {
    let msg = "مشکلی پیش آمد. دوباره امتحان کنید.";
    try { const j = await r.json(); if (typeof j.detail === "string") msg = j.detail; } catch {}
    throw new Error(msg);
  }
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (line) { try { onEvent(JSON.parse(line.slice(5))); } catch {} }
    }
  }
}
