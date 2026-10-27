<?php
// Commitbook server side: shared helpers. Not a page; included by the others.
//
// Settings (your login and the GitHub access key) are stored OUTSIDE the web folder,
// in ~/.commitbook/<id>/ on cPanel-style hosting, so they can never be downloaded.
// Set the COMMITBOOK_DATA environment variable to choose another folder.

if (!defined('COMMITBOOK')) { http_response_code(404); exit; }

const CB_VERSION = '0.2.1';
const CB_REMEMBER_DAYS = 90;
const CB_MAX_FAILS = 5;          // per address, per window
const CB_MAX_FAILS_ALL = 25;     // from everywhere, per window
const CB_FAIL_WINDOW = 900;      // seconds

function cb_app_dir(): string { return realpath(__DIR__ . '/..') ?: dirname(__DIR__); }

function cb_data_dir(): string {
    static $dir = null;
    if ($dir) return $dir;
    $env = getenv('COMMITBOOK_DATA');
    if ($env) {
        $dir = rtrim($env, '/');
    } else {
        $app = cb_app_dir();
        $id = substr(hash('sha256', $app), 0, 12);
        $home = null;
        if (preg_match('#^(/home\d*/[^/]+)/#', $app . '/', $m) && is_writable($m[1])) $home = $m[1];
        elseif (getenv('HOME') && is_dir(getenv('HOME')) && is_writable(getenv('HOME'))) $home = getenv('HOME');
        $dir = $home ? "$home/.commitbook/$id" : __DIR__ . '/data';   // last resort: protected by .htaccess
    }
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    if (strpos($dir, __DIR__) === 0 && !file_exists("$dir/.htaccess")) {
        @file_put_contents("$dir/.htaccess", "Require all denied\nDeny from all\n");
        @file_put_contents("$dir/index.html", '');
    }
    return $dir;
}

function cb_config(): ?array {
    $f = cb_data_dir() . '/config.php';
    if (!is_file($f)) return null;
    $c = include $f;
    return is_array($c) ? $c : null;
}

function cb_write_php(string $file, array $data): void {
    $tmp = $file . '.tmp' . bin2hex(random_bytes(4));
    $php = "<?php\n// Commitbook settings. Keep this file private.\nreturn " . var_export($data, true) . ";\n";
    if (file_put_contents($tmp, $php, LOCK_EX) === false) cb_fail(500, 'Couldn’t save the settings on the server. Check the hosting account has free space.');
    @chmod($tmp, 0600);
    rename($tmp, $file);
    if (function_exists('opcache_invalidate')) @opcache_invalidate($file, true);
}

function cb_save_config(array $c): void { cb_write_php(cb_data_dir() . '/config.php', $c); }

function cb_read_json(string $name): array {
    $f = cb_data_dir() . "/$name";
    if (!is_file($f)) return [];
    $d = json_decode((string) file_get_contents($f), true);
    return is_array($d) ? $d : [];
}
function cb_write_json(string $name, array $data): void {
    $f = cb_data_dir() . "/$name";
    $tmp = $f . '.tmp' . bin2hex(random_bytes(4));
    file_put_contents($tmp, json_encode($data), LOCK_EX);
    @chmod($tmp, 0600);
    rename($tmp, $f);
}

function cb_is_https(): bool {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    if (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') return true;
    if (strpos($_SERVER['HTTP_CF_VISITOR'] ?? '', 'https') !== false) return true;
    return false;
}

/** URL path of the app folder, e.g. "/" or "/notes/". */
function cb_base_path(): string {
    $p = str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/api/x.php')));
    return rtrim($p, '/') . '/';
}

function cb_cookie(string $name, string $value, int $expires): void {
    setcookie($name, $value, [
        'expires' => $expires, 'path' => cb_base_path(), 'secure' => cb_is_https(),
        'httponly' => true, 'samesite' => 'Strict',
    ]);
}

function cb_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $dir = cb_data_dir() . '/sessions';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    if (is_dir($dir) && is_writable($dir)) session_save_path($dir);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', (string) (12 * 3600));
    session_name('cb_session');
    session_set_cookie_params(['lifetime' => 0, 'path' => cb_base_path(), 'secure' => cb_is_https(), 'httponly' => true, 'samesite' => 'Strict']);
    session_start();
    if (empty($_SESSION['user'])) cb_login_from_cookie();
}

