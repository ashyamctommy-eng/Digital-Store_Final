#!/usr/bin/env node
/**
 * Publishes the built site to a `deploy` branch, so a host with a Git
 * deployment feature (Hostinger hPanel, cPanel Git™ Version Control) can serve
 * it directly.
 *
 *   GITHUB_TOKEN=… npm run deploy:branch
 *
 * Why a separate branch: the repository root is the Next.js *source*, which is
 * not servable — it holds `src/`, `node_modules`-era config and no `index.html`.
 * A host that clones `main` into `public_html` would publish a directory of
 * TypeScript. `deploy` contains only the contents of `dist/`, so its root *is*
 * the document root.
 *
 * How it publishes: a throwaway repository is created in a temp directory,
 * `dist/` is copied into it, committed, and force-pushed to the `deploy` branch.
 * Nothing touches your working tree or `main`, and the deploy branch history is
 * intentionally disposable — each deploy is one commit.
 *
 * Two files are deliberately NOT in the bundle, and are expected to survive on
 * the server between deploys:
 *
 *   api/config.php          the bootstrap config (data_dir, admin_api_key)
 *   api/data/               the order ledger, stock queue and settings.json
 *
 * If your host's Git deploy deletes untracked files, those are removed too and
 * the store loses its orders and saved credentials. `scripts/deploy-branch.mjs`
 * prints a reminder, and DEPLOY.md explains how to check.
 */

import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(root, "dist");
const BRANCH = process.env.DEPLOY_BRANCH || "deploy";

