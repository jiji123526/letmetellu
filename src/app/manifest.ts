import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "yap.",
    short_name: "yap.",
    description: "링크 하나로 시작하는 익명 채팅",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/yap-logo-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/yap-logo-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/yap-logo-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
