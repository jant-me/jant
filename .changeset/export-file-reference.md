---
"@jant/core": patch
"create-jant": patch
---

The export and import page lists every front-matter field and `data/jant.toml` key a site export writes, and marks the ones only the bundled Hugo theme reads. The rest change only in a major release. Before, the page named a handful in prose, and everything else, `title` and `format` included, was outside the contract by omission.
