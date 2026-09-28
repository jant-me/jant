---
"@jant/core": patch
"create-jant": patch
---

A folded Thread's "N more posts" link on the homepage and other list pages opens the first post it hides, as the feed's gap already did. It opened the newest post, which is already on screen.

**Upgrade notes**

- No database migrations.
