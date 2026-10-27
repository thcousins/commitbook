import './styles.css';
import { local } from './lib/cache.js';
import { esc } from './lib/util.js';
import { icon } from './ui/icons.js';
import { GitHubRepo } from './github.js';

// Commitbook runs in one of two ways:
//  * Hosted: on a web server with PHP (e.g. cPanel). The server keeps the GitHub
//    access key and has its own sign-in page. Detected by asking api/session.php.
//  * Browser only: static files anywhere (e.g. GitHub Pages). Each device enters the
//    notes repository and an access key, which stay in that browser.

const root = document.getElementById('app');
const params = new URLSearchParams(location.search);
if (location.search) history.replaceState(null, '', location.pathname + location.hash);

const SETUP_HELP = `
  <details class="cb-help-steps">
    <summary>How to make the GitHub access key</summary>
    <ol>
      <li><b>Make a private repository</b> for your notes on GitHub, for example <code>notes</code>. It can be empty; Commitbook sets it up.</li>
      <li><b>Find the fine-grained tokens page:</b> on GitHub, click your <b>profile picture</b> (top right) → <b>Settings</b> → <b>Developer settings</b> (at the bottom of the left-hand menu) → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b>. Or go straight there: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a>.</li>
      <li><b>Fill in the form:</b>
        <ul>
          <li><b>Token name:</b> <i>Commitbook</i>. <b>Expiration:</b> choose a date (and put a reminder in your calendar to renew it).</li>
          <li><b>Resource owner:</b> your own account.</li>
          <li><b>Repository access:</b> choose <i>Only select repositories</i> and pick your notes repository.</li>
          <li><b>Permissions:</b> under <i>Repository permissions</i>, set <b>Contents</b> to <i>Read and write</i>. (If you see an <i>Add permissions</i> button instead, click it, choose <i>Contents</i>, then set it to <i>Read and write</i>.) Leave everything else as it is.</li>
        </ul></li>
      <li>Click <b>Generate token</b> and copy it straight away. GitHub only shows it once; if you lose it, make a new one.
        </ul></li>
    </ol>
  </details>`;

function brandHtml() {
  return `<div class="cb-brand cb-brand-lg">${icon('logo')}<span>Commitbook</span></div>`;
}

