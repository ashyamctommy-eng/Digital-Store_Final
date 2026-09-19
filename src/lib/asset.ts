/**
 * Prefixes a public asset path with the deployment basePath.
 *
 * The site is a static export served from a GitHub Pages sub-path in
 * production, so any hand-written `src="/assets/..."` would 404 there.
 * Always route local assets through this helper.
 *
 * The value is injected at build time from next.config.ts.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function asset(path: string): string {
  if (!path) return path;
  // Leave absolute URLs (CDN, data:, blob:) untouched.
  if (/^(https?:)?\/\//.test(path) || path.startsWith("data:") || path.startsWith("blob:")) {
    return path;
  }
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
