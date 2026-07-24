import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA || "local",
  },
};

export default nextConfig;
