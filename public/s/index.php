<?php
// The page for a share link: /s/<token>. It's the app's own page in read-only mode,
// told which link it's showing.
define('COMMITBOOK', 1);
require __DIR__ . '/../api/lib.php';

$token = (string) ($_GET['t'] ?? '');
if ($token === '') {
    // Without the rewrite rule (or on PHP's test server), read it from the address.
    $uri = strtok($_SERVER['REQUEST_URI'] ?? '', '?');
    $token = basename(rtrim((string) $uri, '/'));
    if (!preg_match(CB_SHARE_RE, $token)) $token = (string) ($_SERVER['QUERY_STRING'] ?? '');
}
if (!preg_match(CB_SHARE_RE, $token)) $token = '0';

$html = @file_get_contents(__DIR__ . '/../index.html');
if ($html === false) { http_response_code(500); exit('Commitbook isn’t installed correctly.'); }
$base = htmlspecialchars(cb_base_path(), ENT_QUOTES);
$html = preg_replace('/<head>/', "<head>\n    <base href=\"$base\" />\n    <meta name=\"cb-share\" content=\"$token\" />", $html, 1);
$html = str_replace('<title>Commitbook</title>', '<title>Shared note</title>', $html);
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');
echo $html;
