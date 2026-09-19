<?php
/**
 * Reflector stub for testing the proxy checker.
 *
 *   php -S 127.0.0.1:8908 tests/echo-stub.php
 *
 * Production uses this site's own `/api/proxies/echo`. Locally every connection
 * arrives from 127.0.0.1, so an honest reflector would report the same address
 * for the direct baseline and for every proxy — and the anonymity classifier
 * could never be exercised, because "the exit address differs from ours" is
 * exactly what it keys on.
 *
 * So this stub lets the *proxy* declare the exit address it presents, via an
 * `X-Stub-Exit` header that proxy-stub.php injects:
 *
 *   direct/baseline request  -> ECHO_STUB_EGRESS (default 8.8.8.8)
 *   through a proxy          -> whatever X-Stub-Exit says
 *
 * Everything else — the forwarding headers it reports — it reads from the real
 * request, so a proxy that forwards our address still looks like one.
 *
 * Test-only. Nothing in production loads this file.
 */

declare(strict_types=1);

header('Content-Type: application/json');

$forwardingHeaders = [
    'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip',
    'forwarded', 'via', 'proxy-connection', 'client-ip', 'x-client-ip',
    'true-client-ip', 'cf-connecting-ip', 'x-originating-ip',
];

$seen = [];
foreach ($forwardingHeaders as $name) {
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (!empty($_SERVER[$key])) {
        $seen[$name] = (string) $_SERVER[$key];
    }
}

$egress = getenv('ECHO_STUB_EGRESS') ?: '8.8.8.8';
$declared = (string) ($_SERVER['HTTP_X_STUB_EXIT'] ?? '');

echo json_encode([
    // What the target believes the client address is.
    'ip' => $declared !== '' ? $declared : $egress,
    'forwarded' => $seen,
    'user_agent' => (string) ($_SERVER['HTTP_USER_AGENT'] ?? ''),
    'method' => 'GET',
    'at' => gmdate('c'),
], JSON_UNESCAPED_SLASHES);
