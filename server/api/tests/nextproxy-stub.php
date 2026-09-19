<?php
/**
 * Stub of the NextProxy list API, for testing on-demand proxy supply without
 * calling the real service or depending on a third party being up.
 *
 * Run:  php -S 127.0.0.1:8906 tests/nextproxy-stub.php
 *
 * It mirrors what the live service actually does (verified against it):
 *   GET /api/proxies?format=json&limit=&country=&type=
 *   GET /api/list?format=json&limit=&country=&key=
 *       -> {status:"success", count, total, page, limit, proxies:[{ip,port,…}],
 *           clientTier}
 *   Auth: X-API-Key header or ?key=; optional, but a wrong key fails with
 *         {"status":"error","code":401,"message":"Invalid API key provided."}
 *   Quota: reported in x-ratelimit-* headers (not a credits field).
 *
 * Behaviour is driven by a JSON state file (path in NEXTPROXY_STUB_STATE) so a
 * test can shrink the pool, reject the key, simulate an outage, and assert how
 * many addresses were actually bought.
 */

declare(strict_types=1);

$statePath = getenv('NEXTPROXY_STUB_STATE') ?: sys_get_temp_dir() . '/nextproxy-stub.json';

function stub_state(string $path): array
{
    $defaults = [
        // Addresses the stub will hand out, in order.
        'pool' => [],
        // How many addresses to generate when `pool` is not set explicitly.
        'pool_size' => 60,
        'call_count' => 0,
        'addresses_served' => 0,
        // 'ok' | 'invalid_key' | 'outage' | 'error'
        'mode' => 'ok',
        'rate_limit' => 60,
        'rate_remaining' => 48,
        'tier' => 'Guest Community Tier (60 req/min)',
        // Emit the documented-but-absent credit headers, to prove the client
        // prefers them when a provider really sends them.
        'send_credit_headers' => false,
        'credits_remaining' => 1000,
        // The most recent key the client sent, so a test can prove the stored
        // key is actually transmitted rather than merely saved.
        'last_key' => '',
        'last_auth' => '',
    ];
    if (!is_file($path)) {
        return $defaults;
    }
    $raw = @file_get_contents($path);
    $decoded = $raw === false ? null : json_decode($raw, true);
    return is_array($decoded) ? array_merge($defaults, $decoded) : $defaults;
}

function stub_save(string $path, array $state): void
{
    @file_put_contents($path, json_encode($state), LOCK_EX);
}

function stub_out(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Deterministic public-looking addresses for a given index.
 * Ranges are from TEST-NET-3-ish space but deliberately NOT private, so the
 * client's private-address filter is not what makes a test pass or fail.
 */
function stub_address(int $index): array
{
    $third = 1 + intdiv($index, 250);
    $fourth = 1 + ($index % 250);
    return ['ip' => '203.0.' . $third . '.' . $fourth, 'port' => (string) (8000 + ($index % 1000))];
}

$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$state = stub_state($statePath);

// Only the list routes exist; anything else is a 404 like the real service.
if ($path !== '/api/proxies' && $path !== '/api/list') {
    stub_out(['error' => 'Endpoint not found'], 404);
}

if ($state['mode'] === 'outage') {
    stub_out(['status' => 'error', 'message' => 'Upstream unavailable'], 503);
}

// The key is optional, but validated when present — same as the real service.
$key = (string) ($_SERVER['HTTP_X_API_KEY'] ?? ($_GET['key'] ?? ''));
$state['last_key'] = $key;
$state['last_auth'] = isset($_SERVER['HTTP_X_API_KEY']) ? 'header' : ($key !== '' ? 'query' : 'none');
stub_save($statePath, $state);
$state = stub_state($statePath);
if ($key !== '' && ($state['mode'] === 'invalid_key' || $key === 'bad-key')) {
    stub_out(['status' => 'error', 'code' => 401, 'message' => 'Invalid API key provided.'], 401);
}

if ($state['mode'] === 'error') {
    stub_out(['status' => 'error', 'code' => 402, 'message' => 'Payment Required'], 402);
}

$state['call_count']++;
$limit = max(1, (int) ($_GET['limit'] ?? 100));
$country = strtoupper((string) ($_GET['country'] ?? ''));

$pool = is_array($state['pool']) && $state['pool'] ? $state['pool'] : null;
if ($pool === null) {
    $size = max(0, (int) $state['pool_size']);
    $pool = [];
    for ($i = 0; $i < $size; $i++) {
        $address = stub_address($i);
        $pool[] = ['ip' => $address['ip'], 'port' => $address['port'], 'country' => 'DE'];
    }
}

// Serve from the front of the pool, and drop what was handed out so a second
// call cannot return the same address — that is what makes the client's
// deduplication and paging observable.
$page = array_slice($pool, 0, $limit);
$state['pool'] = array_slice($pool, count($page));
$state['addresses_served'] += count($page);
stub_save($statePath, $state);

header('X-RateLimit-Limit: ' . (int) $state['rate_limit']);
header('X-RateLimit-Remaining: ' . max(0, (int) $state['rate_remaining'] - $state['call_count']));
header('X-RateLimit-Reset: ' . (time() + 60));
if (!empty($state['send_credit_headers'])) {
    header('X-Credits-Remaining: ' . (int) $state['credits_remaining']);
    header('X-Credits-Used: ' . (int) ($state['call_count'] * 2));
}

$proxies = [];
foreach ($page as $entry) {
    $proxies[] = [
        'ip' => $entry['ip'],
        'port' => $entry['port'],
        'type' => 'https',
        'protocol' => (string) ($_GET['type'] ?? 'https'),
        'country' => $entry['country'] ?? ($country !== '' ? $country : 'DE'),
        'latency' => 180,
        'anonymity' => 'anonymous',
        'status' => 'active',
        'isProOnly' => false,
        'isLocked' => false,
        'masked' => false,
    ];
}

stub_out([
    'status' => 'success',
    'count' => count($proxies),
    'total' => count($proxies),
    'page' => 1,
    'limit' => $limit,
    'totalPages' => 1,
    'proxies' => $proxies,
    'clientTier' => (string) $state['tier'],
]);
