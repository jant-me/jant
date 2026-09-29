---
"@jant/core": minor
"create-jant": minor
---

`/latest/feed?format=note` names itself with the filter: its `rel="self"` link, its feed `<id>`, and its links to the same feed in other languages keep `?format=note`, as the archive feed's do. They pointed at the unfiltered feed, so a reader that follows `rel="self"` switched feeds.

**Upgrade notes**

- No database migrations.
- A subscription to a filtered latest feed gets a new feed `<id>`; some readers show it as a new feed.
