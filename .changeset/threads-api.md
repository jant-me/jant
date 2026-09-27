---
"@jant/core": minor
"create-jant": minor
---

Threads become an API resource: list them, read one whole, and page through its posts, with the homepage's fold on request. Every post says how big its Thread is.

**New**

- `GET /api/public/threads` lists Threads. Unfiltered it lists what the homepage lists, and it takes the archive's filters plus `sort` (`activity`, `published`, `updated`, `oldest`, `rating`) and `visibility=any` for Threads hidden from Latest. `GET /api/threads` is the author's version, with every status and visibility.
- `GET /api/public/threads/:slug` and `GET /api/threads/:id` return the Thread of any post in it. `GET …/posts` pages through its posts in Thread order.
- `include=fold` adds the replies the homepage shows under each Thread, how many it leaves out, and the first one left out.
- Every post response carries `threadPostCount`: the published posts in its Thread, root included.
- MCP: `jant_threads_list`, `jant_threads_get`, `jant_threads_list_posts`.

**Upgrade notes**

- No database migrations.
- `GET /api/posts` and `jant_posts_list` order published posts by `publishedAt`, newest first. They used to put pinned posts first and order the rest by Thread activity, so a reply lifted an old root past a walk's cursor. Drafts keep their last-edited order.
- The `GET /api/public/posts` list and `GET /api/public/archive` are deprecated and will be removed in 1.0.1. Use `GET /api/public/threads`, and for the archive `GET /api/public/threads?visibility=any&sort=published`. Both answer as before until then, with `Deprecation` and `Link: rel="successor-version"` headers. `GET /api/public/posts/:slug` stays.
