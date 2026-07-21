import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal self-contained server build for Docker deployment (Fly.io).
  output: "standalone",
};

export default nextConfig;
