---
name: commitbook-notes
description: Use when the user asks to add, find, read, update, tidy, merge, split, move, tag or delete notes in their notebook (Commitbook), e.g. "add this to my notebook" or "tidy my garden note".
---

# My notebook (Commitbook)

The user's notebook is a GitHub repository of Markdown notes, edited in the Commitbook web app.
Changes saved to the repository appear in the app automatically.

**Notes repository:** `OWNER/REPO` (branch `main`)

## 1. Get the notes

- Connect to the repository above. If there's a tool for adding a GitHub repository to this
  session, use it with that owner and name, then clone the repository as it instructs.
- If you can't reach the repository (no GitHub access here, or access is refused), say so
  plainly. Tell the user Claude needs access to that repository through the Claude GitHub app
  (GitHub → Settings → Applications → Claude → Configure → Repository access), and offer the
  note text so they can paste it into Commitbook themselves. Don't pretend it was saved.

## 2. Read the rules first

Read `CLAUDE.md` at the top of the notes repository before changing anything, and follow it.
It describes the note format, folders, tags (`.commitbook/tags.json`), spreadsheets and the
Trash. If it's missing, use the summary below.

## 3. Do the work

- **Find notes** by what they're about: search titles, text and tags (for example
  `grep -ril "boiler" --include=*.md .`), ignoring `.trash/`, `README.md` and `CLAUDE.md`.
  If more than one note could match, ask which one.
- **Add to a note:** read it, add the new material where it fits, keep everything else.
- **New note:** create `<folder>/<title-in-lower-case-with-hyphens>.md`. Use an existing folder
  if one clearly fits; otherwise put it at the top level, or ask if unsure.
- **Tidy** (often dictated text): fix punctuation, paragraphs and obvious dictation mistakes,
  add headings or lists where they help. Keep the user's meaning and facts; flag anything unclear.
- **Merge, split, move or delete:** follow `CLAUDE.md`. Prefer moving to `.trash/` over deleting,
  unless the user asks for permanent deletion.
- Set `updated` in the note's front matter to the current UTC time. Never change `created`.
- **Never store secrets** (passwords, PINs, API keys, recovery codes, bank details). If the user
  includes one, leave it out and say why.

## 4. Save

- Commit straight to `main` (the app reads `main`; don't open branches or pull requests).
- Before pushing, run `git pull --rebase`: the user may have saved from the app in the meantime.
- One commit per request, with a short message such as `Add “Boiler service”` or
  `Tidy “Garden ideas”`.

## 5. Report back

Say which note(s) you changed or created (title and folder) and what changed, in a sentence or
two. Mention that the app shows the change next time they switch to it.

## Note format (summary, if `CLAUDE.md` is missing)

```markdown
---
title: "Boiler service"
created: 2026-10-14T09:12:00Z
updated: 2026-10-20T18:40:11Z
tags: ["House", "Annual"]
---

Body in plain Markdown: # ## ### headings, **bold**, *italic*, lists, checklists (- [ ] / - [x]),
quotes, code, links. No raw HTML. Don't repeat the title as a heading.
```

Spreadsheets are Markdown tables preceded by `<!-- commitbook:sheet {"totals":1} -->`; the header
row holds column names (empty cells show as A, B, C), row 1 in formulas is the first data row,
and the last `totals` rows are total rows (use whole-column formulas such as `=SUM(C:C)`). Add
new rows above the total rows. Type dates as `27/10/2026` and times as `14:30`.
