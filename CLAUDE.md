# Working on Commitbook (instructions for Claude)

Commitbook is a static web app (Vite, vanilla JS, no framework) that stores notes as Markdown
files in a user's GitHub repository through the REST API. There is no backend.

## Ground rules

- **Never lose or corrupt notes.** Any change to saving, the file format or the store must
  keep existing files loading and round-tripping unchanged. Add a unit test for it.
- The data format is a public contract: `docs/data-format.md` and the `DATA_CLAUDE` text in
  `src/templates.js` (written into new notes repositories) must stay in sync with the code.
- No secrets in this repository. Tokens live only in the user's browser.
- British English in the interface and docs. Write interface text from the user's side
  (“Revision history”, not “commits list”).

## Layout

- `src/github.js`: API client. `putFile` for single-file saves (GitHub checks the sha, so
  conflicts are caught); `commitChanges` for multi-file changes (moves, folders, tags) via
  the git data API, retried when the branch moves.
- `src/store.js`: in-memory model of the repository and every operation on it.
- `src/app.js`: UI shell. `flush()` must be awaited before anything that leaves the current
  note or rewrites its file; it returns false if the user cancels (manual-save mode).
- `src/editor/`: TipTap (Markdown in and out via `@tiptap/markdown`) and the spreadsheet node.
  The grid is Jspreadsheet CE with `parseFormulas: false`; HyperFormula computes values and
  `SheetView.paint()` draws them. Total rows are drawn by `renderTotals()`, not Jspreadsheet.
- `src/lib/`: pure helpers with unit tests in `tests/unit/`.
- `public/api/`: the PHP server side for hosted mode (copied into the build as `api/`).
  `github.php` must keep allowing only the configured repository and the API paths the app
  uses. Settings live outside the web folder (`cb_data_dir()`); never write secrets inside it.
  `src/main.js` detects hosted mode by asking `api/session.php`.
- Releases: push a tag `vX.Y.Z` (matching `package.json` and `CB_VERSION` in `lib.php`) and the
  `Release` workflow attaches `commitbook-X.Y.Z.zip`.

## Testing

- `npm run test:unit` runs in plain Node (no installs needed) and covers the libraries and the
  store against `tests/support/fake-github.js`.
- The `Test` workflow builds the app and runs the Playwright tests in Chromium and WebKit
  against the same fake GitHub. It force-pushes screenshots (`shots/`), logs and failure
  images to the `ci-results` branch, so you can review them with
  `git fetch origin ci-results && git show origin/ci-results:e2e.log`.
- When packages can't be installed locally, push to a branch and read the results there.

## Releasing

Pushing to `main` runs `Deploy`, which publishes to GitHub Pages (if turned on) and over SSH
(if the `DEPLOY_*` secrets are set).