function run(args, cwd, env = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

// --------------------------------------------------------------------- checks

if (!existsSync(DIST)) {
  fail("dist/ does not exist. Run `npm run build:cpanel` first (or use `npm run deploy:branch:build`).");
}

const distEntries = await readdir(DIST);
if (!distEntries.includes("index.html")) {
  fail("dist/ has no index.html — it does not look like a finished build.");
}

// A published bundle must never contain key material. Fail loudly rather than
// relying on the gitignore that protects the source repo.
for (const forbidden of ["api/config.php"]) {
  if (existsSync(path.join(DIST, forbidden))) {
    fail(
      `dist/${forbidden} exists. It holds live gateway keys and must never be published.\n` +
        `  Remove it from the build output and keep it on the server only.`
    );
  }
}

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

if (!token) {
  fail(
    "No token. Set GITHUB_TOKEN (a PAT with Contents: write on this repo).\n" +
      "  Nothing is committed to your working tree, so this is the only credential needed."
  );
}

/**
 * Which remote to publish to.
 *
 * A clone can carry several — this project has the upstream source as `origin`
 * and the real target as `final` — and silently pushing a deploy branch to the
 * wrong one is worse than refusing. `DEPLOY_REMOTE` overrides; otherwise the
 * first of these that exists wins, and the choice is printed.
 */
const remotes = (() => {
  try {
    return run(["remote"], root).split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
})();

const chosen =
  process.env.DEPLOY_REMOTE ||
  ["deploy", "final", "origin"].find((name) => remotes.includes(name));

if (!chosen || !remotes.includes(chosen)) {
  fail(
    `No usable remote. Found: ${remotes.join(", ") || "none"}.\n` +
      "  Set DEPLOY_REMOTE to the name of the remote that points at your deploy repository."
  );
}

const remote = run(["remote", "get-url", chosen], root).replace(/\/\/.*@/, "//");
const url = new URL(remote.startsWith("http") ? remote : `https://${remote}`);

console.log(`▸ Deploying to remote "${chosen}" — ${url.host}${url.pathname}`);

// -------------------------------------------------------------------- publish

const temp = path.join(os.tmpdir(), `dhs-deploy-${Date.now()}`);
const credDir = path.join(os.tmpdir(), `dhs-cred-${Date.now()}`);
await mkdir(temp, { recursive: true });
await mkdir(credDir, { recursive: true });

try {
  console.log("▸ Staging dist/ for the deploy branch");
  for (const entry of distEntries) {
    await cp(path.join(DIST, entry), path.join(temp, entry), { recursive: true });
  }

  const bytes = await (async function size(dir) {
    let total = 0;
    for (const entry of await readdir(dir)) {
      const full = path.join(dir, entry);
      const info = await stat(full);
      total += info.isDirectory() ? await size(full) : info.size;
    }
    return total;
  })(temp);

  // A note so that anyone who deploys later sees what must not be lost.
  await writeFile(
    path.join(temp, "DEPLOY-README.txt"),
    [
      "This branch is generated. Do not edit it by hand.",
      "",
      "Source:    https://github.com/" + url.pathname.replace(/^\/|\.git$/g, "") + " (main)",
      "Built by:  scripts/deploy-branch.mjs",
      "",
      "The web root for this site is THIS directory.",
      "",
      "These paths are NOT part of the repository and must survive a redeploy:",
      "  api/config.php   bootstrap config (data_dir, admin_api_key)",
      "  api/data/        order ledger, stock queue, settings.json",
      "",
      "If your host's Git deploy removes untracked files, it will delete both,",
      "and the store loses its orders and saved credentials with them. Back them",
      "up before redeploying, and restore them afterwards.",
      "",
      "After the first deploy:",
      "  1. cp api/config.sample.php api/config.php  and set admin_api_key + data_dir",
      "  2. chmod 755 api/data api/data/inventory",
      "  3. Open /admin/configurations and paste the gateway credentials there.",
      "",
    ].join("\n"),
    "utf8"
  );

  // The token goes in a temporary credential file, never in the push URL: git
  // prints the URL verbatim when a push is rejected, which would put the token
  // straight into a build log.
  //
  // The file lives OUTSIDE the staging directory. An earlier version wrote it
  // inside `temp`, where `git add -A` staged it and the deploy branch would have
  // published the token to the repository. GitHub's push protection caught that;
  // this script now refuses to publish if anything token-shaped is staged.
  const credFile = path.join(credDir, ".git-credentials");
  await writeFile(credFile, `https://x-access-token:${token}@${url.host}\n`, {
    mode: 0o600,
  });

  const git = (args, env) => run(args, temp, env);

  git(["init", "-q"]);
  git(["checkout", "-q", "-b", BRANCH]);
  git(["add", "-A"]);

  // Refuse to publish a bundle that contains the token, or anything else that
  // looks like a live credential. `git add -A` is convenient, and exactly the
  // kind of convenience that ships a secret.
  //
  // `git grep` exits 1 when it matches nothing, which is the good outcome here,
  // so its exit code cannot be treated as a failure.
  const stagedMatches = (args) => {
    try {
      return run(["grep", "--cached", "-l", ...args, "--", "."], temp).trim();
    } catch {
      return "";
    }
  };

  const tokenHit = stagedMatches(["-e", token]);
  if (tokenHit !== "") {
    fail(
      `Refusing to publish: the built bundle contains the deploy token (in ${tokenHit}).\n` +
        "  That is a bug in this script or the build, not something to push past."
    );
  }
  for (const pattern of [
    "ghp_[A-Za-z0-9]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "-----BEGIN [A-Z ]*PRIVATE KEY-----",
  ]) {
    const hit = stagedMatches(["-E", "-e", pattern]);
    if (hit !== "") {
      fail(`Refusing to publish: ${hit} contains what looks like a live credential.`);
    }
  }
  git(
    [
      "-c",
      "user.name=Digital Hub Shop deploy",
      "-c",
      "user.email=deploy@localhost",
      "commit",
      "-q",
      "-m",
      `Deploy ${new Date().toISOString()}`,
    ],
    {
      GIT_AUTHOR_DATE: new Date().toISOString(),
      GIT_COMMITTER_DATE: new Date().toISOString(),
    }
  );

  console.log(`▸ Pushing to ${BRANCH} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
  try {
    git([
      "-c",
      "credential.helper=",
      "-c",
      `credential.https://${url.host}.helper=store --file=${credFile}`,
      "-c",
      `credential.https://${url.host}.useHttpPath=false`,
      "push",
      "--force",
      remote,
      `HEAD:refs/heads/${BRANCH}`,
    ]);
  } catch (err) {
    // Belt and braces: if anything did echo the credential file, redact it.
    const text = `${err.stderr ?? ""}${err.stdout ?? ""}${err.message ?? ""}`
      .split(token)
      .join("[redacted]");
    if (/403|denied|Permission/i.test(text)) {
      fail(
        `Push to "${chosen}" was refused.\n` +
          `  ${text.trim().split("\n").slice(0, 4).join("\n  ")}\n\n` +
          "  Check that the token has Contents: write on that repository, and that\n" +
          "  DEPLOY_REMOTE points at the right one."
      );
    }
    fail(text.trim().split("\n").slice(0, 6).join("\n"));
  }

  console.log("\n▸ Done\n");
  console.log(`  branch   ${BRANCH}`);
  console.log(`  files    ${distEntries.length} top-level entries`);
  console.log(`  size     ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`
  Point your host's Git deployment at:
    repository  https://github.com/${url.pathname.replace(/^\/|\.git$/g, "")}
    branch      ${BRANCH}
    directory   your document root (often public_html)

  Then, on the server, once:
    cp api/config.sample.php api/config.php     # set admin_api_key + data_dir
    chmod 755 api/data api/data/inventory
    open /admin/configurations                  # paste gateway credentials

  Afterwards: use the host's "Deploy" / "Pull" action to fetch new builds.
  Check api/config.php and api/data/ still exist — see DEPLOY.md.
`);
} finally {
  await rm(temp, { recursive: true, force: true });
  await rm(credDir, { recursive: true, force: true });
}
