---
"@jant/core": patch
"create-jant": patch
---

The API reference, the feed handout, and Compatibility say that a field with a fixed set of values, such as a post's `format` or an error's `code`, can gain a value in a minor release: read an unknown `format` as `note`, and handle an unknown `code` by the HTTP status.

**Upgrade notes**

- No database migrations.
