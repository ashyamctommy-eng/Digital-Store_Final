<?php
/**
 * Concurrency test for the inventory claim.
 *
 * The failure this guards against is the worst one this store can have: two
 * buyers paying at the same moment and receiving the same credential. The lock
 * only helps if it works across real, separate OS processes, which is what this
 * exercises — several PHP processes claiming from the same product at once.
 *
 * Run:  php server/api/tests/concurrency.php
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/inventory.php';

$php = PHP_BINARY;
$worker = __DIR__ . '/claim-worker.php';

$tmp = sys_get_temp_dir() . '/dhs-concurrency-' . bin2hex(random_bytes(4));
mkdir($tmp, 0775, true);

$config = ['data_dir' => $tmp, 'inventory_drives_stock' => true];

$PRODUCT = 'race-product';
$UNITS = 40;
$WORKERS = 10;
$PER_CLAIM = 5;   // 10 workers x 5 = 50 attempts against 40 units

// Seed stock.
$lines = [];
for ($i = 1; $i <= $UNITS; $i++) {
    $lines[] = sprintf('U%03d|pass%d', $i, $i);
}
$added = inventory_add_units($config, $PRODUCT, implode("\n", $lines));
echo "  seeded {$added['available']} units\n";

// Launch every worker at once.
$procs = [];
$pipes = [];
for ($w = 0; $w < $WORKERS; $w++) {
    $cmd = [$php, $worker, $tmp, $PRODUCT, (string) $PER_CLAIM, "ORDER_W$w"];
    $pipes[$w] = [];
    $procs[$w] = proc_open(
        $cmd,
        [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
        $pipes[$w]
    );
}

// Collect results only after all of them have started, so the claims overlap.
$claimed = [];
$errors = [];
foreach ($procs as $w => $proc) {
    $out = stream_get_contents($pipes[$w][1]);
    $err = stream_get_contents($pipes[$w][2]);
    fclose($pipes[$w][1]);
    fclose($pipes[$w][2]);
    proc_close($proc);

    if (trim($err) !== '') {
        $errors[] = "worker $w: " . trim($err);
    }
    $ids = json_decode(trim($out), true);
    if (!is_array($ids)) {
        $errors[] = "worker $w produced unparseable output: " . trim($out);
        continue;
    }
    foreach ($ids as $id) {
        $claimed[] = $id;
    }
}

$fail = 0;
$check = static function (bool $cond, string $label) use (&$fail): void {
    if ($cond) {
        echo "  \033[32mPASS\033[0m  $label\n";
    } else {
        $fail++;
        echo "  \033[31mFAIL\033[0m  $label\n";
    }
};

echo "\n";
foreach ($errors as $e) {
    echo "  worker error: $e\n";
}

$unique = array_unique($claimed);
$duplicates = count($claimed) - count($unique);

$check($errors === [], 'every worker exited cleanly');
$check(count($claimed) === $UNITS, 'exactly ' . $UNITS . ' units handed out across all workers (got ' . count($claimed) . ')');
$check($duplicates === 0, 'no unit was handed to two different orders (duplicates: ' . $duplicates . ')');
$check(inventory_count_available($config, $PRODUCT) === 0, 'no stock left available');

// Every unit must be bound to exactly one order.
$byOrder = [];
foreach (inventory_read($config, $PRODUCT)['items'] as $item) {
    if (($item['status'] ?? '') !== 'sold') {
        continue;
    }
    $byOrder[$item['order_id']] = ($byOrder[$item['order_id']] ?? 0) + 1;
}
$oversold = array_filter($byOrder, static fn ($n) => $n > $PER_CLAIM);
$check($oversold === [], 'no order received more units than it asked for');

echo "\n  " . ($fail === 0 ? "\033[32mconcurrency OK\033[0m" : "\033[31m$fail check(s) failed\033[0m") . "\n\n";

// Cleanup
$it = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($tmp, FilesystemIterator::SKIP_DOTS),
    RecursiveIteratorIterator::CHILD_FIRST
);
foreach ($it as $file) {
    $file->isDir() ? @rmdir($file->getPathname()) : @unlink($file->getPathname());
}
@rmdir($tmp);

exit($fail === 0 ? 0 : 1);
