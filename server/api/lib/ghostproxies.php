<?php
/**
 * Server-side GhostProxies API client.
 *
 * The provider key is read from secure settings and is never returned to the
 * browser or written to logs. Requests are restricted to the documented
 * GhostProxies host and read-only endpoints.
 */

declare(strict_types=1);

require_once __DIR__ . '/settings.php';

const GHOSTPROXIES_API_BASE = 'https://ghostproxies.net';

function ghostproxies_is_configured(array $config): bool
{
    return trim((string) config_value($config, 'ghostproxies.api_key', '')) !== '';
}

function ghostproxies_redact($value)
{
    if (!is_array($value)) {
        return $value;
    }

    $safe = [];
    foreach ($value as $key => $item) {
        if (is_string($key) && preg_match('/(?:api|secret|private|access|auth)[_-]?key|password|token|authorization/i', $key)) {
            $safe[$key] = '[REDACTED]';
        } else {
            $safe[$key] = ghostproxies_redact($item);
        }
    }
    return $safe;
}

/**
 * Performs an allow-listed GET request to GhostProxies.
 *
 * @return array{ok:bool,status:int,data:mixed,error:?string}
 */
function ghostproxies_request(array $config, string $resource, array $query = []): array
{
    $paths = [
        'stats' => '/api/stats',
        'settings' => '/api/settings',
        'pools' => '/api/pools',
        'countries' => '/api/proxy/countries',
        'locations' => '/api/proxy/locations',
        'asn' => '/api/proxy/asn',
        'reseller' => '/api/reseller',
    ];

    if (!isset($paths[$resource])) {
        return ['ok' => false, 'status' => 0, 'data' => null, 'error' => 'Unsupported GhostProxies resource.'];
    }
    if (!ghostproxies_is_configured($config)) {
        return ['ok' => false, 'status' => 0, 'data' => null, 'error' => 'Add the GhostProxies API key in Admin → Configurations first.'];
    }
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'status' => 0, 'data' => null, 'error' => 'PHP cURL is required for the GhostProxies connection.'];
    }

    $allowed = match ($resource) {
        'countries' => ['type'],
        'locations' => ['country', 'type', 'state'],
        'asn' => ['country'],
        default => [],
    };
    $params = [];
    foreach ($query as $key => $value) {
        if (!in_array($key, $allowed, true) || !is_scalar($value)) {
            continue;
        }
        $value = trim((string) $value);
        if ($value !== '' && strlen($value) <= 100) {
            $params[$key] = $value;
        }
    }
    if (isset($params['country']) && !preg_match('/^(?:[A-Za-z]{2}|any)$/', $params['country'])) {
        return ['ok' => false, 'status' => 0, 'data' => null, 'error' => 'Country must be a two-letter code.'];
    }
    if (isset($params['protocol']) && !in_array(strtolower($params['protocol']), ['http', 'https', 'socks4', 'socks5'], true)) {
        return ['ok' => false, 'status' => 0, 'data' => null, 'error' => 'Choose HTTP, HTTPS, SOCKS4 or SOCKS5.'];
    }
    if (isset($params['type']) && !in_array(strtolower($params['type']), ['res', 'residential', 'mob', 'mobile', 'dc', 'datacenter'], true)) {
        return ['ok' => false, 'status' => 0, 'data' => null, 'error' => 'Unsupported proxy pool type.'];
    }

    $url = GHOSTPROXIES_API_BASE . $paths[$resource];
    if ($params !== []) {
        $url .= '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    }

    $key = (string) config_value($config, 'ghostproxies.api_key', '');
    $handle = curl_init($url);
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPGET => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'x-api-key: ' . $key,
        ],
    ]);
    $raw = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
    $curlError = curl_error($handle);
    curl_close($handle);

    if ($raw === false) {
        return [
            'ok' => false,
            'status' => $status,
            'data' => null,
            'error' => $curlError !== '' ? 'Could not connect to GhostProxies.' : 'The GhostProxies request failed.',
        ];
    }
    $decoded = json_decode((string) $raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        return [
            'ok' => false,
            'status' => $status,
            'data' => null,
            'error' => 'GhostProxies returned a non-JSON response.',
        ];
    }

    $ok = $status >= 200 && $status < 300;
    return [
        'ok' => $ok,
        'status' => $status,
        'data' => ghostproxies_redact($decoded),
        'error' => $ok ? null : ('GhostProxies returned HTTP ' . $status . '.'),
    ];
}
