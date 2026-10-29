<?php
/**
 * First-party administrator sessions, separate from customer sessions.
 */

declare(strict_types=1);

require_once __DIR__ . '/auth.php';

const ADMIN_AUTH_IDLE_TTL = 1800;
const ADMIN_AUTH_ABSOLUTE_TTL = 28800;

/**
 * Read the installer-managed admin identity from private runtime storage.
 *
 * @return array{email:string,password_hash:string}|null
 */
function admin_auth_read_credentials(array $config): ?array
{
    $path = customer_auth_data_dir($config) . '/admin-credentials.json';
    if (!is_file($path)) {
        return null;
    }

    $raw = @file_get_contents($path);
    if ($raw === false) {
        throw new RuntimeException('Admin credentials are unavailable.');
    }
    $permissions = @fileperms($path);
    if ($permissions === false || ($permissions & 0077) !== 0) {
        throw new RuntimeException('Admin credentials file permissions are too broad.');
    }
    $credentials = json_decode($raw, true);
    if (!is_array($credentials)) {
        return null;
    }

    $email = customer_auth_normalise_email($credentials['email'] ?? '');
    $passwordHash = is_string($credentials['password_hash'] ?? null)
        ? $credentials['password_hash']
        : '';
    $hashInfo = $passwordHash === '' ? ['algo' => null] : password_get_info($passwordHash);
    if (
        filter_var($email, FILTER_VALIDATE_EMAIL) === false
        || $passwordHash === ''
        || empty($hashInfo['algo'])
    ) {
        return null;
    }

    return ['email' => $email, 'password_hash' => $passwordHash];
}

function admin_auth_is_configured(array $config): bool
{
    try {
        return admin_auth_read_credentials($config) !== null;
    } catch (Throwable $e) {
        return false;
    }
}

function admin_auth_start_session(array $config): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    try {
        $sessionDir = customer_auth_data_dir($config) . '/admin-sessions';
    } catch (Throwable $e) {
        json_error('Admin sessions are temporarily unavailable.', 503, 'ADMIN_SESSION_UNAVAILABLE');
    }
    if (!is_dir($sessionDir) && !@mkdir($sessionDir, 0700, true) && !is_dir($sessionDir)) {
        json_error('Admin sessions are temporarily unavailable.', 503, 'ADMIN_SESSION_UNAVAILABLE');
    }
    @chmod($sessionDir, 0700);

    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    ini_set('session.gc_maxlifetime', (string) ADMIN_AUTH_ABSOLUTE_TTL);
    session_save_path($sessionDir);
    session_name('dhs_admin');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => customer_auth_request_is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);

    if (!@session_start()) {
        json_error('Admin sessions are temporarily unavailable.', 503, 'ADMIN_SESSION_UNAVAILABLE');
    }
}

function admin_auth_login_session(array $config, array $credentials): void
{
    admin_auth_start_session($config);
    if (!session_regenerate_id(true)) {
        json_error('Could not create a secure admin session.', 503, 'ADMIN_SESSION_UNAVAILABLE');
    }

    $_SESSION = [
        'admin' => [
            'email' => $credentials['email'],
            'password_fingerprint' => hash('sha256', $credentials['password_hash']),
            'issued_at' => time(),
            'last_seen' => time(),
        ],
    ];
}

function admin_auth_destroy_session(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        return;
    }

    $_SESSION = [];
    $params = session_get_cookie_params();
    if (ini_get('session.use_cookies')) {
        setcookie(session_name(), '', [
            'expires' => time() - 42000,
            'path' => $params['path'] ?: '/',
            'domain' => $params['domain'],
            'secure' => (bool) $params['secure'],
            'httponly' => (bool) $params['httponly'],
            'samesite' => $params['samesite'] ?: 'Strict',
        ]);
    }
    session_destroy();
}

/** Returns the administrator identity only when the current session is valid. */
function admin_auth_current_user(array $config): ?array
{
    try {
        $credentials = admin_auth_read_credentials($config);
    } catch (Throwable $e) {
        json_error('Admin credentials are temporarily unavailable.', 503, 'ADMIN_AUTH_UNAVAILABLE');
    }
    if ($credentials === null) {
        return null;
    }
    if (empty($_COOKIE['dhs_admin'])) {
        return null;
    }

    admin_auth_start_session($config);
    $session = $_SESSION['admin'] ?? null;
    if (!is_array($session)) {
        return null;
    }

    $email = customer_auth_normalise_email($session['email'] ?? '');
    $expectedEmail = $credentials['email'];
    $issuedAt = is_int($session['issued_at'] ?? null) ? $session['issued_at'] : 0;
    $lastSeen = is_int($session['last_seen'] ?? null) ? $session['last_seen'] : 0;
    $fingerprint = is_string($session['password_fingerprint'] ?? null)
        ? $session['password_fingerprint']
        : '';

    if (
        $email === ''
        || !hash_equals($expectedEmail, $email)
        || $fingerprint === ''
        || !hash_equals(hash('sha256', $credentials['password_hash']), $fingerprint)
        || $issuedAt <= 0
        || $lastSeen <= 0
        || time() - $issuedAt > ADMIN_AUTH_ABSOLUTE_TTL
        || time() - $lastSeen > ADMIN_AUTH_IDLE_TTL
    ) {
        admin_auth_destroy_session();
        return null;
    }

    $_SESSION['admin']['last_seen'] = time();
    return ['email' => $email];
}

