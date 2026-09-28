---
"@jant/core": patch
"create-jant": patch
---

A feed's display text, such as "▶ Watch video" and "2 more posts", comes from the same translations as the site's reader pages, so the feed and the page beside it say the same thing. The feed reference now calls it display text that can change, and points a consumer at `hidden` on `<jant:thread>` to write its own.

**Upgrade notes**

- No database migrations.
- A consumer that matched the English text of these labels should read `hidden` and the media attributes instead.
