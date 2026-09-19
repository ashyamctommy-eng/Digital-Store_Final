#!/usr/bin/env node
/**
 * Generates `server/api/lib/catalog.php` from `src/lib/products.ts`.
 *
 * The PHP backend needs to know which products are fulfilled as SMS and what
 * the on-demand provider spec is — it cannot read TypeScript. Rather than
 * hand-maintaining a second copy that silently drifts, the map is generated at
 * build time so the TS catalog stays the single source of truth.
 *
 * Run directly with `npm run sync:catalog`; `build:cpanel` runs it first.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "src", "lib", "products.ts");
const OUT = path.join(root, "server", "api", "lib", "catalog.php");

/** Extracts `id` and the sms spec from each product block in the catalog. */
function parseSmsProducts(source) {
  const rows = [];

  // Split on top-level product object boundaries.
  const blocks = source.split(/\n  \{\n/).slice(1);
  for (const block of blocks) {
    const id = block.match(/^\s*id:\s*"([^"]+)"/m)?.[1];
    if (!id) continue;

    const deliveryKind = block.match(/delivery_kind:\s*"([^"]+)"/)?.[1];
    if (deliveryKind !== "sms") continue;

    const smsBlock = block.match(/sms:\s*\{([^}]*)\}/s)?.[1];
    if (!smsBlock) {
      throw new Error(`Product "${id}" is delivery_kind sms but has no sms spec.`);
    }

    const field = (name) => smsBlock.match(new RegExp(`${name}:\\s*"([^"]*)"`))?.[1];
    const serviceId = field("service_id");
    const countryId = field("country_id");

    if (!serviceId || !countryId) {
      throw new Error(`Product "${id}" is missing sms.service_id or sms.country_id.`);
    }

    rows.push({
      id,
      service_id: serviceId,
      country_id: countryId,
      server_id: field("server_id") ?? "1",
      label: field("label") ?? serviceId,
    });
  }

  return rows;
}

const source = await readFile(SRC, "utf8");
const rows = parseSmsProducts(source);

const entries = rows
  .map(
    (r) => `    '${r.id}' => [
        'service_id' => '${r.service_id}',
        'country_id' => '${r.country_id}',
        'server_id' => '${r.server_id}',
        'label' => '${r.label.replace(/'/g, "\\'")}',
    ],`
  )
  .join("\n");

const php = `<?php
/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced by scripts/sync-catalog.mjs from src/lib/products.ts, which is the
 * single source of truth for the catalog. Run \`npm run sync:catalog\` after
 * changing product delivery kinds or SMS specs.
 *
 * The backend needs this because fulfilling an SMS order on demand costs real
 * money and must not depend on metadata sent by the browser.
 */

declare(strict_types=1);

/** product_id => on-demand provider spec, for delivery_kind "sms" products. */
const CATALOG_SMS_PRODUCTS = [
${entries}
];

/** True when a product is fulfilled as a phone number + inbox. */
function catalog_is_sms(string $productId): bool
{
    return isset(CATALOG_SMS_PRODUCTS[$productId]);
}

/** The provider spec for an SMS product, or null. */
function catalog_sms_spec(string $productId): ?array
{
    return CATALOG_SMS_PRODUCTS[$productId] ?? null;
}

/** Every SMS product id. */
function catalog_sms_product_ids(): array
{
    return array_keys(CATALOG_SMS_PRODUCTS);
}
`;

await writeFile(OUT, php);

console.log(
  `  synced ${rows.length} SMS product(s) -> server/api/lib/catalog.php`
);
for (const r of rows) {
  console.log(`    ${r.id.padEnd(16)} ${r.label} (service ${r.service_id}, country ${r.country_id})`);
}
