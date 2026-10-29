#!/usr/bin/env node
/**
 * Builds the cPanel (HostNin) production bundle.
 *
 *   node scripts/build-cpanel.mjs
 *
 * Output: ./dist — ready to upload with cPanel File Manager or FTP.
 *
 *   dist/
 *     index.html, 404.html, products/, account/, admin/, ...   the static site
 *     _next/            hashed JS/CSS/fonts
 *     assets/images/    product icons
 *     api/              PHP payment endpoints (see server/api/)
 *     .htaccess         HTTPS, caching, security and webhook rules
 *
 * The API folder must be deployed for payments to work: a purely static upload
 * cannot create a Palplus STK push or receive a NOWPayments IPN.
 */

import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "out");
const distDir = path.join(root, "dist");
const serverApiDir = path.join(root, "server", "api");
const installerSrc = path.join(root, "installer.sh");
const htaccessSrc = path.join(root, "deploy", "cpanel", ".htaccess");

const log = (msg) => console.log(`  ${msg}`);

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

async function main() {
  // ---------------------------------------------------------------
  // 0. Regenerate the server-side catalog map from the TS catalog
  // ---------------------------------------------------------------
  console.log("\n▸ Syncing the server-side catalog map\n");
  execFileSync("node", [path.join(root, "scripts", "sync-catalog.mjs")], {
    cwd: root,
    stdio: "inherit",
  });

  // ---------------------------------------------------------------
  // 1. Build the static export from the domain root
  // ---------------------------------------------------------------
  console.log("\n▸ Building static export for cPanel (basePath = \"\")\n");

  if (existsSync(outDir)) await rm(outDir, { recursive: true, force: true });
  if (existsSync(distDir)) await rm(distDir, { recursive: true, force: true });

  execFileSync("npx", ["next", "build"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      // Empty basePath: the site lives at the domain root.
      NEXT_PUBLIC_BASE_PATH: "",
    },
  });

  if (!existsSync(outDir)) {
    throw new Error("next build did not produce ./out — check the build output above.");
  }

  // ---------------------------------------------------------------
  // 2. Promote out/ to dist/
  // ---------------------------------------------------------------
  console.log("\n▸ Assembling dist/\n");
  await cp(outDir, distDir, { recursive: true });
  log("copied static export → dist/");

  // ---------------------------------------------------------------
  // 3. Payment API (PHP)
  // ---------------------------------------------------------------
  if (!existsSync(serverApiDir)) {
    throw new Error("server/api is missing — cannot produce a working payment bundle.");
  }
  await cp(serverApiDir, path.join(distDir, "api"), { recursive: true });
  if (!existsSync(installerSrc)) {
    throw new Error("installer.sh is missing — cannot prepare admin credentials for deployment.");
  }
  const installerDest = path.join(distDir, "installer.sh");
  await cp(installerSrc, installerDest);
  await chmod(installerDest, 0o755);
  log("copied installer.sh (admin login + runtime configuration)");

  // The PHP test suite, its stubs and the concurrency harness are development
  // tools. They have no business on a production web root: they hold fixtures
  // that look like credentials, and every file under the document root is
  // reachable unless something explicitly blocks it. Removed here rather than
  // relying on .htaccess alone.
  for (const unwanted of ["tests", "data"]) {
    const target = path.join(distDir, "api", unwanted);
    if (existsSync(target)) {
      await rm(target, { recursive: true, force: true });
    }
  }
  // The order ledger and the stock queue must be writable by PHP at runtime, and
  // an EMPTY directory does not survive zipping — the stock directory would go
  // missing on the server and the first upload would fail for a reason that
  // looks like a permissions problem. A placeholder file keeps both in the
  // archive.
  const dataDir = path.join(distDir, "api", "data");
  await mkdir(path.join(dataDir, "inventory"), { recursive: true });
  await writeFile(
    path.join(dataDir, ".gitkeep"),
    "# Development fallback only. installer.sh configures private external storage.\n"
  );
  await writeFile(
    path.join(dataDir, "inventory", ".gitkeep"),
    "# Development fallback only. installer.sh configures private external storage.\n"
  );
  log("copied PHP payment API → dist/api/");
  log("created development fallback data directories (installer uses private external storage)");

  // Never ship a config with real keys in the bundle; only the sample.
  const configPath = path.join(distDir, "api", "config.php");
  if (existsSync(configPath)) {
    await rm(configPath, { force: true });
    log("removed api/config.php from the bundle (configure it on the server)");
  }

  // ---------------------------------------------------------------
  // 4. Apache config
  // ---------------------------------------------------------------
  if (!existsSync(htaccessSrc)) {
    throw new Error("deploy/cpanel/.htaccess is missing.");
  }
  await cp(htaccessSrc, path.join(distDir, ".htaccess"));
  log("copied .htaccess (HTTPS, caching, security, webhook rules)");

  // Leave the Pages marker out of the cPanel bundle.
  const nojekyll = path.join(distDir, ".nojekyll");
  if (existsSync(nojekyll)) {
    await rm(nojekyll, { force: true });
    log("removed .nojekyll (GitHub Pages only)");
  }

  // ---------------------------------------------------------------
  // 5. Report
  // ---------------------------------------------------------------
  const bytes = await dirSize(distDir);

  async function countFiles(dir, ext) {
    let n = 0;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) n += await countFiles(path.join(dir, entry.name), ext);
      else if (entry.name.endsWith(ext)) n += 1;
    }
    return n;
  }

  const html = await countFiles(distDir, ".html");
  const php = await countFiles(distDir, ".php");

  console.log("\n▸ Bundle ready\n");
  log(`dist/            ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  log(`html pages       ${html}`);
  log(`php endpoints    ${php}`);
  log("api/             PHP endpoints");
  log(".htaccess        Apache rules");
  console.log(`
  Next steps
  ----------
  1. Upload the CONTENTS of dist/ to your domain's document root
     (usually public_html/) via cPanel File Manager or FTP.
  2. In the document root, run the installer as root (VPS) or the PHP-FPM
     account (shared hosting): sudo bash installer.sh
     Set the admin email/password, public URL, environment, private data path,
     and PHP-FPM user. The installer creates config.php and stores only a
     password hash outside the web root.
  3. Sign in at /admin, then add payment/provider credentials under
     Configurations. Do not paste keys into this installer or README.
  4. Point the Palplus channel callback and the NOWPayments IPN at
     https://<your-domain>/api/palplus/webhook
     https://<your-domain>/api/nowpayments/webhook
  5. Visit /api/config-status to confirm the gateways report "configured".
  6. In the admin console, check Integrations and Stock & Credentials.
`);
}

main().catch((err) => {
  console.error(`\n✗ cPanel build failed: ${err.message}\n`);
  process.exit(1);
});
