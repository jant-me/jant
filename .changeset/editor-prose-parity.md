---
"@jant/core": patch
---

The editor sets a draft the way the post is read. Inline code had no visible background in the composer, and headings, lists, quotes, code blocks, rules, tables and images were each a little off from the published post; the editor now uses the post body's own styles. In dark mode, quotes and code blocks keep their fill on the composer's raised background.

**Upgrade notes**

- No database migrations.
