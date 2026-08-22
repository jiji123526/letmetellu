import type { Metadata, Viewport } from "next";
import { getRequestLocale } from "@/lib/server-locale";
import "./globals.css";

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_ORIGIN || "https://yapndot.com";

export const metadata: Metadata = {
  metadataBase: new URL(APP_ORIGIN),
  title: "yap.",
  description: "링크 하나로 시작하는 익명 채팅",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "yap.",
    title: "yap.",
    description: "링크 하나로 시작하는 익명 채팅",
    url: "/",
    images: [{
      url: "/opengraph-image",
      width: 1200,
      height: 630,
      alt: "yap. — 링크 하나로 시작하는 익명 채팅",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "yap.",
    description: "링크 하나로 시작하는 익명 채팅",
    images: ["/opengraph-image"],
  },
  icons: {
    icon: [
      { url: "/logo.svg", media: "(prefers-color-scheme: light)" },
      { url: "/logo-white.svg", media: "(prefers-color-scheme: dark)" },
    ],
    shortcut: [
      { url: "/logo.svg", media: "(prefers-color-scheme: light)" },
      { url: "/logo-white.svg", media: "(prefers-color-scheme: dark)" },
    ],
    apple: [
      { url: "/icons/yap-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "yap.",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (dark) document.documentElement.classList.add('dark');
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
