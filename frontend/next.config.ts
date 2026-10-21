import type { NextConfig } from "next";

// The browser talks to /api/* on this origin; Next proxies it to the FastAPI backend.
const API_URL = process.env.API_URL ?? "http://localhost:8765";

const nextConfig: NextConfig = {
  async rewrites() {
    // `fallback` runs after app routes (incl. dynamic ones), so src/app/api/** handlers can override single endpoints.
    return { beforeFiles: [], afterFiles: [], fallback: [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }] };
  },
};

export default nextConfig;
