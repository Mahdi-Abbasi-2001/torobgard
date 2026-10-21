import type { NextConfig } from "next";

// /api/* is proxied to the FastAPI backend at runtime by src/app/api/[...path]/route.ts (API_URL env var).
const nextConfig: NextConfig = {
  output: "standalone", // self-contained server for the Docker image
};

export default nextConfig;
