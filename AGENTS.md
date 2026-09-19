<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

## Project notes

This is **Digital Hub Shop**, a static-exported digital products marketplace
(see README.md). A few things that bite when editing:

- Local assets must go through `asset()` from `src/lib/asset.ts` — the
  production build runs under a `/riotgear-storev11` basePath.
- Products, categories, brand and support handles are content files under
  `src/lib/`. Prefer editing those over hardcoding strings in components.
- Browser-persisted state must use `src/lib/browserStore.ts`
  (`useSyncExternalStore`) rather than `useEffect` + `setState`, otherwise the
  `react-hooks/set-state-in-effect` lint rule fails and users see an empty flash.
- `npm run lint` and `npx tsc --noEmit` are both expected to be clean.

### Payments & currency

- Catalog prices are **USD only** (`price_usd`). Never store a KES price; derive
  it with `formatPrice` / `toKES` from `src/lib/currency.ts`.
- Gateway calls never go direct from the browser. They hit `/api/*`, which is
  PHP in `server/api/`. Adding a key to client code is never correct.
- M-Pesa caps `accountReference` at 12 characters and `transactionDesc` at 13.
  The full `ORDER_<PRODUCT_ID>_<TIMESTAMP>` id lives in our ledger; the short
  reference maps back to it.
- Palplus webhooks are unsigned — verify by re-fetching the transaction from the
  Palplus API, never by trusting the payload.
- Order persistence is fire-and-forget. Never `await` a Firestore write on the
  path between "customer clicked pay" and "gateway redirect" — it stalled
  checkout once already.

### Inventory & dispatch

- Credentials live in `server/api/lib/inventory.php`. Claims happen under an
  exclusive `flock`; never read-modify-write inventory without it, or two buyers
  can be handed the same credential.
- `dispatch_order()` is idempotent by design — a repeated webhook must return the
  same units rather than claiming more stock.
- Webhooks answer `json_response_then(...)`: the provider gets its 2xx first and
  dispatch/email run after. Do not move that work before the response.
- Run `npm run test:php` after touching anything in `server/api/`. The
  concurrency test is the one that matters most.

### Hybrid SMS delivery

- `server/api/lib/catalog.php` is GENERATED. Never edit it; run
  `npm run sync:catalog` after changing delivery kinds or SMS specs in
  `src/lib/products.ts`. `build:cpanel` does it automatically.
- The browser must never tell the server how to fulfil an order — fulfilment
  spends real money. Which products are SMS comes from the generated catalog.
- SMS fulfilment order is fixed: pre-bought stock, then the on-demand provider,
  then a recorded shortfall. Do not reorder it, and never call the provider
  before an order is paid.
- If you add a lib that calls a helper from another lib, add the `require_once`.
  `npm run test:php:requires` catches this, and it has been a real bug twice.

### Proxy stock and the checker

- Proxy addresses are **uploaded by hand**. There is no on-demand proxy provider;
  an earlier integration with one was removed deliberately, along with its
  client, admin endpoints and stub. Do not reintroduce a provider without the
  owner asking.
- `server/api/lib/proxyaddr.php` is the single source of truth for "is this a
  deliverable address?". Both the stock parser and the checker go through it. Do
  not add a second validator — the two would drift.
- Proxy units are counted in **addresses**, not units, and only whole units are
  delivered. A partial batch is a shortfall, never a discount.
- The checker only ever tests addresses the buyer already owns (token-gated) or
  that an admin pasted. Never let it become an open proxy-testing service, and
  keep the per-request cap.
- The IP score is our own heuristic, not a reputation lookup. Do not describe it
  to customers as a fraud or abuse score.
