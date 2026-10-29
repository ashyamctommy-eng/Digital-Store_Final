<?php
/**
 * First-party customer accounts for stores that must not depend on Firebase.
 */

declare(strict_types=1);

require_once __DIR__ . '/http.php';

function customer_auth_data_dir(array $config): string
{
    $dir = trim((string) config_value($config, 'data_dir', __DIR__ . '/../data'));
    if ($dir === '') {
        throw new RuntimeException('Account storage is not configured.');
    }
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        throw new RuntimeException('Account storage is unavailable.');
    }
    return rtrim($dir, '/');
}

function customer_auth_accounts_dir(array $config): string
{
    $dir = customer_auth_data_dir($config) . '/accounts';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        throw new RuntimeException('Account storage is unavailable.');
    }
    @chmod($dir, 0700);
    return $dir;
}

function customer_auth_normalise_email($value): string
{
    return strtolower(trim(is_string($value) ? $value : ''));
}

function customer_auth_email_path(array $config, string $email): string
{
    return customer_auth_accounts_dir($config) . '/' . hash('sha256', $email) . '.json';
}

function customer_auth_public_user(array $user): array
{
    return [
        'id' => (string) ($user['id'] ?? ''),
        'email' => (string) ($user['email'] ?? ''),
        'name' => (string) ($user['name'] ?? ''),
    ];
}

/**
 * Rate limits are shared across PHP workers and stored outside the public UI.
 *
 * @return array{ok:bool,retry_after:int}
 */
