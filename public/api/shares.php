<?php
// Your share links: list them, make one for a note, stop one, or follow a move.
define('COMMITBOOK', 1);
require __DIR__ . '/lib.php';

cb_require_app_request();
cb_require_user();
if (!cb_config()) cb_fail(409, 'This server isn’t set up yet.');

$out = function (array $all) {
    $list = [];
    foreach ($all as $token => $s) {
        $list[] = ['token' => $token, 'path' => $s['path'], 'title' => $s['title'] ?? '', 'made' => $s['made'] ?? 0, 'expires' => $s['expires'] ?? 0];
    }
    usort($list, fn($a, $b) => $b['made'] <=> $a['made']);
    cb_json(['shares' => $list]);
};

$all = cb_shares();
// Tidy away links that have expired.
$now = time();
$live = array_filter($all, fn($s) => empty($s['expires']) || $s['expires'] > $now);
if (count($live) !== count($all)) { $all = $live; cb_save_shares($all); }

if ($_SERVER['REQUEST_METHOD'] === 'GET') $out($all);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') cb_fail(405, 'Not allowed.');

$in = cb_body_json();
$act = (string) ($in['action'] ?? '');
$path = trim((string) ($in['path'] ?? ''), '/');
$validPath = fn($p) => $p !== '' && strlen($p) < 400 && preg_match('/\.md$/i', $p) && !preg_match('#(^|/)\.#', $p) && strpos($p, '..') === false;

if ($act === 'create') {
    if (!$validPath($path)) cb_fail(422, 'That note can’t be shared.');
    $days = (int) ($in['days'] ?? 0);
    $all[cb_new_token()] = [
        'path' => $path,
        'created' => substr((string) ($in['created'] ?? ''), 0, 40),
        'title' => function_exists('mb_substr') ? mb_substr((string) ($in['title'] ?? ''), 0, 200) : substr((string) ($in['title'] ?? ''), 0, 200),
        'made' => $now,
        'expires' => $days > 0 ? $now + min($days, 3650) * 86400 : 0,
    ];
    cb_save_shares($all);
    $out($all);
}
if ($act === 'revoke') {
    $token = (string) ($in['token'] ?? '');
    unset($all[$token]);
    cb_save_shares($all);
    $out($all);
}
if ($act === 'repath') {
    // A note or folder was moved in the app: keep its links pointing at it.
    $to = trim((string) ($in['to'] ?? ''), '/');
    $folder = !empty($in['folder']);
    foreach ($all as $t => $s) {
        if (!$folder && $s['path'] === $path && $validPath($to)) $all[$t]['path'] = $to;
        if ($folder && $path !== '' && strpos($s['path'], $path . '/') === 0) $all[$t]['path'] = $to . substr($s['path'], strlen($path));
    }
    cb_save_shares($all);
    $out($all);
}
cb_fail(422, 'Unknown action.');
