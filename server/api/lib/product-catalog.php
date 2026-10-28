<?php
/**
 * Runtime product catalog overlays.
 *
 * The base list is generated from src/lib/products.ts at build time. Admin
 * changes are stored separately under data_dir, so no code deploy is needed.
 * Deleted products are deactivated rather than erased, preserving old orders.
 */

declare(strict_types=1);

require_once __DIR__ . '/http.php';

function product_catalog_base(): array
{
    static $products = null;
    if ($products !== null) {
        return $products;
    }
    $path = __DIR__ . '/catalog-products.json';
    $raw = @file_get_contents($path);
    $decoded = $raw === false ? null : json_decode($raw, true);
    return $products = is_array($decoded) ? $decoded : [];
}

function product_catalog_data_dir(array $config): string
{
    $dir = (string) config_value($config, 'data_dir', __DIR__ . '/../data');
    if ($dir === '') {
        $dir = __DIR__ . '/../data';
    }
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return rtrim($dir, '/');
}

function product_catalog_override_path(array $config): string
{
    return product_catalog_data_dir($config) . '/products.json';
}

function product_catalog_read_overrides(array $config): array
{
    static $cache = [];
    static $cacheGeneration = [];
    $path = product_catalog_override_path($config);
    $generation = (int) ($GLOBALS['__product_catalog_overrides_generation'] ?? 0);
    if (array_key_exists($path, $cache) && ($cacheGeneration[$path] ?? -1) === $generation) {
        return $cache[$path];
    }
    $lock = @fopen($path . '.lock', 'c');
    if ($lock === false) {
        $cacheGeneration[$path] = $generation;
        return $cache[$path] = [];
    }
    @flock($lock, LOCK_SH);
    $raw = @file_get_contents($path);
    @flock($lock, LOCK_UN);
    @fclose($lock);
    $decoded = $raw === false ? null : json_decode($raw, true);
    $cacheGeneration[$path] = $generation;
    return $cache[$path] = is_array($decoded) ? $decoded : [];
}

