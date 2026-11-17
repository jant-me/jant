---
"@jant/core": minor
---

A post can be Unlisted: anyone with its link can read it, and the site lists it nowhere — not on Latest, in the archive, in search, in a feed, in the sitemap, or on a Collection page — and the page asks search engines not to index it. It sits between Hidden from Latest and Private in **Publish settings** and in a post's **Visibility** menu. Switching it to Private turns the link off, and changing its Custom link retires the old address. Signed in, you still see it everywhere, including in the Collections it belongs to. The hint under Hidden from Latest now says it still appears in the archive and search.

**Upgrade notes**

- No database migrations.
- The HTTP API and MCP accept and return `unlisted` wherever they take a post's `visibility`. `/api/threads` and the archive take `visibility=unlisted` for the signed-in author; `/api/public/threads` answers `400` to it, as it does to `private`.
- The site export format is now version 3. An Unlisted post exports with `visibility: unlisted`, and an older Jant refuses to import a newer export instead of publishing those posts as Public.
- Theme hooks: `data-post-visibility` can be `unlisted`, and a post card carries a `.post-status-unlisted` badge that readers see too.
- The bundled Hugo templates leave Unlisted Threads out of every list, feed, and the sitemap, and mark their pages `noindex`.
