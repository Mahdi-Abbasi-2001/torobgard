// Runtime proxy to the FastAPI backend. Replaces the build-time rewrite in next.config.ts so API_URL can be set
// per environment (Liara env var) without rebuilding. More specific routes win over this catch-all:
//   sessions/[id]/events and chat/[id] stream SSE through untouched.
const API_URL = process.env.API_URL ?? "http://localhost:8765";

export const dynamic = "force-dynamic";

async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const target = `${API_URL}/api/${path.map(encodeURIComponent).join("/")}${url.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: { "Content-Type": req.headers.get("content-type") ?? "application/json", Accept: req.headers.get("accept") ?? "*/*" },
    cache: "no-store",
    signal: req.signal,
  };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.text();
  let up: Response;
  try {
    up = await fetch(target, init);
  } catch {
    return Response.json({ detail: "سرور در دسترس نیست؛ کمی بعد دوباره امتحان کنید." }, { status: 502 });
  }
  // fetch() already decoded the body, so drop encoding/length headers instead of forwarding them
  return new Response(up.body, { status: up.status, headers: { "Content-Type": up.headers.get("content-type") ?? "application/json" } });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
