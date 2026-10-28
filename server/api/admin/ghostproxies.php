<?php
/**
 * GET /api/admin/ghostproxies?resource=stats|settings|pools|locations|asn|reseller
 * Admin-only, read-only GhostProxies data browser.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/ghostproxies.php';

$config = load_config();
require_admin($config);
require_method('GET');

$resource = clean_str($_GET['resource'] ?? 'stats', 24);
$query = [
    'country' => clean_str($_GET['country'] ?? '', 2),
    'type' => clean_str($_GET['type'] ?? '', 24),
    'state' => clean_str($_GET['state'] ?? '', 48),
];
$result = ghostproxies_request($config, $resource, $query);

if (!$result['ok']) {
    json_response([
        'error' => $result['error'] ?? 'GhostProxies request failed.',
        'errorCode' => $result['status'] === 401 || $result['status'] === 403
            ? 'GHOSTPROXIES_AUTH_FAILED'
            : 'GHOSTPROXIES_REQUEST_FAILED',
        'resource' => $resource,
        'status' => $result['status'],
    ], $result['status'] === 401 || $result['status'] === 403 ? 502 : 502);
}

json_ok([
    'resource' => $resource,
    'status' => $result['status'],
    'data' => $result['data'],
]);
