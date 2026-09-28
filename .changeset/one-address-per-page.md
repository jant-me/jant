---
"@jant/core": minor
"create-jant": minor
---

A post, a collection, and a smart collection each answer at one address and redirect every other way in there with a 301: the same address in different letter case, the slug once a custom URL exists, and a custom URL added after the first. The first custom URL is the address, as feeds, the sitemap, and the export already named it; the post page used to redirect a slug to the newest one instead.

**Upgrade notes**

- No database migrations.
- If a post or collection has more than one custom URL, its page now lives at the oldest one, where its feed entry and sitemap entry already pointed. Delete the older custom URL to make a newer one the address.
