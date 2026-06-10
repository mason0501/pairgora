import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // R-31 escape hatch: standalone output keeps the app deployable on any
  // Node host (Railway / Cloudflare / self-host), not only Vercel.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  serverExternalPackages: ["pg"],
};

export default nextConfig;
