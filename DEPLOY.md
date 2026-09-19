# Deploying to HostNin / cPanel

Two ways to get the site onto the server. Pick one and stay with it.

---

## Option A — Git deployment (recommended, since you asked for it)

The repository root is the Next.js **source**, which is not servable: it has
`src/`, config files and no `index.html`. A host that clones `main` into
`public_html` would publish a directory of TypeScript.

So the build is published to a separate **`deploy` branch** whose root *is* the
document root:

```bash
GITHUB_TOKEN=<a PAT with Contents: write> npm run deploy:branch:build
```

That builds, then force-pushes the contents of `dist/` to `deploy`. Your working
tree and `main` are untouched — the script stages a throwaway repository in a
temp directory.

Then in hPanel → **Advanced → Git**:

| Field | Value |
| --- | --- |
| Repository | `https://github.com/ashyamctommy-eng/Digital-Store_Final` |
| Branch | `deploy` |
| Directory | your document root, usually blank (= `public_html`) |
| Deploy on push | optional; otherwise use the Deploy button |

### On the server, once

```bash
cp api/config.sample.php api/config.php
# set admin_api_key and data_dir in api/config.php
chmod 755 api/data api/data/inventory
```

Then open `https://your-domain/admin/configurations` and paste every credential
there. Nothing else needs editing on the server.

### ⚠️ The one thing to check after every deploy

`api/config.php` and `api/data/` are **not** in the repository — one holds your
admin key, the other holds the order ledger, the stock queue and
`settings.json` (your gateway keys). They live on the server.

Git cannot delete what it does not track, **unless your host's deploy runs a
clean**. After a deploy, confirm both still exist:

```bash
ls -la api/config.php api/data/settings.json api/data/
```

If they are gone, your host is cleaning untracked files. Either:

- turn that behaviour off in the Git settings, or
- keep a copy outside the deploy directory and restore it after each deploy, or
- switch to Option B.

**This is not theoretical:** a first-time setup takes one deploy, but every
later deploy risks the ledger. Back up `api/data/` before you redeploy once the
store is live.

---

## Option B — Upload the zip (simplest, no risk to your data)

1. Download `dist-cpanel.zip` (the build deliverable).
2. hPanel → **File Manager** → your document root → **Upload**, then **Extract**.
   Keep dot-files: `.htaccess` matters.
3. Do the same one-time steps as above.

Uploading never deletes anything, so `api/data/` and `api/config.php` survive
untouched. The trade-off is that it is manual and easy to forget a step.

---

## Which to choose

| | Git (A) | Zip (B) |
| --- | --- | --- |
| One command per release | ✅ | ✗ |
| Roll back by deploying an older commit | ✅ | ✗ |
| Cannot endanger `api/data/` | ⚠️ depends on host | ✅ |
| Works with the host's "deploy on push" | ✅ | ✗ |

**If you want the convenience, use Git but verify `api/data/` after the first
two deploys.** If you would rather never think about it, upload the zip.

Either way the credentials are pasted once into **Configurations** and live in
`api/data/settings.json`, so switching between the two later costs nothing.

---

## What is deliberately not in the repository

| Path | Why |
| --- | --- |
| `api/config.php` | Holds `admin_api_key`. A key in git is a key on the internet. |
| `api/data/` | Order ledger, stock queue, `settings.json` — customer data and live credentials. |

`build-cpanel.mjs` strips `api/data/*` and any `config.php` from the bundle, and
`deploy-branch.mjs` refuses to publish if anything token-shaped is staged.

---

## After the first successful deploy

1. `/api/config-status` — the gateways you configured should read `"configured": true`.
2. **Configurations** — the checklist at the top turns green as you fill it in.
   Press **Test connection** on each provider; it checks against the live API and
   tells you what is wrong (wrong key, unverified sending domain, empty Palplus
   service wallet, no default payment channel).
3. **Stock & Credentials** — upload your first batch.
4. Run one small real transaction on each gateway before announcing the store.
