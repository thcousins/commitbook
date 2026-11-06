<?php
// The GitHub gatekeeper for shared links. Someone with a link can use the app on just the
// shared note or folder: the server adds the access key, and only passes on reads of things
// inside the share and, for links that allow editing, saves to existing notes inside it.
// Nothing can be deleted, moved, renamed or created, and nothing outside the share is shown.
define('COMMITBOOK', 1);
require __DIR__ . '/lib.php';

header('X-Robots-Tag: noindex, nofollow');
$token = (string) ($_GET['t'] ?? '');
$c = cb_config();
$share = $c ? cb_share_for($token) : null;
if (!$share) cb_fail(404, 'This link isn’t valid, or sharing has been turned off.');
$kind = cb_share_kind($share);
$mode = cb_share_mode($share);
$repoBase = "/repos/{$c['owner']}/{$c['repo']}";

// ---- what the app needs to start: what is shared and how
if (isset($_GET['info'])) {
    if ($kind === 'note') {
        $found = cb_find_shared_note($c, $token, $share);   // follows a moved note
        if (!$found) cb_fail(404, 'This link isn’t valid, or sharing has been turned off.');
        $title = (string) ($found[1]['title'] ?? $share['title'] ?? '');
    } else {
        $title = basename($share['path']);
    }
    cb_json(['kind' => $kind, 'mode' => $mode, 'path' => $share['path'], 'title' => $title]);
}

cb_require_app_request();
$method = $_SERVER['REQUEST_METHOD'];
$p = (string) ($_GET['p'] ?? '');
$q = strpos($p, '?');
$path = $q === false ? $p : substr($p, 0, $q);
$query = $q === false ? '' : substr($p, $q + 1);
parse_str($query, $qs);
// The app doesn't know (or need) the repository's name: it asks for /repos/_/_/…
if (!preg_match('#^/repos/[^/]+/[^/]+(/.*)?$#', $path, $m)) cb_fail(403, 'Not allowed.');
$rest = $m[1] ?? '';
if (strpos($rest, '..') !== false) cb_fail(403, 'Not allowed.');
$deny = fn() => cb_fail(403, 'This shared link doesn’t allow that.');
$decode = fn(string $s) => implode('/', array_map('rawurldecode', explode('/', $s)));

$pass = function (string $method, string $apiPath, ?string $body = null) use ($c) {
    [$status, $out, $headers] = cb_github($method, $apiPath, $body, $c['token'], $c);
    return [$status, $out];
};
$send = function (int $status, string $out) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo $out;
    exit;
};

// Blobs may only be read if they belong to a file inside the share. The allowed list is
// made from the latest folder listing the app asked for (and refreshed when needed).
$cacheFile = cb_data_dir() . '/guest-' . substr(hash('sha256', $token), 0, 16) . '.json';
$scopedTree = function (string $ref) use ($pass, $repoBase, $share, $cacheFile) {
    [$status, $out] = $pass('GET', "$repoBase/git/trees/" . rawurlencode($ref) . '?recursive=1');
    if ($status !== 200) return [$status, $out, null];
    $d = json_decode($out, true);
    $keep = [];
    foreach ($d['tree'] ?? [] as $e) {
        $p = $e['path'] ?? '';
        if ($p === '.commitbook/tags.json' || cb_in_share($share, $p)) $keep[] = $e;
    }
    $d['tree'] = $keep;
    $shas = array_values(array_unique(array_map(fn($e) => $e['sha'], array_filter($keep, fn($e) => ($e['type'] ?? '') === 'blob'))));
    @file_put_contents($cacheFile, json_encode(['shas' => $shas, 'time' => time()]), LOCK_EX);
    return [200, json_encode($d), $shas];
};

