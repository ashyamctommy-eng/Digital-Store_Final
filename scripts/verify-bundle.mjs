#!/usr/bin/env node
/**
 * Verifies that `dist/` is safe and complete to upload to a live host.
 *
 * Run before every deploy:  npm run verify:bundle
 *
 * This is the last line of defence between a build and a public web root. It
 * checks the things that are expensive to discover afterwards:
 *
 *   - a file the site needs is missing (a blank page, or a broken checkout)
 *   - something that must NOT be published is in the bundle (a live key)
 *   - a PHP file has a syntax error (a 500 on one endpoint only)
 *   - the frontend calls an endpoint that does not exist (a broken button)
 *   - real customer data got swept into the archive
 *
 * Exits non-zero on any failure so it can gate a deploy.
 */

import { execFileSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(root, "dist");

const failures = [];
const warnings = [];
const notes = [];

const fail = (m) => failures.push(m);
const warn = (m) => warnings.push(m);
const note = (m) => notes.push(m);

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push({ path: full, rel: path.relative(base, full), size: (await stat(full)).size });
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error("✗ dist/ does not exist. Run `npm run build:cpanel` first.");
  process.exit(1);
}

const files = await walk(DIST);
const rels = new Set(files.map((f) => f.rel.split(path.sep).join("/")));
const totalBytes = files.reduce((n, f) => n + f.size, 0);

console.log(`\n▸ Bundle: ${files.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB\n`);

/* ------------------------------------------------------------------ 1. shape */

for (const required of ["index.html", "404.html", ".htaccess", "assets", "_next", "api"]) {
  if (!rels.has(required) && !files.some((f) => f.rel.startsWith(required + path.sep))) {
    fail(`missing required entry: ${required}`);
  }
}

// Every route is a real directory with its own index.html (static export).
const htmlFiles = files.filter((f) => f.rel.endsWith(".html"));
if (htmlFiles.length < 30) {
  fail(`only ${htmlFiles.length} HTML pages — the export looks incomplete`);
}

const pages = htmlFiles
  .map((f) => f.rel.split(path.sep).join("/"))
  .filter((r) => r.endsWith("index.html"))
  .map((r) => "/" + r.replace(/index\.html$/, ""))
  .sort();

for (const page of ["/", "/account/orders/", "/admin/", "/admin/configurations/", "/admin/inventory/"]) {
  if (!pages.includes(page)) fail(`expected page is missing from the build: ${page}`);
}
note(`${pages.length} routes contain their own index.html`);

/* --------------------------------------------------------------- 2. no secrets */

if (rels.has("api/config.php")) {
  fail("api/config.php is in the bundle — it holds live gateway keys. Remove it.");
}

// Patterns that would mean a real credential leaked into the build. The Firebase
// web API key is intentionally public (it ships in every Firebase web app and is
// protected by security rules), so it is reported as a note, not a failure.
const SECRET_PATTERNS = [
  ["ghp_[A-Za-z0-9]{20,}", "a GitHub token"],
  ["github_pat_[A-Za-z0-9_]{20,}", "a GitHub PAT"],
  ["nex_live_[A-Za-z0-9]{8,}", "a NextProxy key"],
  ["sk_live_[A-Za-z0-9]{16,}", "a live secret key"],
  ["re_[A-Za-z0-9]{20,}", "a Resend key"],
  ["-----BEGIN [A-Z ]*PRIVATE KEY-----", "a private key"],
  ["eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\.", "a signed JWT"],
];
const LIVE_KEY_PATTERNS = [/^pk_live_[A-Za-z0-9]{16,}$/m];

let firebaseKeys = 0;
for (const file of files) {
  if (!/\.(html|js|json|php|txt|css|map)$/.test(file.rel)) continue;
  const text = await readFile(file.path, "utf8").catch(() => "");
  if (text === "") continue;

  for (const [pattern, label] of SECRET_PATTERNS) {
    if (new RegExp(pattern).test(text)) fail(`${file.rel} appears to contain ${label}`);
  }
  // A real Palplus key must never be committed or published.
  for (const pattern of LIVE_KEY_PATTERNS) {
    if (pattern.test(text) && !file.rel.endsWith("config.sample.php")) {
      fail(`${file.rel} appears to contain a live Palplus key`);
    }
  }
  if (/AIza[0-9A-Za-z_-]{35}/.test(text)) firebaseKeys++;
}
if (firebaseKeys > 0) {
  note(
    `Firebase web API key present in ${firebaseKeys} file(s) — expected and public by design, ` +
      `but it means Firestore security rules are the only thing protecting your data`
  );
}

/* ----------------------------------------------------------- 3. no source/data */

for (const file of files) {
  const rel = file.rel.split(path.sep).join("/");
  if (/\.(ts|tsx|mjs|scss)$/.test(rel)) fail(`source file should not ship: ${rel}`);
  if (rel.startsWith("node_modules/") || rel.startsWith(".git/")) {
    fail(`build artefact should not ship: ${rel}`);
  }
}

// Development tooling must not reach a production web root.
for (const file of files) {
  const rel = file.rel.split(path.sep).join("/");
  if (rel.startsWith("api/tests/")) {
    fail(`test scaffolding must not ship: ${rel}`);
  }
}

// Real customer data must never travel inside the archive.
for (const file of files) {
  const rel = file.rel.split(path.sep).join("/");
  if (rel.startsWith("api/data/") && !/\.(gitkeep|htaccess)$/.test(rel)) {
    if (/^(settings\.json|events\.log)$/.test(path.basename(rel)) || rel.includes("/inventory/")) {
      fail(`customer data must not ship: ${rel}`);
    }
  }
}
// The writable directories must exist in the archive, or the first stock upload
// or order write fails with a permissions-looking error that is really "missing".
for (const dir of ["api/data", "api/data/inventory"]) {
  const present = files.some((f) => f.rel.split(path.sep).join("/").startsWith(dir + "/"));
  if (!present) {
    fail(`${dir}/ is missing from the bundle — PHP will not be able to write there`);
  }
}

