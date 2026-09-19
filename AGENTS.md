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
