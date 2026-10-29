<?php
/**
 * POST /api/auth/verify
 * Verify a one-time email token and start a first-party account session.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/auth.php';

$config = load_config();
require_method('POST');
customer_auth_require_same_origin_json();

$body = read_json_body();
$token = is_string($body['token'] ?? null) ? trim($body['token']) : '';
$user = customer_auth_verify_email($config, $token);
if ($user === null) {
    json_error('This verification link is invalid, expired, or already used.', 400, 'INVALID_VERIFICATION_TOKEN');
}

customer_auth_login_session($config, $user);
json_ok(['user' => customer_auth_public_user($user)]);