/* ------------------------------------------------------------- 4. PHP sanity */

const phpFiles = files.filter((f) => f.rel.endsWith(".php"));
const phpBin = process.env.PHP_BIN || "php";
let phpChecked = 0;
let phpUnavailable = false;

for (const file of phpFiles) {
  try {
    execFileSync(phpBin, ["-l", file.path], { stdio: "pipe" });
    phpChecked++;
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    if (/not found|ENOENT/.test(out) || err.code === "ENOENT") {
      phpUnavailable = true;
      break;
    }
    fail(`PHP syntax error in ${file.rel}: ${out.trim().split("\n")[0]}`);
  }
}
if (phpUnavailable) {
  warn("no PHP CLI available — syntax of the bundled endpoints was NOT verified");
} else {
  note(`${phpChecked} PHP files pass a syntax check`);
}

/* ------------------------------------------- 5. frontend ↔ endpoint agreement */

// Every API path the client can call must exist as a PHP file. A typo here is a
// 404 that only appears when a customer presses the button.
//
// Read from the SOURCE, not the bundle: the compiled JS splits `${API_BASE}` and
// the path into separate strings, and matching bare literals in the bundle picks
// up Next.js page routes like "/admin/orders/" as if they were API calls.
const phpRoutes = new Set(
  phpFiles
    .map((f) => f.rel.split(path.sep).join("/"))
    .filter((r) => r.startsWith("api/") && !r.startsWith("api/lib/") && !r.startsWith("api/tests/"))
    .map((r) => "/" + r.replace(/\.php$/, ""))
);

const clientModules = ["src/lib/payments.ts", "src/lib/adminApi.ts"];
const calledPaths = new Set();

for (const rel of clientModules) {
  const source = await readFile(path.join(root, rel), "utf8").catch(() => "");
  for (const match of source.matchAll(/["'`](\/[a-z0-9][a-z0-9/_?=&${}.:-]*)["'`]/gi)) {
    const raw = match[1];
    if (raw === "/api") continue; // the base prefix itself
    if (!/^\/(admin|orders|inventory|palplus|nowpayments|proxies|config-status)/.test(raw)) continue;
    // Drop query strings and path interpolations.
    const clean = raw.split("?")[0].replace(/\/\$\{[^}]*\}/g, "");
    if (clean !== "" && clean !== "/") calledPaths.add(clean);
  }
}

// calledPaths are relative to the API base ("/orders/status"); phpRoutes are
// absolute ("/api/orders/status").
const missing = [...calledPaths].filter((route) => {
  const full = "/api" + route;
  return ![...phpRoutes].some((r) => r === full || r.startsWith(full + "/"));
});

if (missing.length) {
  for (const route of missing) fail(`the client calls /api${route} but no endpoint provides it`);
} else {
  note(`${calledPaths.size} API paths used by the client all resolve to an endpoint`);
}

// Separately: any HARDCODED absolute /api/... string in the shipped bundle must
// also resolve. This catches a URL baked in at build time rather than relative.
const hardcoded = new Set();
for (const file of files) {
  if (!file.rel.endsWith(".js")) continue;
  const text = await readFile(file.path, "utf8").catch(() => "");
  for (const m of text.matchAll(/["'`](\/api\/[a-z0-9][a-z0-9/_-]*)["'`]/gi)) {
    if (m[1] !== "/api/" && !m[1].endsWith("*")) hardcoded.add(m[1]);
  }
}
const badHardcoded = [...hardcoded].filter(
  (route) => ![...phpRoutes].some((r) => r === route || r.startsWith(route + "/"))
);
if (badHardcoded.length) {
  for (const route of badHardcoded) fail(`the bundle hardcodes ${route}, which no endpoint provides`);
}
note(`${phpRoutes.size} PHP endpoints ship`);

/* --------------------------------------------------------------- 6. .htaccess */

const rootHtaccess = await readFile(path.join(DIST, ".htaccess"), "utf8").catch(() => "");
if (!/RewriteEngine On/.test(rootHtaccess)) fail("the root .htaccess has no rewrite rules");
if (!/HTTPS/.test(rootHtaccess)) warn("the root .htaccess does not force HTTPS");
if (/^\s*RewriteRule\s+\^\s+index\.html\s+\[L\]/m.test(rootHtaccess)) {
  fail(
    "the root .htaccess has a blanket SPA fallback enabled — every URL would " +
      "return the homepage and deep links would break"
  );
}

const apiHtaccess = await readFile(path.join(DIST, "api", ".htaccess"), "utf8").catch(() => "");
for (const rule of ["config\\.php", "lib/", "data/", "tests/", "md|txt"]) {
  if (!new RegExp(rule).test(apiHtaccess)) {
    fail(`api/.htaccess does not block ${rule} over HTTP`);
  }
}

/* -------------------------------------------------------------------- verdict */

console.log("▸ Checks\n");
for (const n of notes) console.log(`  ✓ ${n}`);
for (const w of warnings) console.log(`  ! ${w}`);
for (const f of failures) console.log(`  ✗ ${f}`);

console.log("");
if (failures.length) {
  console.log(`✗ ${failures.length} problem(s). Do NOT upload this build.\n`);
  process.exit(1);
}

console.log("✓ Bundle verified — safe to upload.\n");
console.log("  zip it with:");
console.log("    cd dist && zip -qr ../dist-cpanel.zip . -x 'api/config.php' 'api/data/events.log' 'api/data/settings.json' 'api/data/inventory/*.json'");
console.log("");
