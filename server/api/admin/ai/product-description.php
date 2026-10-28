<?php
/**
 * POST /api/admin/ai/product-description (admin key required)
 *
 * Creates an editable product-description draft. It never saves or publishes
 * catalog content.
 */

declare(strict_types=1);

require_once __DIR__ . '/../../lib/http.php';
require_once __DIR__ . '/../../lib/settings.php';
require_once __DIR__ . '/../../lib/novita.php';

$config = load_config();
require_method('POST');
require_admin($config);

$body = read_json_body();
$name = trim((string) ($body['name'] ?? ''));
$category = trim((string) ($body['category'] ?? ''));
$description = trim((string) ($body['description'] ?? ''));
$rawSpecs = $body['specs'] ?? [];

if ($name === '' || strlen($name) > 160 || strlen($category) > 100 || strlen($description) > 1000) {
    json_error('Enter a product name and keep product details within the allowed length.', 422, 'INVALID_PRODUCT_FACTS');
}
if (!is_array($rawSpecs) || count($rawSpecs) > 12) {
    json_error('Product specifications must be a list of up to 12 items.', 422, 'INVALID_PRODUCT_SPECS');
}

$specs = [];
foreach ($rawSpecs as $spec) {
    if (!is_string($spec) || strlen($spec) > 240) {
        json_error('Each product specification must be plain text under 240 characters.', 422, 'INVALID_PRODUCT_SPECS');
    }
    $spec = trim(strip_tags($spec));
    if ($spec !== '') {
        $specs[] = $spec;
    }
}

$result = novita_generate_product_description($config, [
    'name' => strip_tags($name),
    'category' => strip_tags($category),
    'description' => strip_tags($description),
    'specs' => $specs,
]);

if (!$result['ok']) {
    $status = ($result['errorCode'] ?? '') === 'NOVITA_RATE_LIMITED'
        ? 429
        : (in_array(($result['errorCode'] ?? ''), ['NOVITA_NOT_CONFIGURED', 'NOVITA_MODEL_INVALID', 'NOVITA_KEY_INVALID'], true) ? 503 : 502);
    json_response(array_filter([
        'error' => $result['error'] ?? 'Could not generate a product draft.',
        'errorCode' => $result['errorCode'] ?? 'NOVITA_REQUEST_FAILED',
        'retryAfter' => $result['retryAfter'] ?? null,
    ], static fn ($value) => $value !== null), $status);
}

json_ok(['description' => $result['description']]);
