import './styles.css';
import { local } from './lib/cache.js';
import { esc } from './lib/util.js';
import { icon } from './ui/icons.js';
import { GitHubRepo } from './github.js';

const root = document.getElementById('app');

function parseRepo(value) {
  const v = String(value || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = v.match(/(?:github\.com[/:])?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function signIn(error = '', prefill = {}) {
  root.innerHTML = `
    <div class="cb-signin">
      <form class="cb-signin-box" id="cb-signin" novalidate>
        <div class="cb-brand cb-brand-lg">${icon('logo')}<span>Commitbook</span></div>
        <p class="cb-lede">A notebook that saves every note to your own GitHub repository, with its full history.</p>
        <label class="cb-field"><span>Notes repository</span>
          <input id="cb-repo" name="repo" placeholder="your-name/notes" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(prefill.repo || '')}" required></label>
        <label class="cb-field"><span>GitHub access key</span>
          <input id="cb-token" name="token" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false" required></label>
        <p class="cb-error" id="cb-signin-error" ${error ? '' : 'hidden'}>${esc(error)}</p>
        <button class="cb-btn cb-btn-primary cb-btn-wide" id="cb-connect">Open my notes</button>
        <details class="cb-help-steps" ${error ? '' : 'open'}>
          <summary>How to set this up (about 3 minutes)</summary>
          <ol>
            <li><b>Make a private repository</b> for your notes on GitHub, for example <code>notes</code>. It can be empty; Commitbook sets it up.</li>
            <li><b>Create an access key:</b> open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained tokens → Generate new token</a>.
              <ul>
                <li>Name it <i>Commitbook</i> and choose an expiry date.</li>
                <li>Under <b>Repository access</b>, choose <i>Only select repositories</i> and pick your notes repository.</li>
                <li>Under <b>Permissions → Repository permissions</b>, set <b>Contents</b> to <i>Read and write</i>.</li>
                <li>Click <b>Generate token</b> and copy it.</li>
              </ul></li>
            <li><b>Paste it above</b> with the repository name. Do this once on each device you use.</li>
          </ol>
          <p class="cb-help">The key is kept only in this browser and is sent only to GitHub. It can only reach the one repository you picked.</p>
        </details>
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

async function boot() {
  const s = local.get('cb:settings');
  if (!s || !s.owner || !s.repo || !s.token) { signIn(); return; }
  const { startApp } = await import('./app.js');
  try {
    window.commitbook = await startApp(root, s);
  } catch (e) {
    signIn(e.message, { repo: `${s.owner}/${s.repo}` });
  }
}

boot();
