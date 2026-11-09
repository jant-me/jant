---
"@jant/core": minor
---

Text can be highlighted. Select it and press **Highlight** beside Italic in the selection toolbar, press `Cmd + Shift + H` (`Ctrl + Shift + H` on Windows and Linux), or type `==text==`. A highlight renders as `<mark>`. In Markdown it is `==text==`, the syntax Obsidian uses, in `bodyMarkdown`, exports, and copy and paste; pasted HTML keeps its `<mark>` elements. Hugo exports turn on Goldmark's `mark` extension, so the exported site shows the same highlights.

Equals signs a post already contains stay text. `bodyMarkdown` and exports escape the ones that could read as a highlight, as in `a\=\=b`, and leave the rest, such as `x = 1`, as they are.

For themes: highlights use `--site-highlight-bg` and `--site-highlight-color`, which default to `--site-search-mark-bg` and `--site-search-mark-color`. Marks on the search page keep the search colors, so a theme can style the two apart.

**Upgrade notes**

- No database migrations.
- `bodyMarkdown` sent through the API, MCP or the CLI now reads `==text==` as a highlight. To keep the equals signs, write them as `\=\=`.
- An export made by an earlier version leaves `==text==` unescaped, so importing it highlights that text.
