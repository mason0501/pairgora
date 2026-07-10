import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // API + per-pair view + admin aren't content to index
      disallow: ["/api/", "/pair", "/admin"],
    },
    sitemap: `${env.appUrl}/sitemap.xml`,
    host: env.appUrl,
  };
}
