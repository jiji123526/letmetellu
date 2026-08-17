import type { MetadataRoute } from "next";

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_ORIGIN || "https://yapndot.com";

export default function robots(): MetadataRoute.Robots {
  const privatePaths = [
    "/api/",
    "/dashboard",
    "/reset-password",
    "/support",
    "/verify-email",
  ];
  return {
    rules: [
      {
        userAgent: "Twitterbot",
        allow: ["/", "/ch/", "/privacy", "/terms"],
        disallow: privatePaths,
      },
      {
        userAgent: "*",
        allow: ["/", "/privacy", "/terms"],
        disallow: ["/ch/", ...privatePaths],
      },
    ],
    host: APP_ORIGIN,
  };
}
