---
"@jant/core": patch
"create-jant": patch
---

Pasting or dropping content into the editor no longer brings in an HTML block. A page you copy from could plant one, in its HTML or as a `jant-html` fence in the Markdown it puts on the clipboard, and it would publish its HTML as it was, scripts included. A pasted HTML block now arrives as an `html` code block with its source intact, and a pasted embed keeps only its URL. Insert an HTML block from the editor's menu to add one on purpose.

**Upgrade notes**

- No database migrations.
- Posts already saved are unchanged.
