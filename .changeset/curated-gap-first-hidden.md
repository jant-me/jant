---
"@jant/core": patch
"create-jant": patch
---

On the Featured page, an "N hidden posts" link opens the first post it hides, as the homepage's "N more posts" link and the feed's gap do. It opened the post just below it, which is already on screen. In the Hugo export, the Featured page's gap links opened the Thread's root; they now open the first hidden post too.

**Upgrade notes**

- No database migrations.
- The Hugo `featured-thread.html` partial links each gap to the first post it hides. A copy of the partial in your own theme keeps linking to the root until you update it.
- `TimelineItemView["curatedThread"]["segments"]` entries have a `gapHref`, `null` when nothing is hidden.
