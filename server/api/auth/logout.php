<?php
/**
 * POST /api/auth/logout
 * End the current first-party customer session.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/auth.php';

$config = load_config();
require_method('POST');
customer_auth_require_same_origin_json();
customer_auth_logout_session($config);
json_ok(['signed_out' => true]);
