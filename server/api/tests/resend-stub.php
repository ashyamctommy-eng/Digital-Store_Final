<?php
/**
 * Isolated Resend API stub for http.sh. Never used by production endpoints.
 */

declare(strict_types=1);

$statePath = (string) (getenv('DHS_RESEND_STATE') ?: '');
$payload = json_decode((string) file_get_contents('php://input'), true);
if ($statePath !== '' && is_array($payload)) {
    $lock = fopen($statePath . '.lock', 'c');
    if ($lock !== false && flock($lock, LOCK_EX)) {
        $raw = is_file($statePath) ? file_get_contents($statePath) : '[]';
        $messages = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($messages)) {
            $messages = [];
        }
        $messages[] = $payload;
        file_put_contents($statePath, json_encode($messages), LOCK_EX);
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

header('Content-Type: application/json');
http_response_code(200);
echo json_encode(['id' => 'stub-email']);
