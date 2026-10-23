// Intake agent stream (SSE over POST). Same reason as the chat route: the generic /api rewrite would buffer the events.
const API_URL = process.env.API_URL ?? "http://localhost:8765";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const upstream = await fetch(`${API_URL}/api/mission/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: await req.text(),
    signal: req.signal,
    cache: "no-store",
  });
  if (!upstream.body) return new Response("upstream unavailable", { status: 502 });
  if (!upstream.ok) return new Response(await upstream.text(), { status: upstream.status, headers: { "Content-Type": "application/json" } });
  return new Response(upstream.body, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" },
  });
}
