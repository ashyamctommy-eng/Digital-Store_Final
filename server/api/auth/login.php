<?php
/**
 * POST /api/auth/login
 * Authenticate a first-party customer account and start a secure session.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/auth.php';

$config = load_config();
require_method('POST');
customer_auth_require_same_origin_json();
customer_auth_rate_limit_or_fail($config, 'login', 10, 900);

$body = read_json_body();
$email = customer_auth_normalise_email($body['email'] ?? '');
$password = is_string($body['password'] ?? null) ? $body['password'] : '';

if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false || $password === '') {
    json_error('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
}

try {
    $user = customer_auth_read_user($config, $email);
} catch (Throwable $e) {
    json_error('Account service is temporarily unavailable.', 503, 'AUTH_STORAGE_UNAVAILABLE');
}
if ($user === null || !is_string($user['password_hash'] ?? null) || !password_verify($password, $user['password_hash'])) {
    json_error('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
}

customer_auth_login_session($config, $user);
json_ok(['user' => customer_auth_public_user($user)]);
