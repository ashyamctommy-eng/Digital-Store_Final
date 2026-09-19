import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const basePath = isProd ? "/riotgear-storev11" : "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: isProd ? `${basePath}/` : "",
  images: {
    unoptimized: true,
  },
  // Exposed to the client so src/lib/asset.ts can prefix local /assets URLs.
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
