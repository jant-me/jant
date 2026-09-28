---
"@jant/core": minor
"create-jant": minor
---

A post's theme hooks mark each part once. `data-post-media` wraps the attachments once; the gallery row inside it, which also carried it, has its own internal attribute. A quote's quoted text gets `data-post-quote`, so it can be styled apart from the commentary, which is `data-post-body`. The theming reference describes `data-post-meta` as the date and the collections, and `data-post-media` as every kind of attachment.

**Upgrade notes**

- No database migrations.
- A rule for `[data-post-media] [data-post-media]`, or one that relied on the inner element, should target `[data-post-media]` alone. The quote example in the theming reference used `[data-format="quote"] [data-post-body]`, which styled the commentary; use `[data-post-quote]` for the quoted text.