// ---- the repository itself: only what the app needs, with "can save" set by the link
if ($rest === '' && $method === 'GET') {
    [$status, $out] = $pass('GET', $repoBase);
    if ($status !== 200) $send($status, $out);
    $r = json_decode($out, true);
    cb_json(['default_branch' => $r['default_branch'] ?? 'main', 'private' => true, 'permissions' => ['pull' => true, 'push' => $mode === 'edit', 'admin' => false]]);
}

// ---- the latest commit on the branch
if ($method === 'GET' && preg_match('#^/git/ref/heads/[^/]+$#', $rest)) {
    [$status, $out] = $pass('GET', $repoBase . $rest);
    $d = json_decode($out, true);
    if ($status === 200) cb_json(['ref' => $d['ref'] ?? '', 'object' => ['sha' => $d['object']['sha'] ?? '', 'type' => 'commit']]);
    $send($status, $out);
}

// ---- the list of files: only those inside the share
if ($method === 'GET' && preg_match('#^/git/trees/([^/]+)$#', $rest, $mm)) {
    [$status, $out] = $scopedTree($decode($mm[1]));
    $send($status, $out);
}

// ---- a file's contents by id: only files inside the share
if ($method === 'GET' && preg_match('#^/git/blobs/([0-9a-f]{40})$#', $rest, $mm)) {
    $allowed = is_file($cacheFile) ? (json_decode((string) file_get_contents($cacheFile), true)['shas'] ?? []) : [];
    if (!in_array($mm[1], $allowed, true)) {
        [, $r0] = $pass('GET', $repoBase);
        $branch = json_decode($r0, true)['default_branch'] ?? 'main';
        [$s0, $o0] = $pass('GET', "$repoBase/git/ref/heads/" . rawurlencode($branch));
        $head = json_decode($o0, true)['object']['sha'] ?? 'main';
        [, , $allowed] = $scopedTree($head);
        if (!in_array($mm[1], $allowed ?? [], true)) $deny();
    }
    [$status, $out] = $pass('GET', $repoBase . $rest);
    $send($status, $out);
}

// ---- reading and saving a note by its path
if (preg_match('#^/contents/(.+)$#', $rest, $mm)) {
    $file = $decode($mm[1]);
    if ($method === 'GET') {
        if ($file !== '.commitbook/tags.json' && !cb_in_share($share, $file)) $deny();
        $ref = isset($qs['ref']) ? '?ref=' . rawurlencode((string) $qs['ref']) : '';
        [$status, $out] = $pass('GET', $repoBase . $rest . $ref);
        $send($status, $out);
    }
    if ($method === 'PUT') {
        if ($mode !== 'edit' || !cb_in_share($share, $file, true)) $deny();
        $body = cb_body_json();
        if (empty($body['sha'])) $deny();                      // existing notes only
        $msg = (string) ($body['message'] ?? 'Edit');
        $body['message'] = (function_exists('mb_substr') ? mb_substr($msg, 0, 200) : substr($msg, 0, 200)) . ' (shared link)';
        [$status, $out] = $pass('PUT', $repoBase . $rest, json_encode($body));
        $send($status, $out);
    }
    $deny();
}

// ---- history of a note inside the share
if ($method === 'GET' && $rest === '/commits') {
    if (empty($qs['path']) || !cb_in_share($share, (string) $qs['path'])) $deny();
    [$status, $out] = $pass('GET', "$repoBase/commits?" . http_build_query($qs));
    $send($status, $out);
}
if ($method === 'GET' && preg_match('#^/commits/([0-9a-f]{40})$#', $rest)) {
    [$status, $out] = $pass('GET', $repoBase . $rest);
    if ($status !== 200) $send($status, $out);
    $d = json_decode($out, true);
    $d['files'] = array_values(array_filter($d['files'] ?? [], fn($f) => cb_in_share($share, $f['filename'] ?? '')));
    if (!$d['files']) $deny();                                  // a change to something outside the share
    foreach ($d['files'] as &$f) if (!empty($f['previous_filename']) && !cb_in_share($share, $f['previous_filename'])) unset($f['previous_filename']);
    cb_json($d);
}

$deny();
