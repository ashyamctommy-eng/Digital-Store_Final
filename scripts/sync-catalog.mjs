#!/usr/bin/env node
/**
 * Generates `server/api/lib/catalog.php` from `src/lib/products.ts`.
 *
 * The PHP backend needs to know which products are fulfilled as SMS and which
 * as proxy IP lists, plus the on-demand provider spec for each — it cannot read
 * TypeScript. Rather than hand-maintaining a second copy that silently drifts,
 * the map is generated at build time so the TS catalog stays the single source
 * of truth.
 *
 * This matters for money: fulfilment decides whether to spend the store's
 * provider balance, and it must never trust metadata sent by the browser.
 *
 * Run directly with `npm run sync:catalog`; `build:cpanel` runs it first.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "src", "lib", "products.ts");
const OUT = path.join(root, "server", "api", "lib", "catalog.php");
const OUT_PRODUCTS = path.join(root, "server", "api", "lib", "catalog-products.json");

function literalValue(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => literalValue(element));
  }
  if (ts.isObjectLiteralExpression(node)) {
    const result = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text
        : null;
      if (key) result[key] = literalValue(property.initializer);
    }
    return result;
  }
  if (ts.isParenthesizedExpression(node)) return literalValue(node.expression);
  throw new Error(`Unsupported catalog value in products.ts: ${node.getText()}`);
}

function readFullProductList(source) {
  const file = ts.createSourceFile(SRC, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "products" &&
        declaration.initializer &&
        ts.isArrayLiteralExpression(declaration.initializer)
      ) {
        return declaration.initializer.elements.map((item) => literalValue(item));
      }
    }
  }
  throw new Error("Could not find the products array in src/lib/products.ts.");
}

/** Splits the catalog source into one string per product object. */
function productBlocks(source) {
  return source.split(/\n  \{\n/).slice(1).filter((block) => /^\s*id:\s*"/m.test(block));
}

function fieldOf(block, name) {
  return block.match(new RegExp(`${name}:\\s*"([^"]*)"`))?.[1];
}

/** Parses the `sms: { … }` one-liner or block of an SMS product. */
function parseSms(block, id) {
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
  return {
    service_id: serviceId,
    country_id: countryId,
    server_id: field("server_id") ?? "1",
    label: field("label") ?? serviceId,
  };
}

/** Parses the `proxy: { … }` spec of a proxy product. */
function parseProxy(block, id) {
  const proxyBlock = block.match(/proxy:\s*\{([^}]*)\}/s)?.[1];
  if (!proxyBlock) {
    throw new Error(`Product "${id}" is delivery_kind proxy but has no proxy spec.`);
  }
  const string = (name) => proxyBlock.match(new RegExp(`${name}:\\s*"([^"]*)"`))?.[1];
  const number = (name) => proxyBlock.match(new RegExp(`${name}:\\s*(\\d+)`))?.[1];

  const perUnit = Number.parseInt(number("per_unit") ?? "", 10);

  if (!Number.isFinite(perUnit) || perUnit < 1) {
    throw new Error(`Product "${id}" is missing a positive proxy.per_unit.`);
  }

  // Only the unit size matters now: addresses are stocked by hand, so there is
  // no provider to filter by country or protocol. The checker reports the real
  // protocol, which is better than a static claim anyway.
  return { per_unit: perUnit, label: string("label") ?? "Proxy IPs" };
}

function parseCatalog(source) {
  const sms = [];
  const proxies = [];
  const prices = [];

  for (const block of productBlocks(source)) {
    const id = fieldOf(block, "id");
    if (!id) continue;

    // Every product needs a server-side price. The browser must never be the
    // one that decides what a thing costs: a checkout endpoint that trusts a
    // posted amount lets a buyer pay whatever they like.
    const price = Number.parseFloat(
      block.match(/price_usd:\s*([\d.]+)/)?.[1] ?? ""
    );
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Product "${id}" has no usable price_usd.`);
    }
    prices.push({ id, price_usd: price, name: fieldOf(block, "name") ?? id });

    const kind = block.match(/delivery_kind:\s*"([^"]+)"/)?.[1];
    if (kind === "sms") sms.push({ id, ...parseSms(block, id) });
    else if (kind === "proxy") proxies.push({ id, ...parseProxy(block, id) });
  }

  return { sms, proxies, prices };
}

const esc = (value) => String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

function smsEntries(rows) {
  return rows
    .map(
      (r) => `    '${esc(r.id)}' => [
        'service_id' => '${esc(r.service_id)}',
        'country_id' => '${esc(r.country_id)}',
        'server_id' => '${esc(r.server_id)}',
        'label' => '${esc(r.label)}',
    ],`
    )
    .join("\n");
}

function priceEntries(rows) {
  return rows
    .map((r) => `    '${esc(r.id)}' => ${r.price_usd},`)
    .join("\n");
}

function proxyEntries(rows) {
  return rows
    .map(
      (r) => `    '${esc(r.id)}' => [
        'per_unit' => ${r.per_unit},
        'label' => '${esc(r.label)}',
    ],`
    )
    .join("\n");
}

const source = await readFile(SRC, "utf8");
const fullProducts = readFullProductList(source);
const { sms, proxies, prices } = parseCatalog(source);

const php = `<?php
/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced by scripts/sync-catalog.mjs from src/lib/products.ts, which is the
 * single source of truth for the catalog. Run \`npm run sync:catalog\` after
 * changing product delivery kinds or provider specs.
 *
 * The backend needs this because fulfilling an order on demand spends real
 * money, and must not depend on metadata sent by the browser.
 */

declare(strict_types=1);

require_once __DIR__ . '/product-catalog.php';

/** product_id => on-demand provider spec, for delivery_kind "sms" products. */
const CATALOG_SMS_PRODUCTS = [
${smsEntries(sms)}
];

/** product_id => pool spec, for delivery_kind "proxy" products. */
const CATALOG_PROXY_PRODUCTS = [
${proxyEntries(proxies)}
];

/**
 * product_id => base price in USD.
 *
 * This exists so the SERVER can compute what an order costs. The browser sends
 * a price for display, but the checkout endpoints price the cart from this
 * table instead — otherwise a buyer could post amountUsd: 0.01 and have the
 * webhook confirm a payment that matched the price they chose themselves.
 *
 * Note KV pairs are reversed (JS needs quoting); PHP consts work the same way.
 */
const CATALOG_PRICES = [
${priceEntries(prices).replace(/'(\S+)' => /g, "'$1' => ")}
];

/** The delivery kind recorded in the catalog, or null for an unknown product. */
function catalog_delivery_kind(string $productId): ?string
{
    $product = catalog_product_runtime($productId);
    return $product === null || empty($product['delivery_kind'])
        ? null
        : (string) $product['delivery_kind'];
}

/** True when a product is fulfilled as a phone number + inbox. */
function catalog_is_sms(string $productId): bool
{
    return catalog_delivery_kind($productId) === 'sms';
}

/** True when a product is fulfilled as an IP:PORT list. */
function catalog_is_proxy(string $productId): bool
{
    return catalog_delivery_kind($productId) === 'proxy';
}

/** The provider spec for an SMS product, or null. */
function catalog_sms_spec(string $productId): ?array
{
    $product = catalog_product_runtime($productId);
    $spec = $product['sms'] ?? null;
    return is_array($spec) ? $spec : null;
}

/** The pool spec for a proxy product, or null. */
function catalog_proxy_spec(string $productId): ?array
{
    $product = catalog_product_runtime($productId);
    $spec = $product['proxy'] ?? null;
    return is_array($spec) ? $spec : null;
}

/** Every SMS product id. */
function catalog_sms_product_ids(): array
{
    return array_values(array_map(
        static fn (array $p): string => (string) $p['id'],
        array_filter(catalog_products_runtime(), static fn (array $p): bool => ($p['delivery_kind'] ?? '') === 'sms')
    ));
}

/** Every proxy product id. */
function catalog_proxy_product_ids(): array
{
    return array_values(array_map(
        static fn (array $p): string => (string) $p['id'],
        array_filter(catalog_products_runtime(), static fn (array $p): bool => ($p['delivery_kind'] ?? '') === 'proxy')
    ));
}

/** Base price in USD for a product, or null when the product is unknown. */
function catalog_price_usd(string $productId): ?float
{
    $product = catalog_product_runtime($productId);
    return $product !== null && isset($product['price_usd'])
        ? (float) $product['price_usd']
        : null;
}

/** Every product id the server can price. */
function catalog_product_ids(): array
{
    return array_values(array_map(
        static fn (array $p): string => (string) $p['id'],
        catalog_products_runtime()
    ));
}
`;

await writeFile(OUT, php);
await writeFile(OUT_PRODUCTS, JSON.stringify(fullProducts, null, 2) + "\n");

console.log(
  `  synced ${prices.length} priced product(s) (${sms.length} SMS, ${proxies.length} proxy) -> server/api/lib/catalog.php`
);
for (const r of prices) {
  console.log(`    price  ${r.id.padEnd(16)} \$${r.price_usd.toFixed(2)}`);
}
for (const r of sms) {
  console.log(`    sms    ${r.id.padEnd(16)} ${r.label} (service ${r.service_id}, country ${r.country_id})`);
}
for (const r of proxies) {
  console.log(`    proxy  ${r.id.padEnd(16)} ${r.label} (${r.per_unit} per unit)`);
}
