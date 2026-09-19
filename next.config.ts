import type { NextConfig } from "next";

/**
 * Deployment base path.
 *
 * cPanel / HostNin serves the site from the domain root, so this must be "".
 * GitHub Pages serves from /<repo> and needs it set explicitly:
 *
 *   NEXT_PUBLIC_BASE_PATH=/riotgear-storev11 npm run build
 *
 * Keeping it env-driven (rather than keyed off NODE_ENV) means the same source
 * builds correctly for both targets.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  // Fully static output — no Node server required on the host.
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath ? `${basePath}/` : "",
  images: {
    // Required for `output: "export"`.
    unoptimized: true,
  },
  // Exposed to the client so src/lib/asset.ts can prefix local /assets URLs.
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    // Lets the payments layer point at an API on another host if ever needed.
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "/api",
  },
};

export default nextConfig;
