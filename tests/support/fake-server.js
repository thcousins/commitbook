// The fake GitHub as a real HTTP server, for testing the PHP server side.
// POST /__reset resets it to the sample notes. Usage: node fake-server.js [port]
import http from 'node:http';
import { createFakeGitHub } from './fake-github.js';
import { SEED } from './seed.js';

export function startFakeServer(port = 4999) {
  let gh = createFakeGitHub({ files: SEED });
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || '' });
      if (req.url === '/__reset') { gh = createFakeGitHub({ files: SEED }); seen.length = 0; res.end('ok'); return; }
      if (req.url === '/__files') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(gh.files())); return; }
      if (req.url === '/__seen') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(seen)); return; }
      if (req.headers.authorization !== 'Bearer test-token') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'Bad credentials' }));
        return;
      }
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      const r = gh.handle(req.method, `https://api.github.com${req.url}`, body);
      res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '0' });
      res.end(JSON.stringify(r.body));
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, get gh() { return gh; }, seen })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 4999);
  startFakeServer(port).then(() => console.log(`fake GitHub on http://127.0.0.1:${port}`));
}
