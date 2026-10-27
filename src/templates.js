// Files Commitbook writes into a new, empty notes repository.

export const DATA_README = `# Notes

This repository holds notes written with [Commitbook](https://github.com/thcousins/commitbook).

- Every note is a Markdown file. Folders are ordinary folders.
- Every save is a commit, so the full history of every note is kept here.
- Tags and their colours are in \`.commitbook/tags.json\`.
- Deleted notes are in \`.trash/\` until the Trash is emptied.

See \`CLAUDE.md\` for the exact file format.
`;

export const DATA_CLAUDE = `# Notes repository: instructions for Claude

This repository is the owner's personal notebook. The owner reads and edits it in the
Commitbook web app, and asks Claude to create, add to, tidy, merge or split notes. Both
work on the same files, so keep exactly to this format.

## Files

- One note = one Markdown file. Folders are ordinary folders (\`House/boiler-service.md\`).
- File names are lower case with hyphens, made from the title when the note is created.
  Keep the file name when a title changes, so the note's history stays together.
- An empty folder contains a single empty file named \`.keep\`.
- \`.commitbook/tags.json\` lists every tag with a colour:
  \`{ "tags": [ { "name": "House", "color": "#2e7d5b" } ] }\`. Tag names are unique
  (ignoring case). If you add a tag to a note that isn't in the list, add it to the list too.
- \`.trash/\` holds deleted notes, at their original path, with \`deleted\` and
  \`deletedFrom\` in the front matter. Don't edit notes in the Trash unless asked.
- \`README.md\` and \`CLAUDE.md\` at the top level are not notes.

## Note format

\`\`\`markdown
---
title: "Boiler service"
created: 2026-10-14T09:12:00Z
updated: 2026-10-20T18:40:11Z
tags: ["House", "Annual"]
---

Body text in Markdown…
\`\`\`

- Front matter keys, in this order: \`title\` (quoted), \`created\`, \`updated\` (UTC,
  \`YYYY-MM-DDTHH:MM:SSZ\`), \`tags\` (a JSON-style list; leave it out if there are none).
- When you change a note, set \`updated\` to the current time. Never change \`created\`.
- Don't repeat the title as a heading at the top of the body.
- Use plain Markdown that the editor supports: \`#\`, \`##\`, \`###\` headings, paragraphs,
  **bold**, *italic*, ~~strikethrough~~, \`code\`, links, bullet and numbered lists,
  checklists (\`- [ ]\` / \`- [x]\`), block quotes, code blocks and horizontal rules.
  No raw HTML (except the spreadsheet comment below), footnotes or other extensions.

## Spreadsheets

A spreadsheet is a Markdown table with a comment line above it:

\`\`\`markdown
<!-- commitbook:sheet {"totals":1,"formats":{"2":"gbp"}} -->
| Item        | Supplier | Cost (£)  |
| ----------- | -------- | --------- |
| Oak worktop | Howdens  | 640       |
| Sink        | Screwfix | 315       |
| Total       |          | =SUM(C:C) |
\`\`\`

- The header row holds the column names. In formulas, **row 1 is the first data row**
  (the header isn't counted): \`=C1*2\`, \`=SUM(C1:C2)\`.
- \`totals\` is how many rows at the bottom are total rows. Total rows are kept at the
  bottom, and their formulas only see the data rows, so use whole-column ranges such as
  \`=SUM(C:C)\`, \`=AVERAGE(C:C)\`, \`=MAX(C:C)\`.
- Formulas follow Excel syntax (the app uses HyperFormula): IF, SUMIF, COUNTIF, VLOOKUP,
  ROUND, dates and so on.
- \`formats\` maps a column index (0 = first column) to one of: \`number\`, \`integer\`,
  \`gbp\`, \`usd\`, \`eur\`, \`percent\`, \`text\`. \`widths\` is a list of column widths in pixels.
  Both are optional; keep any that are already there.
- Escape a \`|\` inside a cell as \`\\|\`. Keep every row on one line.
- When adding rows, add them above the total rows.

## Working with notes

- **Finding a note:** the owner describes notes by what they're about. Search titles,
  text and tags; if more than one note could match, ask which one.
- **Adding to a note:** read it first, add the new material where it fits, and don't
  rewrite what's there unless asked.
- **Tidying** (often dictated text): fix punctuation, paragraphs and obvious dictation
  mistakes, and add headings or lists where they help. Keep the owner's meaning and
  wording, never drop facts, and point out anything unclear.
- **Merging:** combine into one note (keeping the earliest \`created\`), then delete the
  other file, or move it to \`.trash/\` with \`deleted\` and \`deletedFrom\` added if the owner
  might want it back.
- **Splitting:** create the new notes, move the content across, and shorten or delete the
  original. Say which notes now exist.
- **Never store secrets** (passwords, PINs, API keys, recovery codes, bank details).
  Say where they're kept instead, and tell the owner if they pasted one.
- Commit with a short message, e.g. \`Edit “Boiler service”\` or \`Merge garden notes\`.
  Pull before pushing: the owner may have saved from the app in the meantime.
`;
