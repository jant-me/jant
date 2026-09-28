---
"@jant/core": minor
"create-jant": minor
---

A site export no longer writes where the source site stored each file. The `provider`, `storage_key`, and `poster_key` fields are gone from every `media` entry; neither the bundled theme nor `jant site import` read them. The file reference now marks as theme only the fields import never reads: a post's `summary_text`, a media entry's `id`, the `title` inside a post's `collections` and inside `directory` entries, and `favicon_version`.

**Upgrade notes**

- No database migrations.
- A Hugo template of your own that read `provider`, `storage_key`, or `poster_key` gets nothing. Use `src` and `poster`.