function customer_auth_consume_attempt(array $config, string $action, int $limit, int $windowSeconds): array
{
    try {
        $dataDir = customer_auth_data_dir($config);
    } catch (Throwable $e) {
        return ['ok' => false, 'retry_after' => 0];
    }

    $path = $dataDir . '/auth-rate-limits.json';
    $lock = @fopen($path . '.lock', 'c');
    if ($lock === false || !flock($lock, LOCK_EX)) {
        if (is_resource($lock)) {
            fclose($lock);
        }
        return ['ok' => false, 'retry_after' => 0];
    }

    try {
        $stored = [];
        if (is_file($path)) {
            $raw = @file_get_contents($path);
            $decoded = $raw === false ? null : json_decode($raw, true);
            if (!is_array($decoded)) {
                return ['ok' => false, 'retry_after' => 0];
            }
            $stored = $decoded;
        }

        $now = time();
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $key = $action . ':' . hash('sha256', $ip);
        $attempts = $stored[$key] ?? [];
        if (!is_array($attempts)) {
            return ['ok' => false, 'retry_after' => 0];
        }
        $attempts = array_values(array_filter(
            $attempts,
            static fn ($timestamp): bool => is_int($timestamp) && $timestamp > $now - $windowSeconds
        ));

        if (count($attempts) >= $limit) {
            return [
                'ok' => false,
                'retry_after' => max(1, $attempts[0] + $windowSeconds - $now),
            ];
        }

        $attempts[] = $now;
        $stored[$key] = $attempts;
        // Prune stale buckets so this file remains bounded over time.
        foreach ($stored as $bucket => $timestamps) {
            if (!is_array($timestamps)) {
                unset($stored[$bucket]);
                continue;
            }
            $fresh = array_values(array_filter(
                $timestamps,
                static fn ($timestamp): bool => is_int($timestamp) && $timestamp > $now - 3600
            ));
            if ($fresh === []) {
                unset($stored[$bucket]);
            } else {
                $stored[$bucket] = $fresh;
            }
        }

        $temporary = $path . '.' . bin2hex(random_bytes(6)) . '.tmp';
        $json = json_encode($stored, JSON_UNESCAPED_SLASHES);
        if ($json === false || @file_put_contents($temporary, $json, LOCK_EX) === false) {
            @unlink($temporary);
            return ['ok' => false, 'retry_after' => 0];
        }
        @chmod($temporary, 0600);
        if (!@rename($temporary, $path)) {
            @unlink($temporary);
            return ['ok' => false, 'retry_after' => 0];
        }
        @chmod($path, 0600);
        return ['ok' => true, 'retry_after' => 0];
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function customer_auth_read_user(array $config, string $email): ?array
{
    $path = customer_auth_email_path($config, $email);
    if (!is_file($path)) {
        return null;
    }
    $raw = @file_get_contents($path);
    $user = $raw === false ? null : json_decode($raw, true);
    return is_array($user) ? $user : null;
}

/** @return array{ok:bool,user?:array,error?:string} */
function customer_auth_create_user(array $config, string $email, string $name, string $password): array
{
    try {
        $dir = customer_auth_accounts_dir($config);
    } catch (Throwable $e) {
        return ['ok' => false, 'error' => 'STORAGE_UNAVAILABLE'];
    }

    $path = $dir . '/' . hash('sha256', $email) . '.json';
    $lock = @fopen($dir . '/.register.lock', 'c');
    if ($lock === false || !flock($lock, LOCK_EX)) {
        if (is_resource($lock)) {
            fclose($lock);
        }
        return ['ok' => false, 'error' => 'STORAGE_UNAVAILABLE'];
    }

    try {
        if (is_file($path)) {
            return ['ok' => false, 'error' => 'EMAIL_ALREADY_REGISTERED'];
        }

        $user = [
            'id' => bin2hex(random_bytes(16)),
            'email' => $email,
            'name' => $name,
            'password_hash' => password_hash($password, PASSWORD_DEFAULT),
            'created_at' => gmdate('c'),
        ];
        if (!is_string($user['password_hash']) || $user['password_hash'] === '') {
            return ['ok' => false, 'error' => 'STORAGE_UNAVAILABLE'];
        }

        $temporary = $path . '.' . bin2hex(random_bytes(6)) . '.tmp';
        $json = json_encode($user, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json === false || @file_put_contents($temporary, $json, LOCK_EX) === false) {
            @unlink($temporary);
            return ['ok' => false, 'error' => 'STORAGE_UNAVAILABLE'];
        }
        @chmod($temporary, 0600);
        if (!@rename($temporary, $path)) {
            @unlink($temporary);
            return ['ok' => false, 'error' => 'STORAGE_UNAVAILABLE'];
        }
        @chmod($path, 0600);
        return ['ok' => true, 'user' => $user];
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/** Ensure auth mutations are JSON requests from this site, without enabling CORS. */
function customer_auth_require_same_origin_json(): void
{
    $contentType = strtolower(trim((string) ($_SERVER['CONTENT_TYPE'] ?? '')));
    if (!str_starts_with($contentType, 'application/json')) {
        json_error('Send this request as JSON.', 415, 'JSON_REQUIRED');
    }

    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($origin === '') {
        return;
    }

    $originParts = parse_url($origin);
    $requestParts = parse_url('http://' . (string) ($_SERVER['HTTP_HOST'] ?? ''));
    $originHost = strtolower((string) ($originParts['host'] ?? ''));
    $requestHost = strtolower((string) ($requestParts['host'] ?? ''));
    $originScheme = strtolower((string) ($originParts['scheme'] ?? ''));
    $requestScheme = customer_auth_request_is_https() ? 'https' : 'http';
    $originPort = (int) ($originParts['port'] ?? ($originScheme === 'https' ? 443 : 80));
    $requestPort = (int) ($requestParts['port'] ?? ($requestScheme === 'https' ? 443 : 80));

    if (
        !in_array($originScheme, ['http', 'https'], true)
        || $originScheme !== $requestScheme
        || $originHost === ''
        || $originHost !== $requestHost
        || $originPort !== $requestPort
    ) {
        json_error('This request is not allowed from another site.', 403, 'ORIGIN_NOT_ALLOWED');
    }
}

function customer_auth_request_is_https(): bool
{
    return isset($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off' && $_SERVER['HTTPS'] !== '';
}

function customer_auth_start_session(array $config): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    try {
        $sessionDir = customer_auth_data_dir($config) . '/sessions';
    } catch (Throwable $e) {
        json_error('Account sessions are temporarily unavailable.', 503, 'AUTH_STORAGE_UNAVAILABLE');
    }
    if (!is_dir($sessionDir) && !@mkdir($sessionDir, 0700, true) && !is_dir($sessionDir)) {
        json_error('Account sessions are temporarily unavailable.', 503, 'AUTH_STORAGE_UNAVAILABLE');
    }
    @chmod($sessionDir, 0700);

    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    ini_set('session.gc_maxlifetime', '86400');
    session_save_path($sessionDir);
    session_name('dhs_customer');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => customer_auth_request_is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);

    if (!@session_start()) {
        json_error('Account sessions are temporarily unavailable.', 503, 'AUTH_STORAGE_UNAVAILABLE');
    }
}

function customer_auth_login_session(array $config, array $user): void
{
    customer_auth_start_session($config);
    if (!session_regenerate_id(true)) {
        json_error('Could not create a secure account session.', 503, 'AUTH_SESSION_UNAVAILABLE');
    }
    $_SESSION['customer'] = customer_auth_public_user($user);
}

function customer_auth_logout_session(array $config): void
{
    customer_auth_start_session($config);
    $_SESSION = [];

    $params = session_get_cookie_params();
    setcookie(session_name(), '', [
        'expires' => time() - 42000,
        'path' => $params['path'] ?: '/',
        'secure' => (bool) $params['secure'],
        'httponly' => true,
        'samesite' => $params['samesite'] ?: 'Lax',
    ]);
    session_destroy();
}

function customer_auth_rate_limit_or_fail(array $config, string $action, int $limit, int $windowSeconds): void
{
    $result = customer_auth_consume_attempt($config, $action, $limit, $windowSeconds);
    if (!$result['ok']) {
        if ($result['retry_after'] > 0) {
            header('Retry-After: ' . $result['retry_after']);
            json_error('Too many attempts. Please wait and try again.', 429, 'RATE_LIMITED');
        }
        json_error('Account service is temporarily unavailable.', 503, 'AUTH_STORAGE_UNAVAILABLE');
    }
}
