<?php
/**
 * Static check: every project function a file calls must be reachable through
 * that file's require chain.
 *
 * This exists because the same bug shipped twice — a library calling a helper
 * from a module it did not require, which only fails at runtime on whichever
 * endpoint happens to load it first. `php -l` cannot see it and the unit tests
 * missed it because they load everything up front.
 *
 * Run:  php server/api/tests/requires.php
 */

declare(strict_types=1);

$root = realpath(__DIR__ . '/..') ?: (__DIR__ . '/..');

/** Every .php file under server/api, excluding this test directory. */
function collect_php_files(string $root): array
{
    $files = [];
    $walker = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($walker as $file) {
        if ($file->isFile() && $file->getExtension() === 'php') {
            $path = $file->getPathname();
            if (str_contains($path, '/tests/')) {
                continue;
            }
            $files[] = $path;
        }
    }
    sort($files);
    return $files;
}

/**
 * Every file a source file requires, with the literal path resolved.
 *
 * @return list<string> absolute paths that are required but missing
 */
function missing_required_files(string $path, string $source): array
{
    $missing = [];
    if (preg_match_all(
        '/\brequire(?:_once)?\s*\(?\s*__DIR__\s*\.\s*[\'"]([^\'"]+)[\'"]/',
        $source,
        $matches
    ) !== false) {
        foreach ($matches[1] as $suffix) {
            $target = dirname($path) . $suffix;
            if (!is_file($target)) {
                $missing[] = $target;
            }
        }
    }
    return $missing;
}

/** Strips comments and string literals so scans do not match prose. */
function strip_noise(string $src): string
{
    $out = '';
    $i = 0;
    $n = strlen($src);
    while ($i < $n) {
        $c = $src[$i];
        if ($c === '/' && $i + 1 < $n && $src[$i + 1] === '/') {
            while ($i < $n && $src[$i] !== "\n") {
                $i++;
            }
        } elseif ($c === '#') {
            while ($i < $n && $src[$i] !== "\n") {
                $i++;
            }
        } elseif ($c === '/' && $i + 1 < $n && $src[$i + 1] === '*') {
            $i += 2;
            while ($i + 1 < $n && !($src[$i] === '*' && $src[$i + 1] === '/')) {
                $i++;
            }
            $i += 2;
        } elseif ($c === '"' || $c === "'") {
            $q = $c;
            $i++;
            while ($i < $n && $src[$i] !== $q) {
                if ($src[$i] === '\\') {
                    $i++;
                }
                $i++;
            }
            $i++;
        } else {
            $out .= $c;
            $i++;
        }
    }
    return $out;
}

$files = collect_php_files($root);

// Where is each project function defined, and what does each file require?
$definedIn = [];
$requires = [];
$sources = [];

foreach ($files as $file) {
    $src = file_get_contents($file) ?: '';
    $code = strip_noise($src);
    $sources[$file] = $code;

    if (preg_match_all('/\bfunction\s+([A-Za-z_]\w*)\s*\(/', $code, $m)) {
        foreach ($m[1] as $fn) {
            $definedIn[$fn] = $file;
        }
    }

    $requires[$file] = [];
    if (preg_match_all("/require(?:_once)?\s+__DIR__\s*\.\s*'([^']+)'/", $src, $rm)) {
        foreach ($rm[1] as $rel) {
            $resolved = realpath(dirname($file) . '/' . ltrim($rel, '/'));
            if ($resolved !== false) {
                $requires[$file][] = $resolved;
            }
        }
    }
}

// PHP built-ins and language constructs are not our concern.
$builtins = array_flip(array_map('strtolower', get_defined_functions()['internal']));
$constructs = array_flip([
    'if', 'for', 'foreach', 'while', 'switch', 'function', 'return', 'echo',
    'array', 'catch', 'match', 'fn', 'new', 'print', 'require', 'require_once',
    'include', 'include_once', 'elseif', 'declare', 'use', 'static', 'and',
    'or', 'as', 'list', 'isset', 'empty', 'unset', 'exit', 'die', 'clone',
    'instanceof', 'throw', 'try', 'finally', 'goto', 'endif', 'endwhile',
    'endforeach', 'endfor', 'endswitch', 'default', 'case', 'break', 'continue',
    'global', 'namespace', 'class', 'interface', 'trait', 'enum', 'const',
]);

/**
 * All files reachable from $file through require statements.
 *
 * Breadth-first rather than recursive: a recursive version treats a cycle
 * (A requires B requires A) as a back-edge with no dependencies, which reports
 * every function in the cycle as unreachable. Requires are legitimately
 * mutually referential here — http.php pulls in settings.php for console
 * overrides — so the walk has to tolerate that rather than cry wolf.
 */
function reachable(string $file, array $requires): array
{
    $all = [$file => true];
    $queue = [$file];

    while ($queue) {
        $current = array_pop($queue);
        foreach ($requires[$current] ?? [] as $dep) {
            if (!isset($all[$dep])) {
                $all[$dep] = true;
                $queue[] = $dep;
            }
        }
    }

    return array_keys($all);
}

$problems = [];

foreach ($files as $file) {
    $available = reachable($file, $requires);
    $code = $sources[$file];

    if (preg_match_all('/(?<![\w>$:])([a-z_][a-z0-9_]*)\s*\(/', $code, $m)) {
        foreach (array_unique($m[1]) as $fn) {
            if (isset($builtins[strtolower($fn)]) || isset($constructs[$fn])) {
                continue;
            }
            if (!isset($definedIn[$fn])) {
                // Not ours: could be a function from an extension we cannot see.
                continue;
            }
            $owner = $definedIn[$fn];
            if (!in_array($owner, $available, true)) {
                $problems[] = sprintf(
                    '%s calls %s() which is defined in %s but not required',
                    str_replace($root . '/', '', $file),
                    $fn,
                    str_replace($root . '/', '', $owner)
                );
            }
        }
    }
}

echo "  checked " . count($files) . " files, " . count($definedIn) . " project functions\n";

if ($problems) {
    foreach (array_unique($problems) as $problem) {
        echo "  \033[31mFAIL\033[0m  $problem\n";
    }
    exit(1);
}

echo "  \033[32mPASS\033[0m  every project function call resolves through its require chain\n";
exit(0);
