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
