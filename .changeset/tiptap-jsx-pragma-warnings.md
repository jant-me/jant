---
"@jant/core": patch
"create-jant": patch
---

`npm run dev` and `jant deploy` no longer print two esbuild warnings about `@jsxImportSource` in `@tiptap/extension-blockquote` and `@tiptap/extension-bold`. TipTap now ships inside `@jant/core` instead of being bundled from the site's `node_modules`, so the server converts Markdown with the same TipTap version the editor was built with.

**Upgrade notes**

- No database migrations.
