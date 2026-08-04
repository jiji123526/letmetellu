import type { MetadataRoute } from "next";

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_ORIGIN || "https://yapndot.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms"],
      disallow: [
        "/api/",
        "/ch/",
        "/dashboard",
        "/reset-password",
        "/support",
        "/verify-email",
      ],
    },
    host: APP_ORIGIN,
  };
}
