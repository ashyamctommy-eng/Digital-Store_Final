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