function cb_user(): ?string { cb_session(); return $_SESSION['user'] ?? null; }

function cb_sign_in(string $user, bool $remember): void {
    cb_session();
    session_regenerate_id(true);
    $_SESSION['user'] = $user;
    $_SESSION['at'] = time();
    if ($remember) {
        $token = bin2hex(random_bytes(32));
        $all = cb_read_json('remember.json');
        $now = time();
        $all = array_filter($all, fn($exp) => $exp > $now);
        $all[hash('sha256', $token)] = $now + CB_REMEMBER_DAYS * 86400;
        cb_write_json('remember.json', $all);
        cb_cookie('cb_remember', $token, $now + CB_REMEMBER_DAYS * 86400);
    }
}

function cb_login_from_cookie(): void {
    $token = $_COOKIE['cb_remember'] ?? '';
    if (!preg_match('/^[0-9a-f]{64}$/', $token)) return;
    $all = cb_read_json('remember.json');
    $h = hash('sha256', $token);
    if (!isset($all[$h]) || $all[$h] < time()) return;
    $c = cb_config();
    if (!$c) return;
    session_regenerate_id(true);
    $_SESSION['user'] = $c['username'];
    $_SESSION['at'] = time();
}

function cb_sign_out(): void {
    cb_session();
    $token = $_COOKIE['cb_remember'] ?? '';
    if ($token) {
        $all = cb_read_json('remember.json');
        unset($all[hash('sha256', $token)]);
        cb_write_json('remember.json', $all);
        cb_cookie('cb_remember', '', time() - 3600);
    }
    $_SESSION = [];
    session_destroy();
    cb_cookie('cb_session', '', time() - 3600);
}

/** Forget every "keep me signed in" device (after a password change). */
function cb_forget_devices(): void { cb_write_json('remember.json', []); }

// ------------------------------------------------------------ failed sign-in attempts

