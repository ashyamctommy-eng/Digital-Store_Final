# Next Session Handoff

## Project

- Source: `digital-store-source` — Next.js storefront with a PHP JSON API.
- GitHub target: https://github.com/ashyamctommy-eng/Digital-Store_Final, branch `main`.
- The workspace's configured Git remote is the internal `gitsafe-backup`; do not push project changes to it. Use the connected GitHub integration for the target repository.
- The verified signup and account-owned order changes were pushed to GitHub `main` in commit `b300c0807cbe9ac18a5d115978a56f7dfe445c77`.
- The owner plans a fresh VPS deployment on an already-owned domain. Deployment has not happened yet.

## Completed

- Reworked the admin overview with order, revenue, pending-order, and stock metrics.
- Added persistent, live product-catalog management, including activate/deactivate controls and proxy plan fields.
- Improved regular inventory management. Proxy inventory is excluded from public stock counts and manual proxy stock uploads are blocked.
- Added secure server-side GhostProxies API-key configuration and an admin data browser for stats, settings, pools, countries, locations, ASNs, and reseller data. Provider requests use `https://ghostproxies.net` and the `x-api-key` header.
- Added Novita-powered product-description drafts to the admin product form. The browser calls an admin-protected PHP endpoint; the API key/model stay server-side, drafts are validated and editable, and no product is saved automatically.
- Added a read-only Novita configuration test and a shared limit of 20 description requests per hour.
- Added Firebase-independent email/password signup with a 24-hour single-use Resend verification link. Unverified accounts cannot sign in; verification tokens are stored as hashes and kept in the URL fragment, and auth attempts are rate-limited.
- Added verified-email order linking and a server-backed account order list. Only order summaries are returned in the list; credentials remain protected by the order retrieval token or the verified account's private ownership index. Account-owned orders can retrieve their delivery without the browser's old token.
- Added VPS deployment and Nginx configuration notes in `DEPLOY-VPS.md` and `deploy/vps/nginx.conf`.
- Replaced the admin Google-email allowlist and browser API-key prompts with installer-created email/password login, separate HttpOnly admin sessions, rate-limited login, CSRF checks on mutations, idle/absolute expiry, and logout.
- Expanded `installer.sh` to ask only for the domain and admin login on a fresh install. It derives the HTTPS URL and Resend sender, defaults to live mode, detects PHP-FPM/private storage, and supports `--sandbox` and `--app-only`.
- On root Debian/Ubuntu VPS installs, the installer can install Nginx/PHP-FPM/Certbot, configure a protected site, open UFW ports 80/443 when active, and request Let's Encrypt TLS. DNS must already point to the VPS; non-Debian/Ubuntu and shared-hosting deployments use `--app-only`.
- The installer stores only a password hash outside the web root; `--reset-admin` preserves the existing config and store data. The Nginx/Apache release rules also block public access to `installer.sh`.
- Updated the admin console and all admin API routes to use sessions, retaining `x-admin-key` only for legacy server-to-server requests. Updated cPanel/VPS deployment guides and added HTTP tests for login, cookies, CSRF, logout, and API-key-free session access.

## Safety State and Blockers

- Proxy checkout is deliberately blocked with `PROXY_FULFILLMENT_UNAVAILABLE`. Static proxy inventory is not delivered.
- Do not enable proxy generation until a documented or sanitized successful `/api/proxy/generate` response confirms the credential fields and how retries/quota usage behave. The supplied status example does not confirm the generation response. Do not make a generate call without authorization to spend provider quota.
- Proxy dashboard remains incomplete. The account order list is implemented, but GhostProxies `/api/stats` is account-wide, not buyer-specific. Do not expose global stats or another buyer's credentials.
- Order auto-linking requires a verified local PHP account and an exact normalized match to the ledger's `buyer_email`. Firebase/Google sessions do not establish a PHP account session and do not receive cross-device order access. Keep the original per-order token flow for guest and Firebase-only buyers.
- Email signup requires Resend API key, verified sender address, and public HTTPS site URL configured on the VPS. Replit secrets do not transfer to the VPS.
- Proxy refresh still depends on a documented/sanitized successful generation response and verified quota/retry behavior. Keep fulfillment and customer refresh blocked until those are confirmed.
- After deployment, run `sudo bash installer.sh` on Debian/Ubuntu after DNS points at the VPS; use `bash installer.sh --app-only` for managed/shared hosting and `bash installer.sh --reset-admin` to replace only the admin login.

## Verification

- `npm run test:php` passes after admin-session and installer work:
  - Requirements: 53 files and 183 project functions.
  - Unit tests: 303 passed.
  - Concurrency: 40 units claimed with no duplicate deliveries.
  - HTTP tests: 212 passed, including admin-session authorization, CSRF rejection, and logout.
- The installer was exercised in a temporary release copy for fresh setup and admin reset; it created the hash-only credential file with mode 0600 and preserved `config.php` on reset.
- Installer checks cover domain-to-HTTPS and Resend sender defaults, live and sandbox modes, isolated Nginx site generation, and rollback when certificate issuance fails. A full real-VPS Certbot issuance was not run from this workspace.
- A live Novita API request using the configured runtime secrets returned valid JSON in the same format used by the draft endpoint. No secrets were printed or saved.
- PHP lint, HTTP test shell syntax, and `git diff --check` pass.
- The 12 changed TypeScript/TSX files pass a syntax-only parse. Full frontend typecheck and lint remain unverified because Next.js, React, Firebase, and ESLint dependencies are absent from the workspace install; the typecheck produces cascading missing-module errors. A previous dependency install was blocked by a security rejection.

## Security and Deployment

- A GhostProxies API key was shared in chat. Treat it as exposed: revoke and rotate it, do not repeat it or commit it, and enter the replacement through the server-side admin setting after deployment.
- `NOVITA_API_KEY` and `NOVITA_MODEL` are Replit secrets and are consumed server-side. Never print or commit their values. They do not transfer automatically to the VPS; configure them there through the admin settings or PHP runtime environment.
- Admin credentials are stored as a hash in `<data_dir>/admin-credentials.json`; keep the external data directory and `api/config.php` out of Git and deployment archives.
- The requested project changes were pushed to the target GitHub repository; keep secrets, dependency folders, caches, and build outputs out of future commits.

## Infrastructure Priorities

1. Automate encrypted offsite backups of the external data directory and test restoring orders, settings, and inventory.
2. Keep the PHP JSON-file store on one VPS only; plan a database migration before adding multiple API instances or horizontal scaling.
3. Add uptime/health alerts for the storefront, PHP API, payment callbacks, and backup failures.
4. Run `npm run verify` in GitHub Actions for pull requests before deploying releases.

## Next Actions

1. Deploy the latest GitHub `main` branch to the fresh VPS using `DEPLOY-VPS.md`; no VPS deployment has happened yet. Point DNS first, then run `sudo bash installer.sh` and configure provider keys.
2. Configure and verify Resend on the VPS, then test signup, email verification and account-owned order retrieval on the public domain.
3. Confirm GhostProxies' generate response and quota/idempotency behavior using a sanitized response before enabling proxy fulfillment or a customer proxy dashboard.
4. Add automated offsite backups and a restore check before the VPS begins holding live orders.
