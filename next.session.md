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
- Added Novita-powered product-description drafts to the admin product form. The browser calls an admin-protected PHP endpoint; the API key/model stay server-side, drafts are validated and editable, and no product is saved automatically.
- Added a read-only Novita configuration test and a shared limit of 20 description requests per hour.
- Added VPS deployment and Nginx configuration notes in `DEPLOY-VPS.md` and `deploy/vps/nginx.conf`.

## Safety State and Blockers

- Proxy checkout is deliberately blocked with `PROXY_FULFILLMENT_UNAVAILABLE`. Static proxy inventory is not delivered.
- Do not enable proxy generation until a documented or sanitized successful `/api/proxy/generate` response confirms the credential fields and how retries/quota usage behave. The supplied status example does not confirm the generation response. Do not make a generate call without authorization to spend provider quota.
- A customer proxy dashboard was requested but is not implemented. Current credential retrieval requires the unique per-order token; Firebase sign-in is not bound to order ownership on the server. GhostProxies `/api/stats` is account-wide, not a buyer-specific usage endpoint. Do not expose global stats or another buyer's credentials.
- Proxy refresh still depends on a documented/sanitized successful generation response and verified quota/retry behavior. Keep fulfillment and customer refresh blocked until those are confirmed.

## Verification

- `npm run test:php` passed after the Novita work:
  - Requirements: 41 files and 155 project functions.
  - Unit tests: 303 passed.
  - Concurrency: 40 units claimed with no duplicate deliveries.
  - HTTP tests: 153 passed.
- A live Novita API request using the configured runtime secrets returned valid JSON in the same format used by the draft endpoint. No secrets were printed or saved.
- PHP lint passed for the new Novita files, and `git diff --check` passed.
- Frontend typechecking was attempted but cannot complete because the project has no local Next.js, React, or Node type packages; the resulting thousands of cascading errors are dependency-resolution failures. Lint/build checks were not run; a prior package install was blocked by a dependency security rejection.
- Frontend TypeScript, lint, and build checks remain unverified: project dependencies are absent, and a prior package install was blocked by a dependency security rejection.

## Security and Deployment

- A GhostProxies API key was shared in chat. Treat it as exposed: revoke and rotate it, do not repeat it or commit it, and enter the replacement through the server-side admin setting after deployment.
- `NOVITA_API_KEY` and `NOVITA_MODEL` are Replit secrets and are consumed server-side. Never print or commit their values. They do not transfer automatically to the VPS; configure them there through the admin settings or PHP runtime environment.
- Before pushing, include only project content from this directory; exclude secrets, dependency folders, caches, and build outputs.

## Infrastructure Priorities

1. Automate encrypted offsite backups of the external data directory and test restoring orders, settings, and inventory.
2. Keep the PHP JSON-file store on one VPS only; plan a database migration before adding multiple API instances or horizontal scaling.
3. Add uptime/health alerts for the storefront, PHP API, payment callbacks, and backup failures.
4. Run `npm run verify` in GitHub Actions for pull requests before deploying releases.

## Next Actions

1. Confirm the latest project delta is present on the target GitHub repository's `main` branch before deploying to the VPS.
2. Confirm GhostProxies' generate response and quota/idempotency behavior using a sanitized response before enabling proxy fulfillment.
3. Implement the requested customer proxy dashboard only after secure order ownership and plan-bound refresh limits are enforced server-side.
4. Add automated offsite backups and a restore check before the VPS begins holding live orders.