function product_catalog_write_overrides(array $config, array $overrides): bool
{
    $path = product_catalog_override_path($config);
    $lock = @fopen($path . '.lock', 'c');
    if ($lock === false || !@flock($lock, LOCK_EX)) {
        if (is_resource($lock)) {
            @fclose($lock);
        }
        return false;
    }
    $json = json_encode($overrides, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $tmp = $path . '.' . getmypid() . '.tmp';
    $ok = $json !== false && @file_put_contents($tmp, $json, LOCK_EX) !== false;
    if ($ok) {
        $ok = @rename($tmp, $path);
    }
    if (!$ok) {
        @unlink($tmp);
    } else {
        @chmod($path, 0640);
        product_catalog_read_overrides_forget($path);
    }
    @flock($lock, LOCK_UN);
    @fclose($lock);
    return $ok;
}

function product_catalog_read_overrides_forget(?string $path = null): void
{
    // Request-local static cache is replaced via the global generation.
    $GLOBALS['__product_catalog_overrides_generation'] =
        (int) ($GLOBALS['__product_catalog_overrides_generation'] ?? 0) + 1;
}

/**
 * Returns the live catalog, including inactive entries only for admin/history
 * reads. Runtime overrides are complete product records, not client patches.
 */
function catalog_products_runtime(bool $includeInactive = false): array
{
    static $cache = [];
    $config = is_array($GLOBALS['__store_config'] ?? null) ? $GLOBALS['__store_config'] : [];
    $path = $config ? product_catalog_override_path($config) : '';
    $generation = (int) ($GLOBALS['__product_catalog_overrides_generation'] ?? 0);
    $cacheKey = ($includeInactive ? 'all:' : 'active:') . $path . ':' . $generation;
    if (isset($cache[$cacheKey])) {
        return $cache[$cacheKey];
    }

    $base = product_catalog_base();
    $overrides = $config ? product_catalog_read_overrides($config) : [];
    $byId = [];
    foreach ($base as $product) {
        if (!is_array($product) || !isset($product['id'])) {
            continue;
        }
        $id = (string) $product['id'];
        $saved = $overrides[$id] ?? null;
        if (is_array($saved) && is_array($saved['product'] ?? null)) {
            $product = array_replace($product, $saved['product']);
        }
        $product['active'] = is_array($saved) ? (bool) ($saved['active'] ?? true) : true;
        $byId[$id] = $product;
    }

    foreach ($overrides as $id => $saved) {
        if (isset($byId[$id]) || !is_array($saved) || !is_array($saved['product'] ?? null)) {
            continue;
        }
        $product = $saved['product'];
        $product['id'] = (string) $id;
        $product['active'] = (bool) ($saved['active'] ?? true);
        $byId[(string) $id] = $product;
    }

    $products = array_values(array_filter(
        $byId,
        static fn (array $product): bool => $includeInactive || !empty($product['active'])
    ));
    return $cache[$cacheKey] = $products;
}

function catalog_product_runtime(string $productId): ?array
{
    foreach (catalog_products_runtime(true) as $product) {
        if ((string) ($product['id'] ?? '') === $productId) {
            return $product;
        }
    }
    return null;
}

function catalog_product_is_active(string $productId): bool
{
    $product = catalog_product_runtime($productId);
    return $product !== null && !empty($product['active']);
}

function product_catalog_validate(array $input): array
{
    $errors = [];
    $id = trim((string) ($input['id'] ?? ''));
    $slug = trim((string) ($input['slug'] ?? ''));
    $name = trim((string) ($input['name'] ?? ''));
    $category = trim((string) ($input['category'] ?? ''));
    $price = $input['price_usd'] ?? null;
    $stock = $input['stock'] ?? null;
    $image = trim((string) ($input['image'] ?? ''));
    $description = trim((string) ($input['description'] ?? ''));
    $specs = $input['specs'] ?? null;
    $deliveryKind = (string) ($input['delivery_kind'] ?? 'credentials');

    if (!preg_match('/^[a-z0-9][a-z0-9-]{2,63}$/', $id)) $errors['id'] = 'Use 3–64 lowercase letters, numbers or hyphens.';
    if (!preg_match('/^[a-z0-9][a-z0-9-]{2,95}$/', $slug)) $errors['slug'] = 'Use 3–96 lowercase letters, numbers or hyphens.';
    if ($name === '' || strlen($name) > 120) $errors['name'] = 'Name is required and must be 120 characters or fewer.';
    if (!preg_match('/^[a-z0-9-]{2,48}$/', $category)) $errors['category'] = 'Choose a valid category id.';
    if (!is_numeric($price) || (float) $price <= 0 || (float) $price > 100000) $errors['price_usd'] = 'Price must be greater than 0 and no more than 100,000 USD.';
    if (!is_numeric($stock) || (int) $stock < 0 || (int) $stock > 100000000) $errors['stock'] = 'Stock must be a non-negative whole number.';
    $localImage = str_starts_with($image, '/') && !str_starts_with($image, '//') && !str_contains($image, '..');
    $remoteImage = filter_var($image, FILTER_VALIDATE_URL) !== false
        && in_array(strtolower((string) parse_url($image, PHP_URL_SCHEME)), ['http', 'https'], true);
    if ($image === '' || strlen($image) > 500 || (!$localImage && !$remoteImage)) $errors['image'] = 'Use an asset path or a valid HTTP(S) image URL.';
    if ($description === '' || strlen($description) > 1500) $errors['description'] = 'Description is required and must be 1,500 characters or fewer.';
    if (!is_array($specs) || count($specs) > 20) {
        $errors['specs'] = 'Specs must be a list of up to 20 items.';
    } else {
        foreach ($specs as $spec) {
            if (!is_string($spec) || trim($spec) === '' || strlen($spec) > 240) {
                $errors['specs'] = 'Each spec must be 1–240 characters.';
                break;
            }
        }
    }
    if (!in_array($deliveryKind, ['credentials', 'sms', 'proxy'], true)) {
        $errors['delivery_kind'] = 'Choose credentials, SMS or proxy delivery.';
    }
    if ($deliveryKind === 'proxy') {
        $proxy = is_array($input['proxy'] ?? null) ? $input['proxy'] : [];
        $poolType = (string) ($proxy['pool_type'] ?? 'res');
        $country = strtolower(trim((string) ($proxy['country'] ?? 'any')));
        $protocol = strtolower((string) ($proxy['protocol'] ?? 'http'));
        $dataGb = $proxy['data_gb'] ?? null;
        if (!in_array($poolType, ['res', 'mob', 'dc'], true)) {
            $errors['proxy.pool_type'] = 'Choose residential, mobile or datacenter.';
        }
        if (!preg_match('/^(?:[a-z]{2}|any)$/', $country)) {
            $errors['proxy.country'] = 'Use a two-letter country code or any.';
        }
        if (!in_array($protocol, ['http', 'https', 'socks4', 'socks5'], true)) {
            $errors['proxy.protocol'] = 'Choose HTTP, HTTPS, SOCKS4 or SOCKS5.';
        }
        if ($dataGb !== null && (!is_numeric($dataGb) || (float) $dataGb < 0 || (float) $dataGb > 100000)) {
            $errors['proxy.data_gb'] = 'Bandwidth must be a non-negative number.';
        }
    }
    if ($deliveryKind === 'sms') {
        $sms = $input['sms'] ?? null;
        if (!is_array($sms) || trim((string) ($sms['service_id'] ?? '')) === '' || trim((string) ($sms['country_id'] ?? '')) === '') {
            $errors['sms'] = 'SMS delivery needs a service id and country id.';
        }
    }
    if ($deliveryKind === 'proxy') {
        $proxy = $input['proxy'] ?? null;
        if (!is_array($proxy) || !is_numeric($proxy['per_unit'] ?? null) || (int) $proxy['per_unit'] < 1) {
            $errors['proxy'] = 'Proxy delivery needs a positive unit size.';
        }
    }
    $guide = trim((string) ($input['guide_url'] ?? ''));
    if ($guide !== '' && filter_var($guide, FILTER_VALIDATE_URL) === false) {
        $errors['guide_url'] = 'Guide link must be a valid URL.';
    }

    return ['ok' => $errors === [], 'errors' => $errors];
}