async function detectServer() {
  try {
    const r = await fetch('api/session.php', { headers: { 'X-Commitbook': '1' }, cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
    const j = await r.json();
    return j && j.app === 'commitbook' ? j : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ hosted: sign in

function signInScreen(server) {
  const status = params.get('signin');
  const wait = Number(params.get('wait')) || Math.ceil((server.lockedFor || 0) / 60);
  const locked = status === 'locked' || server.lockedFor > 0;
  const message = locked
    ? `Too many attempts. Please wait ${wait} minute${wait === 1 ? '' : 's'} and try again.`
    : status === 'failed' ? 'That username and password don’t match. Please try again.'
      : params.get('signedout') ? 'You’ve been signed out.' : '';
  root.innerHTML = `
    <div class="cb-signin">
      <form class="cb-signin-box" method="post" action="api/login.php" id="cb-login">
        ${brandHtml()}
        <h1 class="cb-signin-title">Sign in</h1>
        <label class="cb-field"><span>Username</span>
          <input id="username" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value="${esc(params.get('u') || '')}"></label>
        <label class="cb-field"><span>Password</span>
          <input id="password" name="password" type="password" autocomplete="current-password" required></label>
        <label class="cb-check"><input type="checkbox" name="remember" value="1" checked> Keep me signed in on this device</label>
        <p class="${status || locked ? 'cb-error' : 'cb-info'}" ${message ? '' : 'hidden'} role="${status || locked ? 'alert' : 'status'}">${esc(message)}</p>
        <button class="cb-btn cb-btn-primary cb-btn-wide" ${locked ? 'disabled' : ''}>Sign in</button>
      </form>
    </div>`;
  const form = document.getElementById('cb-login');
  form.addEventListener('submit', () => { form.querySelector('button').disabled = true; form.querySelector('button').textContent = 'Signing in…'; });
  (params.get('u') ? form.password : form.username).focus();
}

// ------------------------------------------------------------ hosted: first-time setup

const SETUP_ERRORS = {
  username: 'Choose a username of 2 to 64 letters, numbers or . _ @ + - (no spaces).',
  short: 'Use at least 10 characters for the password.',
  mismatch: 'The two passwords don’t match.',
  repo: 'Enter the notes repository as owner/name, for example your-name/notes.',
  token: 'Paste the GitHub access key.',
};

function setupScreen() {
  const code = params.get('setup');
  const message = code === 'github' ? params.get('msg') || 'GitHub didn’t accept those details.' : SETUP_ERRORS[code] || '';
  root.innerHTML = `
    <div class="cb-signin">
      <form class="cb-signin-box" method="post" action="api/setup.php" id="cb-setup">
        ${brandHtml()}
        <h1 class="cb-signin-title">Set up Commitbook</h1>
        <p class="cb-lede">Choose how you’ll sign in, then connect your notes repository. The access key is kept on this server and never sent to your browser.</p>
        <fieldset class="cb-fieldset"><legend>Your sign-in</legend>
          <label class="cb-field"><span>Username</span>
            <input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value="${esc(params.get('u') || '')}"></label>
          <label class="cb-field"><span>Password <small>(at least 10 characters)</small></span>
            <input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
          <label class="cb-field"><span>Password again</span>
            <input name="password2" type="password" autocomplete="new-password" minlength="10" required></label>
        </fieldset>
        <fieldset class="cb-fieldset"><legend>Your notes on GitHub</legend>
          <label class="cb-field"><span>Notes repository</span>
            <input name="repo" placeholder="your-name/notes" autocomplete="off" autocapitalize="none" spellcheck="false" required value="${esc(params.get('r') || '')}"></label>
          <label class="cb-field"><span>GitHub access key</span>
            <input name="token" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false" required></label>
          ${SETUP_HELP}
        </fieldset>
        <label class="cb-check"><input type="checkbox" name="remember" value="1" checked> Keep me signed in on this device</label>
        <p class="cb-error" ${message ? '' : 'hidden'} role="alert">${esc(message)}</p>
        <button class="cb-btn cb-btn-primary cb-btn-wide">Save and open my notes</button>
      </form>
    </div>`;
  const form = document.getElementById('cb-setup');
  form.addEventListener('submit', e => {
    if (form.password.value !== form.password2.value) {
      e.preventDefault();
      const p = form.querySelector('.cb-error');
      p.textContent = SETUP_ERRORS.mismatch;
      p.hidden = false;
      return;
    }
    form.querySelector('button').disabled = true;
    form.querySelector('button').textContent = 'Checking with GitHub…';
  });
  form.username.focus();
}

// ------------------------------------------------------------ browser only

function parseRepo(value) {
  const v = String(value || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = v.match(/(?:github\.com[/:])?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function browserSignIn(error = '', prefill = {}) {
  root.innerHTML = `
    <div class="cb-signin">
      <form class="cb-signin-box" id="cb-signin" novalidate>
        ${brandHtml()}
        <p class="cb-lede">A notebook that saves every note to your own GitHub repository, with its full history.</p>
        <label class="cb-field"><span>Notes repository</span>
          <input id="cb-repo" name="repo" placeholder="your-name/notes" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(prefill.repo || '')}" required></label>
        <label class="cb-field"><span>GitHub access key</span>
          <input id="cb-token" name="token" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false" required></label>
        <p class="cb-error" id="cb-signin-error" ${error ? '' : 'hidden'}>${esc(error)}</p>
        <button class="cb-btn cb-btn-primary cb-btn-wide" id="cb-connect">Open my notes</button>
        ${SETUP_HELP.replace('<details class="cb-help-steps">', `<details class="cb-help-steps" ${error ? '' : 'open'}>`)}
        <p class="cb-help">In this version the key is kept in this browser and sent only to GitHub, so you enter it once on each device. To keep it on a server with a normal sign-in instead, install Commitbook on PHP hosting (see the README).</p>
      </form>
    </div>`;
  const form = document.getElementById('cb-signin');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const repo = parseRepo(form.repo.value);
    const token = form.token.value.trim();
    const errEl = document.getElementById('cb-signin-error');
    const fail = msg => { errEl.textContent = msg; errEl.hidden = false; };
    if (!repo) return fail('Enter the repository as owner/name, for example your-name/notes.');
    if (!token) return fail('Paste the access key from GitHub.');
    const btn = document.getElementById('cb-connect');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const gh = new GitHubRepo({ ...repo, token });
      const info = await gh.getRepo();
      if (info.permissions && info.permissions.push === false) throw new Error('This access key can read the repository but not save to it. Set “Contents” to “Read and write”.');
      local.set('cb:settings', { ...repo, token });
      boot();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Open my notes';
      fail(err.message);
    }
  });
  (prefill.repo ? form.token : form.repo).focus();
}

// ------------------------------------------------------------ start

async function boot() {
  const server = await detectServer();
  if (server) {
    if (!server.setup) { setupScreen(); return; }
    if (!server.signedIn) { signInScreen(server); return; }
    const { startApp } = await import('./app.js');
    window.commitbook = await startApp(root, { owner: server.repo.owner, repo: server.repo.repo, hosted: true, user: server.user });
    return;
  }
  const s = local.get('cb:settings');
  if (!s || !s.owner || !s.repo || !s.token) { browserSignIn(); return; }
  const { startApp } = await import('./app.js');
  try {
    window.commitbook = await startApp(root, s);
  } catch (e) {
    browserSignIn(e.message, { repo: `${s.owner}/${s.repo}` });
  }
}

boot();