function cb_client_ip(): string {
    return $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

/** Seconds until sign-in is allowed again (0 = allowed now). */
function cb_locked_for(): int {
    $d = cb_read_json('attempts.json');
    $now = time();
    $mine = array_values(array_filter($d[cb_client_ip()] ?? [], fn($t) => $t > $now - CB_FAIL_WINDOW));
    $all = [];
    foreach ($d as $list) foreach ($list as $t) if ($t > $now - CB_FAIL_WINDOW) $all[] = $t;
    $wait = 0;
    if (count($mine) >= CB_MAX_FAILS) $wait = max($wait, min($mine) + CB_FAIL_WINDOW - $now);
    if (count($all) >= CB_MAX_FAILS_ALL) $wait = max($wait, min($all) + CB_FAIL_WINDOW - $now);
    return max(0, $wait);
}

function cb_record_fail(): void {
    $d = cb_read_json('attempts.json');
    $now = time();
    foreach ($d as $ip => $list) {
        $d[$ip] = array_values(array_filter($list, fn($t) => $t > $now - CB_FAIL_WINDOW));
        if (!$d[$ip]) unset($d[$ip]);
    }
    $d[cb_client_ip()][] = $now;
    cb_write_json('attempts.json', $d);
}

function cb_clear_fails(): void {
    $d = cb_read_json('attempts.json');
    unset($d[cb_client_ip()]);
    cb_write_json('attempts.json', $d);
}

// ------------------------------------------------------------ responses

function cb_json($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function cb_fail(int $status, string $message): void { cb_json(['message' => $message], $status); }

/** Send the browser back to the app, with a message code in the address. */
function cb_back(array $query = []): void {
    header('Cache-Control: no-store');
    header('Location: ' . cb_base_path() . ($query ? '?' . http_build_query($query) : ''), true, 303);
    exit;
}

/** JSON requests must come from the app itself (blocks cross-site requests). */
function cb_require_app_request(): void {
    if (($_SERVER['HTTP_X_COMMITBOOK'] ?? '') !== '1') cb_fail(400, 'This address is for the Commitbook app.');
}

function cb_require_user(): string {
    $u = cb_user();
    if (!$u) cb_fail(401, 'Please sign in again.');
    return $u;
}

function cb_body_json(): array {
    $d = json_decode((string) file_get_contents('php://input'), true);
    return is_array($d) ? $d : [];
}

// ------------------------------------------------------------ GitHub

function cb_api_base(?array $c = null): string {
    $env = getenv('COMMITBOOK_API_BASE');          // for testing only
    return rtrim($env ?: ($c['api_base'] ?? 'https://api.github.com'), '/');
}

/** Make a request to GitHub. Returns [status, body, headers]. */
function cb_github(string $method, string $path, ?string $body, string $token, ?array $c = null): array {
    $url = cb_api_base($c) . $path;
    $headers = [
        'Accept: application/vnd.github+json',
        'X-GitHub-Api-Version: 2022-11-28',
        'User-Agent: Commitbook/' . CB_VERSION,
        'Authorization: Bearer ' . $token,
    ];
    if ($body !== null && $body !== '') $headers[] = 'Content-Type: application/json';
    $respHeaders = [];
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 60,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$respHeaders) {
                $p = strpos($line, ':');
                if ($p !== false) $respHeaders[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1));
                return strlen($line);
            },
        ]);
        if ($body !== null && $body !== '') curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        $out = curl_exec($ch);
        if ($out === false) {
            $err = curl_error($ch);
            curl_close($ch);
            return [502, json_encode(['message' => 'The server couldn’t reach GitHub: ' . $err]), []];
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return [$status, $out, $respHeaders];
    }
    $ctx = stream_context_create(['http' => [
        'method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body ?? '',
        'ignore_errors' => true, 'timeout' => 60,
    ]]);
    $out = @file_get_contents($url, false, $ctx);
    $status = 502;
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $status = (int) $m[1];
        elseif (($p = strpos($h, ':')) !== false) $respHeaders[strtolower(trim(substr($h, 0, $p)))] = trim(substr($h, $p + 1));
    }
    if ($out === false) return [502, json_encode(['message' => 'The server couldn’t reach GitHub.']), []];
    return [$status, $out, $respHeaders];
}

/** Check a repository and token work together. Returns null if fine, or a message. */
function cb_check_github(string $owner, string $repo, string $token, ?array $c = null): ?string {
    [$status, $body] = cb_github('GET', '/repos/' . rawurlencode($owner) . '/' . rawurlencode($repo), null, $token, $c);
    $d = json_decode($body, true);
    if ($status === 401) return 'GitHub didn’t accept the access key. Check it was copied in full and hasn’t expired.';
    if ($status === 404) return 'GitHub couldn’t find that repository with this access key. Check the name, and that the key includes this repository.';
    if ($status >= 300) return 'GitHub said: ' . ($d['message'] ?? "error $status");
    if (isset($d['permissions']['push']) && !$d['permissions']['push']) return 'The access key can read the repository but not save to it. Set “Contents” to “Read and write”.';
    return null;
}

function cb_parse_repo(string $v): ?array {
    $v = trim(preg_replace('#\.git$#', '', trim($v)), '/ ');
    if (preg_match('#(?:github\.com[/:])?([A-Za-z0-9-]+)/([A-Za-z0-9._-]+)$#', $v, $m)) return [$m[1], $m[2]];
    return null;
}

function cb_valid_username(string $u): bool { return (bool) preg_match('/^[A-Za-z0-9._@+-]{2,64}$/', $u); }
