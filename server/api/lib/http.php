<?php
/**
 * Shared HTTP helpers for the payment endpoints.
 */

declare(strict_types=1);

/** Sends a JSON response and stops. */
function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function json_ok(array $data = []): void
{
    json_response($data, 200);
}

function json_error(string $message, int $status = 400, ?string $code = null): void
{
    json_response(array_filter([
        'error' => $message,
        'errorCode' => $code,
    ], static fn ($v) => $v !== null), $status);
}

/** Loads configuration, failing loudly if config.php is missing. */
function load_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }

    $path = __DIR__ . '/../config.php';
    if (!is_file($path)) {
        json_error(
            'Payment configuration is missing. Copy server/api/config.sample.php to config.php and add your API keys.',
            500,
            'CONFIG_MISSING'
        );
    }

    $config = require $path;
    return $config;
}

function config_value(array $config, string $path, $default = null)
{
    $node = $config;
    foreach (explode('.', $path) as $segment) {
        if (!is_array($node) || !array_key_exists($segment, $node)) {
            return $default;
        }
        $node = $node[$segment];
    }
    return $node;
}

/** Reads and decodes a JSON request body. */
function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

/** Requires a specific HTTP method. */
function require_method(string $method): void
{
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== strtoupper($method)) {
        json_error('Method not allowed. Use ' . strtoupper($method) . '.', 405, 'METHOD_NOT_ALLOWED');
    }
}

/** Optional CORS, off by default. */
function apply_cors(array $config): void
{
    if (!config_value($config, 'allow_cors', false)) {
        return;
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, x-nowpayments-sig');
    header('Vary: Origin');

    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

/** Trims and length-caps a string field. */
function clean_str($value, int $maxLength): string
{
    $value = is_string($value) ? trim($value) : '';
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $maxLength);
    }
    return substr($value, 0, $maxLength);
}

/** Filters a value to digits only. */
function digits_only($value): string
{
    return preg_replace('/\D+/', '', is_string($value) ? $value : '') ?? '';
}

/**
 * Generates a short random token.
 * Used to keep worker/server logs correlatable; not a secret.
 */
function short_token(int $length = 8): string
{
    $bytes = random_bytes((int) ceil($length / 2));
    return substr(strtoupper(bin2hex($bytes)), 0, $length);
}

/**
 * Sends a JSON response, flushes it to the client, then runs $after.
 *
 * Used by the payment webhooks: the provider gets its 2xx immediately (Palplus
 * retries on slow responses), and the slower work — claiming stock and sending
 * the credentials email — happens afterwards. Under PHP-FPM this genuinely runs
 * post-response; elsewhere the buffers are flushed and it runs inline.
 */
function json_response_then(array $payload, callable $after, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } else {
        while (ob_get_level() > 0) {
            @ob_end_flush();
        }
        @flush();
    }

    try {
        $after();
    } catch (Throwable $e) {
        // Never let post-response work produce a fatal in the access log path.
        error_log('post-response task failed: ' . $e->getMessage());
    }
    exit;
}

/**
 * Gate for admin-only endpoints.
 *
 * The key lives in config.php and is entered once in the admin UI. It is a
 * shared secret, not per-user auth — see server/api/README.md for the
 * Firebase-token upgrade path.
 */
function require_admin(array $config): void
{
    $expected = trim((string) config_value($config, 'admin_api_key', ''));
    if ($expected === '') {
        json_error(
            'Admin API key is not configured. Set admin_api_key in server/api/config.php.',
            503,
            'ADMIN_NOT_CONFIGURED'
        );
    }

    $provided = (string) ($_SERVER['HTTP_X_ADMIN_KEY'] ?? '');
    if ($provided === '' || !hash_equals($expected, $provided)) {
        json_error('Invalid or missing admin key.', 401, 'UNAUTHORIZED');
    }
}

/**
 * Minimal JSON HTTP client.
 *
 * @return array{status:int, body:array|null, raw:string, error:string|null}
 */
function http_json_request(
    string $method,
    string $url,
    array $headers = [],
    ?array $payload = null,
    int $timeoutSeconds = 30
): array {
    $ch = curl_init($url);

    $headerLines = [];
    foreach ($headers as $key => $value) {
        $headerLines[] = $key . ': ' . $value;
    }
    $headerLines[] = 'Accept: application/json';

    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
        CURLOPT_TIMEOUT => $timeoutSeconds,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => $headerLines,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => 'DigitalHubShop/1.0',
    ];

    if ($payload !== null) {
        $options[CURLOPT_POSTFIELDS] = json_encode($payload, JSON_UNESCAPED_SLASHES);
        $headerLines[] = 'Content-Type: application/json';
        $options[CURLOPT_HTTPHEADER] = $headerLines;
    }

    curl_setopt_array($ch, $options);

    $raw = curl_exec($ch);
    $error = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false) {
        return ['status' => 0, 'body' => null, 'raw' => '', 'error' => $error ?: 'network error'];
    }

    $decoded = json_decode((string) $raw, true);

    return [
        'status' => $status,
        'body' => is_array($decoded) ? $decoded : null,
        'raw' => substr((string) $raw, 0, 2000),
        'error' => null,
    ];
}

/** Generates the unguessable token that lets a buyer read their credentials. */
function new_order_token(): string
{
    return bin2hex(random_bytes(16));
}
