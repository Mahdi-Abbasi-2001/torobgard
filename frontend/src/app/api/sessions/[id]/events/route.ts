// Live inquiry updates (SSE). The generic /api rewrite gzips responses, which holds events back until the
// buffer fills, so this one route streams the backend's event stream through untouched.
const API_URL = process.env.API_URL ?? "http://localhost:8765";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[id]/events">) {
  const { id } = await ctx.params;
  const upstream = await fetch(`${API_URL}/api/sessions/${encodeURIComponent(id)}/events`, {
    headers: { Accept: "text/event-stream" },
    signal: req.signal,
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) return new Response("upstream unavailable", { status: 502 });
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
