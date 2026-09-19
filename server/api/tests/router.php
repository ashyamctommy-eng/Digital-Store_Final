<?php
/**
 * Router for PHP's built-in server, standing in for apache's .htaccess
 * rewrite rules so the endpoints can be exercised over real HTTP:
 *
 *   php -S 127.0.0.1:8902 -t <api dir> tests/router.php
 *
 * Maps /api/palplus/initiate -> <docroot>/palplus/initiate.php
 */

declare(strict_types=1);

$docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$path = rtrim($path, '/');

// The tests hit /api/... but the docroot IS the api directory.
if (str_starts_with($path, '/api')) {
    $path = substr($path, 4);
}
if ($path === '') {
    $path = '/';
}

$target = $docroot . $path;

if (is_file($target)) {
    return false; // let the server serve it directly
}
if (is_file($target . '.php')) {
    require $target . '.php';
    return true;
}
if (is_dir($target) && is_file($target . '/index.php')) {
    require $target . '/index.php';
    return true;
}

http_response_code(404);
header('Content-Type: application/json');
echo json_encode(['error' => 'no route', 'path' => $path]);
