---
"@jant/core": patch
"create-jant": patch
---

The compatibility page says where the promise stops: undocumented endpoints and fields aren't covered, the maintenance commands run from the server's version, a snapshot restores into the kind of database it came from, and the defaults of `PUBLIC_API_ENABLED`, `MAIN_RSS_FEED`, `RSS_FEEDS_ENABLED`, and `CORS_ORIGINS` change only in a major release. The API reference documents `PUT /api/settings/import` and the post fields `jant site import` sends: `pinnedAt`, `featuredAt`, `quietReply`, and `collectionEntries`.
