import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/** Public, indexable pages. /pair is gated (per-pair key) so it's excluded. */
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/manifesto", "/register", "/connect", "/trail"];
  return routes.map((path) => ({
    url: `${env.appUrl}${path}`,
    changeFrequency: path === "/trail" ? "hourly" : "weekly",
    priority: path === "" || path === "/manifesto" ? 1 : 0.7,
  }));
}
