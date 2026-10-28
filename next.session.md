# Next Session Handoff

## Project

- Source: `digital-store-source` — Next.js storefront with a PHP JSON API.
- GitHub target: https://github.com/ashyamctommy-eng/Digital-Store_Final, branch `main`.
- The workspace's configured Git remote is the internal `gitsafe-backup`; do not push project changes to it. Use the connected GitHub integration for the target repository.
- The owner plans a fresh VPS deployment on an already-owned domain. Deployment has not happened yet.

## Completed

- Reworked the admin overview with order, revenue, pending-order, and stock metrics.
- Added persistent, live product-catalog management, including activate/deactivate controls and proxy plan fields.
- Improved regular inventory management. Proxy inventory is excluded from public stock counts and manual proxy stock uploads are blocked.
- Added secure server-side GhostProxies API-key configuration and an admin data browser for stats, settings, pools, countries, locations, ASNs, and reseller data. Provider requests use `https://ghostproxies.net` and the `x-api-key` header.
- Added VPS deployment and Nginx configuration notes in `DEPLOY-VPS.md` and `deploy/vps/nginx.conf`.

## Safety State and Blockers

- Proxy checkout is deliberately blocked with `PROXY_FULFILLMENT_UNAVAILABLE`. Static proxy inventory is not delivered.
- Do not enable proxy generation until a documented or sanitized successful `/api/proxy/generate` response confirms the credential fields and how retries/quota usage behave. The supplied status example does not confirm the generation response. Do not make a generate call without authorization to spend provider quota.
- A customer proxy dashboard with fresh-string generation and per-customer usage is not implemented. Current credential retrieval requires the unique per-order token; Firebase sign-in is not bound to order ownership on the server. GhostProxies `/api/stats` is account-wide, not a buyer-specific usage endpoint. Do not expose global stats or another buyer's credentials.
- No choice was confirmed about building a limited read-only proxy view while fulfillment remains blocked.

## Verification

- `npm run test:php` passed:
  - Requirements: 39 files and 150 project functions.
  - Unit tests: 291 passed.
  - Concurrency: 40 units claimed with no duplicate deliveries.
  - HTTP tests: 146 passed.
- PHP lint passed for the GhostProxies, product-catalog, and pricing files.
- A post-change whitespace check has not been completed.
- Frontend TypeScript, lint, and build checks remain unverified: project dependencies are absent, and a prior package install was blocked by a dependency security rejection.

## Security and Deployment

- A GhostProxies API key was shared in chat. Treat it as exposed: revoke and rotate it, do not repeat it or commit it, and enter the replacement through the server-side admin setting after deployment.
- `NOVITA_API_KEY` is a Replit secret. Never print or commit its value.
- Novita was used for this handoff with the user-selected model `moonshotai/kimi-k2.7-code`. `NOVITA_MODEL` is not configured in the environment.
- Before pushing, include only project content from this directory; exclude secrets, dependency folders, caches, and build outputs.

## Next Actions

1. Push the current project delta and this handoff to the target GitHub repository's `main` branch using the connected GitHub integration. Do not push to the internal workspace remote.
2. Obtain a provider-documented or sanitized successful generate response, with credential values masked, and confirm provider quota/idempotency behavior.
3. Agree on customer order ownership and per-customer usage data before enabling proxy refresh or usage features.
4. Keep proxy checkout blocked until live fulfillment and safe credential delivery are verified.
