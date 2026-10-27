# Commitbook

A notebook web app that keeps every note as a plain Markdown file in **your own GitHub
repository**. Every save is a commit, so you get full revision history for free, and
your notes stay readable on GitHub, by any text editor and by AI assistants such as Claude.

- **Write without Markdown:** a formatted editor with headings (H1–H3), bold, italic,
  lists, checklists, quotes, code and undo/redo. Markdown shortcuts work too (`#`, `-`, `[ ]`).
- **Spreadsheets inside notes:** a proper grid ([Jspreadsheet CE](https://github.com/jspreadsheet/ce))
  with Excel-style formulas ([HyperFormula](https://hyperformula.handsontable.com/)), sorting,
  filtering, number formats and pinned total rows. Stored as an ordinary Markdown table.
- **Folders and tags:** nest notes in folders and drag them between folders. Tags have unique
  names and colours, and you can filter by several at once.
- **History:** see every version of a note (even from before it was moved), restore any of them, and search old versions.
- **Trash:** deleted notes can be restored.
- **Auto-save or manual saving**, with a warning if you leave a note without saving.
- **Changes made elsewhere** (another device, or Claude editing the repository) are picked up,
  and the app never silently overwrites them.
- **No server:** the app is a static web page. It talks straight to GitHub from your browser.

## Two ways to run it

| | **On your own web hosting** (recommended) | **Browser only** (e.g. GitHub Pages) |
|---|---|---|
| Where the GitHub access key lives | On your server, never sent to the browser | In each browser you use |
| Signing in | Username and password; works with Apple Passwords and other password managers | Paste the repository and access key once per device |
| Needs | PHP hosting with HTTPS (any cPanel host) | Any static hosting |
| How to install | Upload the release zip — see [docs/install.md](docs/install.md) | Fork this repo and turn on GitHub Pages |

It's the same build either way: the app checks whether its PHP server side is there and
switches mode by itself.

## Using it in a browser only

You need a GitHub account.

1. **Create a private repository** for your notes, e.g. `notes`. It can be empty.
2. **Create a fine-grained access token:**

   1. **Find the fine-grained tokens page.** On GitHub, click your **profile picture** (top right)
      → **Settings** → **Developer settings** (at the bottom of the left-hand menu)
      → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
      Or go straight there: [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
   2. **Fill in the form:**
      - **Token name:** *Commitbook*. **Expiration:** choose a date, and put a reminder in your
        calendar to renew it.
      - **Resource owner:** your own account.
      - **Repository access:** *Only select repositories* → your notes repository.
      - **Permissions:** under *Repository permissions*, set **Contents** to *Read and write*.
        (If you see an *Add permissions* button instead, click it, choose *Contents*, then set it
        to *Read and write*.) Leave everything else as it is.
   3. Click **Generate token** and **copy it straight away**. GitHub only shows it once; if you lose
      it, just make a new one.

3. **Open Commitbook** and enter `your-name/notes` and the token. Do this once on each device.

The token is stored only in that browser's local storage and is sent only to `api.github.com`.
It can reach only the repository you selected. To stop a device having access, sign out in
the app or revoke the token on GitHub.

The first time you open an empty repository, Commitbook adds a `README.md`, a `CLAUDE.md`
(instructions for Claude) and `.commitbook/tags.json`.

## How notes are stored

See [docs/data-format.md](docs/data-format.md). In short:

```markdown
---
title: "Kitchen renovation"
created: 2026-09-20T18:30:00Z
updated: 2026-10-26T21:14:02Z
tags: ["House"]
---

Budget for the spring refit.

<!-- commitbook:sheet {"totals":1,"formats":{"3":"gbp"}} -->
| Item        | Supplier | Status  | Cost (£)  |
| ----------- | -------- | ------- | --------- |
| Oak worktop | Howdens  | Ordered | 640       |
| Total       |          |         | =SUM(D:D) |
```

## Hosting your own copy

For web hosting with PHP, follow [docs/install.md](docs/install.md): upload the zip from the
[Releases page](https://github.com/thcousins/commitbook/releases) and open the address.

For browser-only use, the app is static files, so you can host it anywhere.

- **GitHub Pages:** fork this repository, then in *Settings → Pages* set *Source* to
  *GitHub Actions*. The `Deploy` workflow publishes it on every push.
- **Your own web hosting over SSH:** add the repository secrets `DEPLOY_HOST`, `DEPLOY_USER`,
  `DEPLOY_PATH`, `DEPLOY_SSH_KEY` (and `DEPLOY_PORT` if it isn't 22). The `Deploy` workflow
  uploads the built app there with `rsync`.

## Development

```sh
npm install
npm run dev          # http://localhost:5173
npm run test:unit    # file format, formulas, the storage layer and the PHP server side (needs php)
npm run build
npx playwright install chromium webkit
npm run test:e2e     # the built app in Chrome and Safari's engine, against a fake GitHub
```

The browser tests never touch real GitHub: `tests/support/fake-github.js` implements the
API endpoints the app uses, in memory.

Code map:

| Path | What it does |
|---|---|
| `src/github.js` | GitHub REST API client |
| `src/store.js` | Loading and saving notes, folders, tags, Trash, history |
| `src/app.js` | The app: sidebar, note view, panels, saving |
| `src/editor/` | TipTap editor and the spreadsheet block |
| `src/lib/` | Front matter, spreadsheet Markdown, formulas, formats, helpers |
| `public/api/` | PHP server side for hosted mode: sign-in, setup, settings, GitHub gatekeeper |

## Licence

Commitbook's own code is released under the [MIT licence](LICENSE).

The built app bundles third-party libraries under their own licences, notably
[HyperFormula](https://github.com/handsontable/hyperformula) (GPL-3.0, used here under its
free `gpl-v3` licence key), [TipTap](https://github.com/ueberdosis/tiptap) (MIT),
[Jspreadsheet CE](https://github.com/jspreadsheet/ce) (MIT) and [Lucide](https://lucide.dev)
icons (ISC). Because of HyperFormula, distributions of the built app as a whole must also
meet the GPL-3.0's terms (for example, making the source available, which this repository does).
