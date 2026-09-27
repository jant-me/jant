---
"@jant/core": minor
"create-jant": minor
---

Every author API response is built from a fixed list of fields, the one `docs/API.md` shows, instead of the database row. A column added to Jant no longer turns up in the API on its own, and responses stop carrying the owning site and storage details.

**Upgrade notes**

- No database migrations.
- `siteId` is gone from posts, media, collections, smart collections, collection directory items, and navigation items. A response always comes from the site you asked.
- Posts in the author API no longer carry `previewImageKey`, `previewKind`, `previewProvider`, or `translationGroupId`; public posts no longer carry `translationGroupId`. The translation endpoints list a post's other versions.
- Media responses no longer carry `filename`, `provider`, or `position`. `originalName` is the file's name as uploaded, and a post's `attachments` array gives the order.
- `jant_collections_list` returns the same `collections`, `smartCollections`, and `directoryItems` as `GET /api/collections`, without the extra `items`.
- Now documented, unchanged: `language` and `displayTitle` on posts, `description` on directory items, and `placement` and `targetTitle` on navigation items, which `POST` and `PUT /api/nav-items` also accept as `placement`.
