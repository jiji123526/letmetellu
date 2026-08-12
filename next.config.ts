import type { NextConfig } from "next";

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function getWorkerOrigins() {
  const rawWorkerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  try {
    const workerUrl = new URL(rawWorkerUrl);
    const wsProtocol = workerUrl.protocol === "https:" ? "wss:" : "ws:";
    return unique([
      workerUrl.origin,
      `${wsProtocol}//${workerUrl.host}`,
    ]);
  } catch {
    return ["http://localhost:8787", "ws://localhost:8787"];
  }
}

function buildContentSecurityPolicy() {
  const workerOrigins = getWorkerOrigins();
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-eval'"]),
  ];
  const connectSrc = [
    "'self'",
    "blob:",
    ...workerOrigins,
    "https://cdn.jsdelivr.net",
  ];
  const frameSrc = [
    "'self'",
  ];

  const directives = [
    "default-src 'self'",
    `script-src ${unique(scriptSrc).join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    `connect-src ${unique(connectSrc).join(" ")}`,
    `frame-src ${unique(frameSrc).join(" ")}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
  ];

  if (process.env.VERCEL_ENV === "production") {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

function buildSecurityHeaders() {
  const headers = [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy() },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
    { key: "X-Frame-Options", value: "DENY" },
  ];

  if (process.env.VERCEL_ENV === "production") {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000",
    });
  }

  return headers;
}

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  env: {
    APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA || "local",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
