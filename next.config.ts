import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Served by a custom Node server (server.ts) that also owns the realtime WS
  // upgrade, so we run the full build via next()'s programmatic API rather than
  // the standalone server.js.
};

export default nextConfig;
