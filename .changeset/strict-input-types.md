---
"@jant/core": minor
"create-jant": minor
---

Post fields take one type each, as the API reference documents: `pinnedAt` and `featuredAt` are Unix seconds or `null`, `rating` is a number, `pinned` is a boolean, and `collectionIds` is an array. The API used to also accept ISO 8601 strings for the timestamps, `"3"` for a rating, `"on"` for `pinned`, and `""` for `collectionIds`, left over from HTML forms.

**Upgrade notes**

- No database migrations.
- Send `pinnedAt` and `featuredAt` as Unix seconds, and `rating` as a number. The other spellings answer `400`.
