---
"@jant/core": minor
"create-jant": minor
---

Collection and Smart Collection pages link to their rating order as `?sort=rating`, one word like every other value in a public address. Writing and organizing now lists every archive query parameter and value, and the older spellings the archive still reads.

**Upgrade notes**

- No database migrations.
- Links with `?sort=rating_desc` still open the rating order. The API keeps `rating_desc` as the `sortOrder` value.
