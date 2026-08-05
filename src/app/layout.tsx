import type { Metadata, Viewport } from "next";
import { getRequestLocale } from "@/lib/server-locale";
import "./globals.css";

export const metadata: Metadata = {
  title: "yap.",
  description: "Anonymous chat platform",
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
      { url: "/logo.svg", media: "(prefers-color-scheme: light)" },
      { url: "/logo-white.svg", media: "(prefers-color-scheme: dark)" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
