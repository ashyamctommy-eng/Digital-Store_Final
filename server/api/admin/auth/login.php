<?php
/**
 * POST /api/admin/auth/login
 * Authenticate the installer-configured administrator.
 */

declare(strict_types=1);

require_once __DIR__ . '/../../lib/http.php';
require_once __DIR__ . '/../../lib/admin-auth.php';

$config = load_config();
require_method('POST');
customer_auth_require_same_origin_json();
customer_auth_rate_limit_or_fail($config, 'admin-login', 10, 900);

try {
    $credentials = admin_auth_read_credentials($config);
} catch (Throwable $e) {
    json_error('Admin credentials are temporarily unavailable.', 503, 'ADMIN_AUTH_UNAVAILABLE');
}
if ($credentials === null) {
    json_error('Admin login is not configured. Run installer.sh on the server.', 503, 'ADMIN_NOT_CONFIGURED');
}

$body = read_json_body();
$email = customer_auth_normalise_email($body['email'] ?? '');
$password = is_string($body['password'] ?? null) ? $body['password'] : '';
$expectedEmail = $credentials['email'];
$passwordHash = $credentials['password_hash'];
$emailMatches = $email !== '' && hash_equals($expectedEmail, $email);
$passwordMatches = strlen($password) <= 1024 && password_verify($password, $passwordHash);

if (!$emailMatches || !$passwordMatches) {
    json_error('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
}

admin_auth_login_session($config, $credentials);
json_ok([
    'configured' => true,
    'authenticated' => true,
    'user' => ['email' => $expectedEmail],
]);
