# Jant API Reference

Jant exposes a compact HTTP API for automations, content migration, settings tooling, and hosted control-plane operations.

- Base URL: `https://your-site.com`
- Default format: JSON
- Timestamps: Unix seconds
- Auth: session cookies, Bearer API tokens, or an internal admin token for `/api/internal/*`

For static export and round-trip import, also see [Export and Import](export-and-import.md). For backup planning, see [Backups](backups.md).

`/api/auth/*` is handled by better-auth and is primarily intended for browser auth flows, so it is not covered here.

---

## API Surface

| Area                    | Base path                | Auth                 |
| ----------------------- | ------------------------ | -------------------- |
| Public posts            | `/api/public/posts`      | Public when enabled  |
| Public Threads          | `/api/public/threads`    | Public when enabled  |
| Discover post status    | `/api/discover/posts`    | Public               |
| Posts                   | `/api/posts`             | API token or session |
| Threads                 | `/api/threads`           | API token or session |
| Upload sessions         | `/api/uploads`           | API token or session |
| One-shot upload         | `/api/upload`            | API token or session |
| Media                   | `/api/media`             | API token or session |
| Text attachment content | `/api/attachments`       | API token or session |
| MCP                     | `/api/mcp`               | API token or session |
| Collections             | `/api/collections`       | API token or session |
| Smart collections       | `/api/smart-collections` | API token or session |
| Navigation items        | `/api/nav-items`         | API token or session |
| Custom URLs             | `/api/custom-urls`       | API token or session |
| Settings                | `/api/settings`          | API token or session |
| Search                  | `/api/search`            | API token or session |
| Export                  | `/api/export`            | API token or session |
| GitHub webhooks         | `/api/github-sync`       | GitHub signature     |
| Telegram webhook        | `/api/telegram`          | Telegram secret      |
| Internal admin          | `/api/internal/*`        | Internal admin token |

Auth labels in this document:

- `Public`: no auth required
- `Public when enabled`: public by default; returns `404` to every caller when `PUBLIC_API_ENABLED=false`
- `Session or token`: browser session cookie or `Authorization: Bearer <token>`
- `Internal admin token`: `Authorization: Bearer <INTERNAL_ADMIN_TOKEN>`
- `GitHub signature`: an `X-Hub-Signature-256` header GitHub computes with the webhook secret; see [GitHub webhooks](#github-webhooks)
- `Telegram secret`: an `X-Telegram-Bot-Api-Secret-Token` header carrying the secret the webhook was registered with; see [Telegram webhook](#telegram-webhook)

---

## Authentication

### API tokens

For scripts and integrations, create an API token from Settings:

1. Sign in to Jant.
2. Open `Settings -> API Tokens`.
3. Create a token and copy it immediately.

Use it as a Bearer token:

```bash
curl https://your-site.com/api/posts \
  -H "Authorization: Bearer jnt_YOUR_TOKEN"
```

API tokens grant the same API access as an authenticated browser session for the current site.

### Session cookies

Browser requests can use the normal session cookie after signing in at `/signin`.

### Local development token

When `DEV_API_TOKEN` is configured, Jant also accepts it as a Bearer token for requests to a local host that come from the same machine. The host must be one of:

- `localhost`
- `127.0.0.1`
- `::1`
- `*.localtest.me`

This is meant for local tooling, not production clients.

### Internal admin token

`/api/internal/*` endpoints only accept the environment-provided `INTERNAL_ADMIN_TOKEN`.

If that token is not configured, those endpoints behave as if they do not exist and return `404`.

---

## Automation Entry Points

Jant exposes the site-owner automation surface two ways:

- HTTP JSON endpoints under `/api/*`
- an authenticated MCP endpoint at `/api/mcp`

Projects created with `create-jant` also include `examples/agent-content-automation/README.md`, which shows copy-pasteable HTTP and MCP flows for posts, media, and settings.

Auth resolution for both surfaces:

- pass `Authorization: Bearer jnt_...` (issued under Settings → API Tokens), or
- on local hosts, send the same value with `DEV_API_TOKEN` from `.dev.vars`.
- the public posts and Threads endpoints under `/api/public/*` work without a token while `PUBLIC_API_ENABLED=true`.
- `GET /api/discover/posts` works without a token while the site is listed in Discover, independent of `PUBLIC_API_ENABLED`.

### MCP

Base path: `/api/mcp`

Auth: `Session or token`

Jant's MCP endpoint is a minimal HTTP JSON-RPC transport for remote agents and automation systems that already speak MCP.

Current transport behavior:

- `POST` only
- content type `application/json`
- takes `MCP-Protocol-Version: 2025-06-18`; a request without it is read as that version, and any other version answers `400`. A later minor release can accept newer protocol versions as well; one is dropped only in a major release
- supports `initialize`, `ping`, `tools/list`, `tools/call`, and `notifications/initialized`
- does not support batch requests, SSE streaming, or session negotiation

Current tool groups:

- posts: `jant_posts_list`, `jant_posts_get`, `jant_posts_search`, `jant_posts_create`, `jant_posts_update`, `jant_posts_delete`
- threads: `jant_threads_list`, `jant_threads_get`, `jant_threads_list_posts`
- media: `jant_media_list`, `jant_media_get`, `jant_media_upload`, `jant_media_update`, `jant_media_delete`
- attachments: `jant_attachments_get_content`
- collections: `jant_collections_list`, `jant_collections_get`, `jant_collections_create`, `jant_collections_update`, `jant_collections_delete`, `jant_collections_add_thread`, `jant_collections_remove_thread`
- settings: `jant_settings_get`, `jant_settings_update`

Tool calls return normal MCP `result` envelopes. Successful tool calls include both `structuredContent` and a JSON string copy in `content[0].text`, and a tool returns the objects its HTTP endpoint does. A failed call returns `200 OK` with `isError: true`; its `structuredContent` has the [HTTP error shape](#error-format), `{ error, code }` with `details` for a validation error, and `content[0].text` repeats the message.

`jant_posts_search` takes `q` and `limit`, searches as `GET /api/search` does, and returns the same result objects.

`jant_posts_list`, `jant_threads_list`, and `jant_threads_list_posts` take `cursor` and return `nextCursor` as `GET /api/posts`, `GET /api/threads`, and `GET /api/threads/:id/posts` do; see [Pagination](#pagination). `jant_threads_list` takes the same filters as `GET /api/threads`, and `fold: true` in place of `include=fold`. The tools that return posts take `content: "markdown"` as their endpoints take `content=markdown`.

Initialize:

```bash
curl -X POST https://your-site.com/api/mcp \
  -H "Authorization: Bearer jnt_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
```

Create a post through `tools/call`:

```bash
curl -X POST https://your-site.com/api/mcp \
  -H "Authorization: Bearer jnt_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"jant_posts_create","arguments":{"format":"note","bodyMarkdown":"Created through MCP.","status":"published","visibility":"public"}}}'
```

---

## Conventions

### JSON and timestamps

Unless an endpoint explicitly returns a ZIP, XML, or plain text response, it returns JSON.

A request field or query parameter an endpoint doesn't know is ignored, so a client that sends one works against an older Jant too. A value an endpoint can't read, in a field it does know, answers `400`. A list's `limit` past either end of its range reads as that end: `limit=500` on a list of at most `100` returns `100`.

A field that takes one of a fixed set of values, such as `format`, `status`, `visibility`, or an error's `code`, can gain a value in a minor release. Read a `format` you don't recognize as `note`, and handle a `code` you don't recognize by the HTTP status.

All timestamps are Unix seconds:

```json
{
  "createdAt": 1706000000
}
```

### IDs

Jant uses TypeIDs everywhere.

| Resource                  | Prefix | Example                          |
| ------------------------- | ------ | -------------------------------- |
| Post                      | `pst_` | `pst_01jpyx3m7gw4w3h7m4bknq0v1d` |
| Media / attachment        | `med_` | `med_01jpyx4g9m8b4y50a4gx3t7p1n` |
| Upload session            | `upl_` | `upl_01jpyx9h0m8w4g5q1c7d2f3r4s` |
| Collection                | `col_` | `col_01jpyx5qds8y79w2dd6sv4rznj` |
| Smart collection          | `smc_` | `smc_01jpyxd4k2m8w5q9r3t7v1b6nc` |
| Custom URL / path record  | `pth_` | `pth_01jpyxb27t6m4v9r2k8s5c1qfh` |
| Collection directory item | `cdi_` | `cdi_01jpyx8r7s3v8m1q5c9k2f6gth` |
| Nav item                  | `nav_` | `nav_01jpyxcv3m7w4b8k2r5s9t1qfh` |

Invalid IDs return `400`.

### Pagination

The post list (`GET /api/posts`), the Thread lists (`GET /api/threads`, `GET /api/public/threads`), a Thread's posts (`GET /api/threads/:id/posts`, `GET /api/public/threads/:slug/posts`), the media list (`GET /api/media`), the custom URL list (`GET /api/custom-urls`), and the `jant_posts_list`, `jant_threads_list`, `jant_threads_list_posts`, and `jant_media_list` MCP tools return one page and a `nextCursor`. Repeat the request with `cursor` set to `nextCursor` for the next page. `nextCursor` is `null` on the last page.

- `nextCursor` is opaque: pass it back unchanged. Its format is not part of the API.
- A post that exists for the whole walk and keeps its place in the order is returned exactly once, whatever else is published, edited, or deleted between requests. A post that moves during the walk, because its publish date is edited or a reply moves its Thread up, can be skipped or returned twice. To walk everything, use an order a reply doesn't move: `GET /api/posts`, or `sort=published` on a Thread list.
- A page can hold fewer posts than `limit` and still have a `nextCursor`. The walk ends when `nextCursor` is `null`.
- A `cursor` that can't be read, or that comes from a list in a different order, returns `400`.

The other lists, collections (`GET /api/collections`), smart collections (`GET /api/smart-collections`), navigation items (`GET /api/nav-items`), and a post's other versions, return every item in one response. If one of them gains pages in a later release, a request that doesn't ask for a page still gets all of it.

### Slugs, paths, and aliases

- Post and collection `slug` values are lowercase `a-z`, `0-9`, and `-`.
- Post `path` is a create-time convenience field, not a general path-management API.
- If a post `path` is itself a valid slug, Jant uses it as the canonical slug.
- If a post `path` is not a valid slug, Jant slugifies it for the canonical URL and stores the original path as an alias.
- Custom URL `path` carries a leading slash in responses, and so does `toPath` when it names a path on the site. A request may leave it off `path`.

### Body formats

Posts accept content in one of two mutually exclusive fields:

- `bodyMarkdown`: recommended for scripts and migrations
- `body`: a TipTap JSON string, mainly for editor integrations

Jant renders stored content into:

- `bodyHtml`
- `bodyText`

Markdown support includes headings, lists, links, images, tables, fenced code blocks, blockquotes, and `<!--more-->` excerpt breaks.

Line breaks follow standard Markdown rules:

- A single newline stays within the same paragraph.
- A blank line starts a new paragraph.
- Use two trailing spaces or a backslash before the newline to create a hard line break.

### Quote post field mapping

Quote posts use quote-specific names in the API:

- Send `sourceName` and `sourceUrl` in requests.
- Quote responses return `sourceName` and `sourceUrl`.
- Quote responses do not expose `title` or `url`.

---

## Error Format

Every error uses this shape:

```json
{
  "error": "Human-readable message",
  "code": "VALIDATION_ERROR",
  "details": {}
}
```

- `details` is present for validation errors that carry structured field information. Its shape can change in any release, and so can the wording of `error`: show them to a person or log them, and branch on `code`. The one documented part of `details` is the settings endpoint's `rejectedKeys`.
- `code` is always present, an error the server didn't expect included (`INTERNAL_ERROR`). An unknown `/api` path answers `NOT_FOUND` in this shape too.

Common error codes:

| Code                     | HTTP  | Meaning                                                             |
| ------------------------ | ----- | ------------------------------------------------------------------- |
| `VALIDATION_ERROR`       | `400` | Invalid input, invalid ID, unsupported field combination            |
| `UNAUTHORIZED`           | `401` | Missing or invalid auth                                             |
| `FORBIDDEN`              | `403` | Authenticated but not allowed                                       |
| `NOT_FOUND`              | `404` | Resource does not exist                                             |
| `CONFLICT`               | `409` | Duplicate slug/path, invalid state transition, hosted-mode conflict |
| `MEDIA_QUOTA_EXCEEDED`   | `409` | Hosted media quota would be exceeded                                |
| `LANGUAGE_IN_USE`        | `409` | The language still has posts, so it can't be removed                |
| `CONFIGURATION_ERROR`    | `500` | Missing or invalid server configuration                             |
| `EXTERNAL_SERVICE_ERROR` | `500` | External dependency failed                                          |
| `INTERNAL_ERROR`         | `500` | An error the server didn't expect; the server log has the details   |
| `SITE_UNAVAILABLE`       | `503` | The hosted site is suspended                                        |

Example validation error:

```json
{
  "error": "Provide either body or bodyMarkdown, not both",
  "code": "VALIDATION_ERROR",
  "details": {
    "formErrors": [],
    "fieldErrors": {
      "bodyMarkdown": ["Provide either body or bodyMarkdown, not both"]
    }
  }
}
```

---

## Posts

Base path: `/api/posts`

Jant supports three post formats:

| Format  | Purpose          | Required fields |
| ------- | ---------------- | --------------- |
| `note`  | Original writing | none            |
| `link`  | Shared reference | `title`, `url`  |
| `quote` | Quoted text      | `quoteText`     |

Post responses include these fields:

| Field             | Type                                     | Notes                                                                                                                                    |
| ----------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | `pst_*` string                           | Post ID                                                                                                                                  |
| `format`          | `note` \| `link` \| `quote`              | Post format                                                                                                                              |
| `status`          | `draft` \| `published`                   | Stored post status                                                                                                                       |
| `visibility`      | `public` \| `latest_hidden` \| `private` | Resolved visibility shown to clients                                                                                                     |
| `pinnedAt`        | integer \| `null`                        | Pin timestamp                                                                                                                            |
| `featuredAt`      | integer \| `null`                        | Feature timestamp                                                                                                                        |
| `slug`            | string                                   | Canonical slug                                                                                                                           |
| `title`           | string \| `null`                         | Returned for non-quote responses; omitted for `quote`                                                                                    |
| `url`             | string \| `null`                         | Returned for non-quote responses; usually `null` on notes                                                                                |
| `sourceName`      | string \| `null`                         | Returned instead of `title` for `quote`                                                                                                  |
| `sourceUrl`       | string \| `null`                         | Returned instead of `url` for `quote`                                                                                                    |
| `displayTitle`    | string                                   | Short plain-text name: the title, or one derived from the content when there is none. Use it where the post is referenced from elsewhere |
| `body`            | string \| `null`                         | Raw TipTap JSON string when stored that way; omitted when `content=markdown`                                                             |
| `bodyHtml`        | string \| `null`                         | Rendered HTML; omitted when `content=markdown`                                                                                           |
| `bodyText`        | string \| `null`                         | Plain-text rendering; omitted when `content=markdown`                                                                                    |
| `bodyMarkdown`    | string \| `null`                         | Markdown source; only returned when `content=markdown`                                                                                   |
| `quoteText`       | string \| `null`                         | Quote content                                                                                                                            |
| `summary`         | string \| `null`                         | Optional summary                                                                                                                         |
| `rating`          | integer \| `null`                        | `1` to `5` when set                                                                                                                      |
| `replyToId`       | `pst_*` string \| `null`                 | Parent reply/post ID                                                                                                                     |
| `threadId`        | `pst_*` string                           | Thread root ID                                                                                                                           |
| `language`        | string \| `null`                         | BCP 47 content language, the same for every post in a Thread; `null` until the site first turns on multilingual content                  |
| `quietReply`      | boolean                                  | Reply published without announcing its Thread                                                                                            |
| `publishedAt`     | integer \| `null`                        | Publish timestamp                                                                                                                        |
| `lastActivityAt`  | integer                                  | Newest post in the Thread, excluding quiet replies                                                                                       |
| `threadUpdatedAt` | integer                                  | Newest post in the Thread, including quiet replies                                                                                       |
| `threadPostCount` | integer                                  | Published posts in the Thread, root included; `1` alone                                                                                  |
| `createdAt`       | integer                                  | Unix seconds                                                                                                                             |
| `updatedAt`       | integer                                  | Unix seconds — last row write, including edits                                                                                           |
| `attachments`     | array                                    | Ordered media/text attachment objects                                                                                                    |
| `collectionIds`   | `col_*` string[]                         | Shared Thread Collections; only in `GET /api/posts/:id`                                                                                  |

### Post response shape

The post list and detail endpoints return the same core fields. `GET /api/posts/:id` additionally includes the shared Thread-level `collectionIds`; Root and Child responses return the same set.

Example:

```json
{
  "id": "pst_01jpyx3m7gw4w3h7m4bknq0v1d",
  "format": "note",
  "status": "published",
  "visibility": "public",
  "pinnedAt": null,
  "featuredAt": null,
  "slug": "hello-world",
  "title": "Hello World",
  "displayTitle": "Hello World",
  "body": null,
  "bodyHtml": "<p>Hello world</p>",
  "bodyText": "Hello world",
  "quoteText": null,
  "summary": null,
  "rating": null,
  "replyToId": null,
  "threadId": "pst_01jpyx3m7gw4w3h7m4bknq0v1d",
  "language": "en",
  "quietReply": false,
  "publishedAt": 1706000000,
  "lastActivityAt": 1706000000,
  "threadUpdatedAt": 1706000000,
  "threadPostCount": 1,
  "createdAt": 1706000000,
  "updatedAt": 1706000000,
  "attachments": []
}
```

Notes:

- Quote posts replace `title` and `url` with `sourceName` and `sourceUrl`.
- Quote responses omit `title` and `url` instead of returning them as `null`.
- `replyToId !== null` means the post is a thread reply.
- `threadId` points at the thread root.
- `threadPostCount` above `1` means the post belongs to a Thread; [Threads](#threads) returns the rest of it. It is `0` while nothing in the Thread is published.
- `GET /api/posts` includes both root posts and replies. There is currently no `excludeReplies` query parameter.

### List posts

`GET /api/posts`

Auth: `Session or token`

Query parameters:

| Parameter | Type                        | Required | Default     | Notes                                                               |
| --------- | --------------------------- | -------- | ----------- | ------------------------------------------------------------------- |
| `format`  | `note` \| `link` \| `quote` | no       | all         | Format filter                                                       |
| `status`  | `draft` \| `published`      | no       | `published` | Status filter                                                       |
| `cursor`  | string                      | no       | none        | Pass the previous `nextCursor` back unchanged                       |
| `limit`   | integer                     | no       | `100`       | `1` to `100`                                                        |
| `content` | `markdown`                  | no       | none        | Return `bodyMarkdown` instead of `body`, `bodyHtml`, and `bodyText` |

Response:

```json
{
  "posts": [
    {
      "id": "pst_01jpyx3m7gw4w3h7m4bknq0v1d",
      "format": "note",
      "status": "published",
      "visibility": "public",
      "slug": "hello-world",
      "title": "Hello World",
      "bodyHtml": "<p>Hello world</p>",
      "bodyText": "Hello world",
      "quoteText": null,
      "replyToId": null,
      "threadId": "pst_01jpyx3m7gw4w3h7m4bknq0v1d",
      "publishedAt": 1706000000,
      "createdAt": 1706000000,
      "updatedAt": 1706000000,
      "attachments": []
    }
  ],
  "nextCursor": "eyJ2IjoxLCJzIjoibmV3ZXN0OnB1Ymxpc2hlZDp1bnBpbm5lZCIsImsiOlsxNzA2MDAwMDAwLCJwc3RfMDFqcHl4M203Z3c0dzNoN200YmtucTB2MWQiXX0"
}
```

Notes:

- Each item uses the post response fields above, except list responses omit `collectionIds`.
- Roots and replies are listed alike, one post per item. [Threads](#threads) lists them grouped.
- Published posts are ordered by `publishedAt`, newest first, with `id` breaking ties. Pinned posts are not moved to the top, and a reply does not move its root. Drafts are ordered by `updatedAt`, last edited first.
- Paging follows [Pagination](#pagination).

### Suggest or validate a slug

`GET /api/posts/slug`

Auth: `Session or token`

Query parameters:

| Parameter | Type           | Required | Notes                                                |
| --------- | -------------- | -------- | ---------------------------------------------------- |
| `mode`    | `suggest`      | yes      | Suggest a slug from `title`                          |
| `title`   | string         | suggest  | Source title used for slug suggestion                |
| `postId`  | `pst_*` string | no       | Exclude the current post when suggesting or checking |
| `mode`    | `check`        | yes      | Check whether a specific slug is available           |
| `slug`    | string         | check    | Lowercase slug candidate to validate and check       |

Modes:

- Suggest from a title:

```text
GET /api/posts/slug?mode=suggest&title=Hello%20World
```

Response:

```json
{ "slug": "hello-world" }
```

- Check availability:

```text
GET /api/posts/slug?mode=check&slug=hello-world
```

Response:

```json
{
  "slug": "hello-world",
  "available": true
}
```

When editing an existing post, pass `postId` so the current slug counts as available:

```text
GET /api/posts/slug?mode=check&slug=hello-world&postId=pst_...
```

Invalid slug candidates return `400`, including reserved slugs and slugs with invalid characters.

### Get a single post

`GET /api/posts/:id`

Auth: `Session or token`

This returns the full post plus shared Thread-level `collectionIds`, ordered `attachments`, and `threadPosition`: the post's place in its Thread, `1` for the root. `jant_posts_get` returns the same.

`content=markdown` returns the body as `bodyMarkdown` in place of `body`, `bodyHtml`, and `bodyText`. To edit a body, read it this way and send the edited Markdown back as `bodyMarkdown`.

Example:

```json
{
  "id": "pst_01jpyx3m7gw4w3h7m4bknq0v1d",
  "format": "note",
  "collectionIds": ["col_01jpyx5qds8y79w2dd6sv4rznj"],
  "threadPosition": 1,
  "attachments": [],
  "slug": "hello-world",
  "title": "Hello World",
  "bodyHtml": "<p>Hello world</p>",
  "bodyText": "Hello world"
}
```

### Create a post

`POST /api/posts`

Auth: `Session or token`

Request body:

```json
{
  "format": "quote",
  "quoteText": "What stands in the way becomes the way.",
  "sourceName": "Marcus Aurelius",
  "sourceUrl": "https://example.com/meditations",
  "bodyMarkdown": "Still one of the clearest lines in the book.",
  "status": "published",
  "visibility": "public",
  "publishedAt": 1706000000,
  "slug": "from-marcus-aurelius",
  "collectionIds": ["col_01jpyx5qds8y79w2dd6sv4rznj"],
  "attachments": [
    { "type": "media", "mediaId": "med_01jpyx4g9m8b4y50a4gx3t7p1n" },
    {
      "type": "text",
      "contentFormat": "markdown",
      "content": "# Attached note\n\nExtra context here."
    }
  ]
}
```

Fields:

| Field               | Type                                     | Required             | Default        | Notes                                                                                                                                  |
| ------------------- | ---------------------------------------- | -------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `format`            | `note` \| `link` \| `quote`              | yes                  | —              | Post format                                                                                                                            |
| `title`             | string                                   | required for `link`  | —              | Max `300`; not allowed for `quote`                                                                                                     |
| `sourceName`        | string                                   | no                   | `null`         | Quote attribution name, max `300`; only for `quote`                                                                                    |
| `body`              | string                                   | no                   | `null`         | TipTap JSON string; mutually exclusive with `bodyMarkdown`                                                                             |
| `bodyMarkdown`      | string                                   | no                   | `null`         | Recommended for scripts; mutually exclusive with `body`                                                                                |
| `slug`              | string                                   | no                   | auto-generated | Canonical slug; mutually exclusive with `path`                                                                                         |
| `path`              | string                                   | no                   | —              | Create-time address; starts with a letter or digit, then lowercase letters, numbers, `-`, `.`, and `/`; mutually exclusive with `slug` |
| `status`            | `draft` \| `published`                   | no                   | `published`    | Post status                                                                                                                            |
| `visibility`        | `public` \| `latest_hidden` \| `private` | no                   | `public`       | Post visibility                                                                                                                        |
| `pinned`            | boolean                                  | no                   | `false`        | Pin the post; not allowed on replies                                                                                                   |
| `featured`          | boolean                                  | no                   | `false`        | Mark as featured                                                                                                                       |
| `pinnedAt`          | integer \| `null`                        | no                   | —              | Pin at this time instead of now; wins over `pinned`. For restores                                                                      |
| `featuredAt`        | integer \| `null`                        | no                   | —              | Feature at this time instead of now; wins over `featured`. For restores                                                                |
| `url`               | absolute URL                             | required for `link`  | —              | Allows `http:`, `https:`, or `mailto:`; not allowed for `note` or `quote`                                                              |
| `sourceUrl`         | absolute URL                             | no                   | `null`         | Quote attribution URL; not allowed for non-quote                                                                                       |
| `quoteText`         | string                                   | required for `quote` | —              | Not allowed for `note` or `link`                                                                                                       |
| `rating`            | integer                                  | no                   | `null`         | `1` to `5`; send `0` to clear on update                                                                                                |
| `collectionIds`     | `col_*` string[]                         | no                   | `[]`           | Shared Thread Collection TypeIDs; max `20`                                                                                             |
| `collectionEntries` | object[]                                 | no                   | —              | Collection memberships with their own times; wins over `collectionIds`. For restores                                                   |
| `replyToId`         | `pst_*` string                           | no                   | `null`         | Make this post a thread reply                                                                                                          |
| `quietReply`        | boolean                                  | no                   | `false`        | Publish a reply without announcing its Thread on Latest                                                                                |
| `language`          | BCP 47 tag                               | no                   | detected       | Content language, e.g. `en`, `zh-Hans`; replies inherit the Thread's                                                                   |
| `translationOfId`   | `pst_*` string                           | no                   | `null`         | Link the new post into that post's translation group                                                                                   |
| `publishedAt`       | integer                                  | no                   | current time   | Unix seconds; only valid when `status` is `published`                                                                                  |
| `createdAt`         | integer                                  | no                   | current time   | Unix seconds; restores a moved post's creation time                                                                                    |
| `updatedAt`         | integer                                  | no                   | `createdAt`    | Unix seconds; restores a moved post's last edit time                                                                                   |
| `attachments`       | attachment[]                             | no                   | `[]`           | Ordered attachments, max `20`                                                                                                          |

Important rules:

- Use `body` or `bodyMarkdown`, not both.
- `body` must be a TipTap document (a `doc` node) as a JSON string. Anything else is a `400`.
- `createdAt` and `updatedAt` are for restores: an import or a migration that keeps a post's own times. Feeds report `updatedAt` as the entry's update time, and a Thread orders its replies by `createdAt`, then ID, after the root, which always comes first. Updates can't change either.
- Use `slug` or `path`, not both.
- `path` is only available on create. Post updates only support `slug`.
- Each `collectionEntries` item is `{ "collectionId": "col_…", "createdAt": 1706000000, "position": 0, "pinnedAt": null }`; all but `collectionId` are optional. It restores when a Thread joined each collection, its place in a hand-ordered one, and whether it's pinned there.
- `link` posts require `title` and `url`.
- `quote` posts require `quoteText` and must use `sourceName` / `sourceUrl` instead of `title` / `url`.
- `note` posts do not accept `url`, `quoteText`, `sourceName`, or `sourceUrl`.
- Replies cannot be pinned.
- Replies inherit thread visibility.
- Replies inherit the root status unless you explicitly create the reply as `draft`.
- Set `collectionIds` while creating a Thread root. Reply creation rejects non-empty Collection input; use the Thread Collection endpoints afterward, which accept either a Root or Child Post ID.

Path behavior:

- `path: "hello-world"` creates the post at `/hello-world`.
- `path: "2024/01/hello-world"` creates a slugified canonical URL such as `/2024-01-hello-world` and stores `/2024/01/hello-world` as an alias.

Response: `201 Created` with the full post object and ordered `attachments`.

### Attachments

Posts accept an ordered `attachments` array. Order in the request is the order shown on the post.

An uploaded media item belongs to one post. A `mediaId` already attached to another post answers `409` with `CONFLICT`; to show the same file in a second post, such as a translation, upload it again.

Input shapes:

- Media attachment:

```json
{ "type": "media", "mediaId": "med_...", "alt": "Optional alt text" }
```

- Text attachment:

```json
{
  "type": "text",
  "contentFormat": "markdown",
  "content": "# Heading",
  "summary": "Optional summary"
}
```

Fields:

| Field           | Type           | Required | Default | Notes                                  |
| --------------- | -------------- | -------- | ------- | -------------------------------------- |
| `type`          | `"media"`      | yes      | —       | Media attachment                       |
| `mediaId`       | `med_*` string | yes      | —       | Previously uploaded media ID           |
| `alt`           | string         | no       | `null`  | Alt text, max `500`                    |
| `type`          | `"text"`       | yes      | —       | Text attachment                        |
| `contentFormat` | `"markdown"`   | yes      | —       | Currently only `markdown` is supported |
| `content`       | string         | yes      | —       | Non-empty text content                 |
| `summary`       | string         | no       | `null`  | Optional summary, max `300`            |

Response shapes:

- Media attachment:

```json
{
  "type": "media",
  "id": "med_...",
  "url": "/media/med_....jpg",
  "previewUrl": "/media/med_....jpg",
  "posterUrl": null,
  "alt": null,
  "blurhash": null,
  "width": 800,
  "height": 600,
  "durationSeconds": null,
  "mimeType": "image/jpeg",
  "originalName": "photo.jpg",
  "size": 1024000,
  "summary": null,
  "chars": null
}
```

- Text attachment:

```json
{
  "type": "text",
  "id": "med_...",
  "url": "/media/med_....md",
  "contentFormat": "markdown",
  "contentUrl": "/api/attachments/med_.../content",
  "summary": "Attached note Extra context here.",
  "chars": 33
}
```

A text attachment's `url` is its Markdown source file. `contentUrl` returns the same source as JSON and needs a session or token, so [public posts](#public-posts) leave it out.

### Get text attachment content

`GET /api/attachments/:id/content`

Auth: `Session or token`

This only works for `type: "text"` attachments.

Response:

```json
{
  "id": "med_01jpyx7c0s7y5v2m4b8g1f9qkr",
  "type": "text",
  "contentFormat": "markdown",
  "content": "# Attached note\n\nExtra context here.",
  "summary": "Attached note Extra context here.",
  "chars": 33
}
```

### Update a post

`PUT /api/posts/:id`

Auth: `Session or token`

This is a partial update. Omitted fields stay unchanged.

Example:

```json
{
  "sourceName": "Epictetus",
  "sourceUrl": "https://example.com/discourses",
  "bodyMarkdown": "Updated commentary in **Markdown**."
}
```

Request body fields:

This endpoint accepts the same JSON fields as `POST /api/posts`, except the ones a post gets when it's created: `path`, `replyToId`, `quietReply`, `translationOfId`, `createdAt`, and `updatedAt`. It ignores those like any other field it doesn't know. All fields are optional. Additionally, update accepts `null` to clear `title`, `sourceName`, `body`, `bodyMarkdown`, `url`, `sourceUrl`, `quoteText`, and `rating`.

Attachment replacement rules:

- Omit `attachments`: keep existing attachments
- Send `"attachments": []`: remove all attachments
- Send a new `attachments` array: replace all attachments in that order

An attachment the update removes is deleted, file included.

Notes:

- To change a post's address, send `slug`, or add a custom URL through `/api/custom-urls`.
- The fields must suit the post's format, the one in the body or else its current one, with the same rules as create: a note takes no `url` or `sourceName`, and a quote uses `sourceName` and `sourceUrl`, not `title` and `url`. A field that doesn't answers `400`.
- To link a post as a translation, use the [translation](#language-and-translations) endpoints. A reply's place in its Thread is fixed when it's created.
- Thread replies reject direct `visibility` and `pinned` changes.
- Sending `collectionIds` from either a Root or Child update replaces the shared Thread Collection set.
- Draft updates cannot set `publishedAt`.
- To clear a rating, send `0`.

Response: `200 OK` with the updated post.

### Delete a post

`DELETE /api/posts/:id`

Auth: `Session or token`

Deletes the post and its attachments, files included. If the target is a thread root, its replies are deleted as part of the same operation.

Response:

```json
{ "success": true }
```

---

## Public posts

Base path: `/api/public/posts`

`GET /api/public/posts/:slug` returns one post in the public reading view, not
the editing view used in Settings; the Thread lists under `/api/public/threads`
carry their posts in the same shape. When `PUBLIC_API_ENABLED=false`, these
public endpoints return `404` to every caller. Authenticated clients can use
`/api/posts` instead.

Lists of public posts are Thread lists: `GET /api/public/threads`.

Public post responses include these fields:

| Field             | Type                        | Notes                                                                                                                   |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`              | `pst_*` string              | Post ID                                                                                                                 |
| `format`          | `note` \| `link` \| `quote` | Post format                                                                                                             |
| `status`          | `published`                 | Public endpoints only return published posts                                                                            |
| `visibility`      | `public` \| `latest_hidden` | `latest_hidden` comes from single-post reads, and from Thread lists that ask for it                                     |
| `slug`            | string                      | Canonical slug                                                                                                          |
| `permalink`       | string                      | The post's public path, including any site prefix: its first custom URL, or `/{slug}` without one                       |
| `title`           | string \| `null`            | Returned for `note` and `link` posts                                                                                    |
| `url`             | string \| `null`            | Returned for `link` posts                                                                                               |
| `sourceName`      | string \| `null`            | Returned instead of `title` for `quote`                                                                                 |
| `sourceUrl`       | string \| `null`            | Returned instead of `url` for `quote`                                                                                   |
| `bodyHtml`        | string \| `null`            | Rendered HTML; omitted when `content=markdown`                                                                          |
| `bodyText`        | string \| `null`            | Plain-text rendering; omitted when `content=markdown`                                                                   |
| `bodyMarkdown`    | string \| `null`            | Markdown source; only returned when `content=markdown`                                                                  |
| `quoteText`       | string \| `null`            | Quote content                                                                                                           |
| `summary`         | string \| `null`            | Optional summary                                                                                                        |
| `rating`          | integer \| `null`           | `1` to `5` when set                                                                                                     |
| `previewKind`     | string \| `null`            | Link preview kind                                                                                                       |
| `previewProvider` | string \| `null`            | Link preview provider                                                                                                   |
| `previewImageUrl` | string \| `null`            | Public preview image URL                                                                                                |
| `replyToId`       | `pst_*` string \| `null`    | Parent reply/post ID                                                                                                    |
| `threadId`        | `pst_*` string              | Thread root ID                                                                                                          |
| `language`        | string \| `null`            | BCP 47 content language, the same for every post in a Thread; `null` until the site first turns on multilingual content |
| `quietReply`      | boolean                     | Reply published without announcing its Thread. Always `false` on Thread roots                                           |
| `pinnedAt`        | integer \| `null`           | Pin timestamp                                                                                                           |
| `featuredAt`      | integer \| `null`           | Feature timestamp                                                                                                       |
| `publishedAt`     | integer \| `null`           | Publish timestamp                                                                                                       |
| `lastActivityAt`  | integer                     | Thread root: newest post in the Thread, **excluding** quiet replies. Editing a post never moves it                      |
| `threadUpdatedAt` | integer                     | Thread root: newest post in the Thread, **including** quiet replies. Editing a post never moves it                      |
| `threadPostCount` | integer                     | Published posts in the Thread, root included; `1` for a post on its own                                                 |
| `createdAt`       | integer                     | Unix seconds                                                                                                            |
| `updatedAt`       | integer                     | Unix seconds — when this row was last written, including edits                                                          |
| `attachments`     | array                       | Ordered media/text attachment objects                                                                                   |
| `collections`     | object[]                    | Public collection refs with `id`, `slug`, `title`, and `url`                                                            |

### Get a public post by slug

`GET /api/public/posts/:slug`

Auth: `Public when enabled`

This returns a single published public post by canonical slug.

Notes:

- `latest_hidden` posts remain readable by direct slug.
- Draft and private posts return `404`.
- `content=markdown` returns `bodyMarkdown` and omits `bodyHtml/bodyText`.

---

## Language and translations

These endpoints only matter on a site with [multilingual content](multilingual.md) turned on. Every post response carries `language`; the endpoints below list and link a post's other versions.

### Set a Thread's language

`PUT /api/posts/:id/language`

Auth: `Session or token`

Language is uniform inside a Thread, so this sets it on the root and every reply. Pass any post in the Thread.

```json
{ "language": "zh-Hans" }
```

Rejected with `409` when another post in the same translation group already holds that language.

Response: `200 OK` with `{ "success": true, "language": "zh-Hans" }`.

### List a post's other versions

`GET /api/posts/:id/translations`

Auth: `Session or token`

The Thread roots linked to this post as versions in other languages, excluding the post itself. Empty when it belongs to no translation group.

```json
{
  "translations": [
    {
      "id": "pst_01jpyx3m7gw4w3h7m4bknq0v1d",
      "slug": "hello-world",
      "title": "Hello World",
      "label": "Hello World",
      "language": "en"
    }
  ]
}
```

`label` is what to show in a list: the post's display title, falling back to its slug for untitled notes.

### Find linkable posts

`GET /api/posts/:id/translations/candidates`

Auth: `Session or token`

| Query   | Type    | Required | Default | Notes                                 |
| ------- | ------- | -------- | ------- | ------------------------------------- |
| `q`     | string  | yes      | —       | Substring of title or body, max `200` |
| `limit` | integer | no       | `8`     | `1` to `20`                           |

Returns published Thread roots this post could actually be linked to: written in a language its group does not already hold, and — when this post already belongs to a group — not in a group of their own. Newest first, as `{ "candidates": [...] }` with the same entries as the endpoint above.

### Look up a linkable post by address

`GET /api/posts/:id/translations/resolve`

Auth: `Session or token`

| Query | Type   | Required | Default | Notes                                         |
| ----- | ------ | -------- | ------- | --------------------------------------------- |
| `url` | string | yes      | —       | A path or a full URL on this site, max `2048` |

Answers the same question as the search above, about one address instead of a phrase. A full URL on any host the site answers on, a site path prefix, and a language prefix are all accepted — `/en/hello`, `/hello`, and `https://example.com/hello` name one post. Stored redirects are followed, and an address that lands on a reply names its Thread.

```json
{
  "resolution": {
    "kind": "ok",
    "address": "/hello-world",
    "candidate": {
      "id": "pst_01jpyx3m7gw4w3h7m4bknq0v1d",
      "slug": "hello-world",
      "label": "Hello World",
      "language": "en"
    }
  }
}
```

When the post cannot be linked, `kind` says why instead: `external` (another site), `not_found`, `not_a_post`, `same_thread`, `unpublished`, `no_language`, `same_language`, `language_taken`, `group_conflict`, or `group_language_taken`. The last two carry the `language` in the way. Eligibility is decided here, not by the caller — `POST /api/posts/:id/translations` applies the same rules.

### Link a version

`POST /api/posts/:id/translations`

Auth: `Session or token`

```json
{ "postId": "pst_01jpyx3m7gw4w3h7m4bknq0v1d" }
```

Joins the side without a group into the other's group, minting one when neither has any. Rejected with `409` when the two languages clash or when both sides already have a group — merging two groups would silently restructure both.

Response: `200 OK` with `{ "success": true }`.

### Unlink a version

`DELETE /api/posts/:id/translations`

Auth: `Session or token`

Removes this post from its translation group. The other members stay linked to each other.

Response: `200 OK` with `{ "success": true }`.

---

## Threads

Base paths: `/api/threads` and `/api/public/threads`

A Thread is a root post and its replies. It has no ID of its own: it uses its root's, which every post in it carries as `threadId`. The endpoints that read one Thread accept any of its posts.

`/api/threads` is the author's view: every status and visibility, with posts in the [editing view](#post-response-shape). `/api/public/threads` is the reader's: published Threads that aren't private, with posts in the [reading view](#public-posts). When `PUBLIC_API_ENABLED=false`, `/api/public/threads` returns `404` to every caller.

Thread responses include these fields:

| Field             | Type           | Notes                                               |
| ----------------- | -------------- | --------------------------------------------------- |
| `id`              | `pst_*` string | The root post's ID                                  |
| `postCount`       | integer        | Published posts in the Thread, root included        |
| `lastActivityAt`  | integer        | Newest post in the Thread, excluding quiet replies  |
| `threadUpdatedAt` | integer        | Newest post in the Thread, including quiet replies  |
| `root`            | object         | The root post                                       |
| `fold`            | object         | Only with `include=fold`; see [The fold](#the-fold) |

Example from `/api/public/threads?include=fold`:

```json
{
  "id": "pst_01jpyx3m7gw4w3h7m4bknq0v1d",
  "postCount": 9,
  "lastActivityAt": 1706700000,
  "threadUpdatedAt": 1706700000,
  "root": {
    "id": "pst_01jpyx3m7gw4w3h7m4bknq0v1d",
    "slug": "dialing-in",
    "permalink": "/dialing-in",
    "threadPostCount": 9
  },
  "fold": {
    "leading": [{ "id": "pst_01jpz0c7r4e7kqv3m8x2n5b6td" }, { "id": "…" }],
    "hidden": 3,
    "gap": {
      "id": "pst_01jpz2k9w1f8m5c7q3v6x4b2hn",
      "slug": "third-cup",
      "permalink": "/third-cup",
      "cursor": "eyJ2IjoxLCJzIjoidGhyZWFkIiwiayI6WzEsMTcwNjYwMDAwMCwicHN0XzAxanB6MGM3cjRlN2txdjNtOHgybjViNnRkIl19"
    },
    "trailing": [{ "id": "…" }, { "id": "…" }, { "id": "…" }]
  }
}
```

Posts in the example are cut to a few fields; each is a full post.

### The fold

`include=fold` adds the replies the homepage shows under a Thread: the earliest ones, then the latest ones with the newest last, and a count of the replies left out between them.

| Field      | Type             | Notes                                                                                                                        |
| ---------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `leading`  | post[]           | The earliest replies                                                                                                         |
| `hidden`   | integer          | Replies left out between `leading` and `trailing`                                                                            |
| `gap`      | object \| `null` | The first reply left out: `id`, `slug`, and `cursor`, plus `permalink` on `/api/public/threads`. `null` when `hidden` is `0` |
| `trailing` | post[]           | The latest replies, oldest first. The newest reply is the last one                                                           |

Notes:

- Which replies the fold keeps is the site's choice and can change. Read `hidden` rather than working it out: for a published Thread, `1 + leading.length + trailing.length + hidden` is `postCount`.
- A Thread without replies has an empty fold: `leading` and `trailing` are empty and `hidden` is `0`.
- To load the replies left out, list the Thread's posts from the gap on: `GET /api/public/threads/:slug/posts?cursor=<gap.cursor>&limit=<hidden>`. The cursor is opaque, as `nextCursor` is.

### List Threads

`GET /api/public/threads`

`GET /api/threads`

Auth: `Public when enabled` for `/api/public/threads`, `Session or token` for `/api/threads`

Unfiltered, `/api/public/threads` lists what the homepage lists: Threads hidden from Latest are left out, the newest activity comes first, and pinned Threads are on top. `/api/threads` lists every visibility. Both take [the archive's filters](writing-and-organizing.md#archive-filters).

Query parameters:

| Parameter    | Type                                                           | Required | Default     | Notes                                                                                                                                         |
| ------------ | -------------------------------------------------------------- | -------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `sort`       | `activity` \| `published` \| `updated` \| `oldest` \| `rating` | no       | `activity`  | See the orders below. A named collection changes the default                                                                                  |
| `visibility` | `public` \| `featured` \| `hidden` \| `any` \| `private`       | no       | see notes   | `hidden` is the URL spelling of `latest_hidden`, which is also read. `private` on `/api/threads` only                                         |
| `format`     | `note` \| `link` \| `quote`                                    | no       | all         | Format of the root                                                                                                                            |
| `collection` | string                                                         | no       | none        | Collection slug, or several comma-separated. A Thread in any one of them matches                                                              |
| `year`       | integer                                                        | no       | none        | Roots whose `publishedAt` falls in this calendar year in the site's time zone, whatever the order                                             |
| `media`      | comma-separated `MediaKind` \| `any` \| `none`                 | no       | none        | Kinds (`image`, `video`, `audio`, `text`, `document`): roots with an attachment of one of them. `any` = with any attachment, `none` = without |
| `title`      | `any` \| `none`                                                | no       | none        | Roots with a title, or without                                                                                                                |
| `replies`    | `any` \| `none`                                                | no       | none        | Threads with published replies, or single posts                                                                                               |
| `lang`       | BCP 47 tag                                                     | no       | all         | Restrict to one content language                                                                                                              |
| `status`     | `draft` \| `published`                                         | no       | `published` | `/api/threads` only                                                                                                                           |
| `include`    | `fold`                                                         | no       | none        | Add [the fold](#the-fold) to each Thread                                                                                                      |
| `cursor`     | string                                                         | no       | none        | Pass the previous `nextCursor` back unchanged                                                                                                 |
| `limit`      | integer                                                        | no       | `20`        | `1` to `100`                                                                                                                                  |
| `content`    | `markdown`                                                     | no       | none        | Return `bodyMarkdown` instead of the rendered body fields                                                                                     |

Orders:

| `sort`      | Order                                                                                            | Where the site uses it            |
| ----------- | ------------------------------------------------------------------------------------------------ | --------------------------------- |
| `activity`  | Newest activity first, pinned Threads on top. A reply moves its Thread up; a quiet reply doesn't | Homepage, a collection's `newest` |
| `published` | Newest root publication first, `id` breaking ties. A reply doesn't move its Thread               | Archive                           |
| `updated`   | Like `activity`, but quiet replies count too, and pinned Threads aren't moved to the top         | Archive's `?sort=updated`         |
| `oldest`    | Oldest root publication first                                                                    | A collection's `oldest`           |
| `rating`    | Highest rating first, then newest activity                                                       | A collection's `rating_desc`      |

Response:

```json
{
  "threads": [
    { "id": "pst_01jpyx3m7gw4w3h7m4bknq0v1d", "postCount": 9, "…": "…" }
  ],
  "nextCursor": null
}
```

Notes:

- `visibility` left out means what the homepage shows on `/api/public/threads`, and every visibility on `/api/threads`. `visibility=any` on `/api/public/threads` adds Threads hidden from Latest. `visibility=all` returns `400`, and so does `visibility=private` on `/api/public/threads`.
- `visibility=featured` lists newest-published first. A `sort` other than `published` returns `400`.
- A single `collection` without `sort` lists in that collection's own `sortOrder`, with its pinned Threads on top; several collections list by `activity`. `activity`, `oldest`, and `rating` on a collection keep its pins. `published` and `updated` read it as a plain filter.
- To walk every public Thread, pass `visibility=any&sort=published`: in `activity` order a new reply moves a Thread, which a walk can skip.
- Paging follows [Pagination](#pagination).
- An invalid value returns `400`. An unknown `collection` slug returns an empty result set.

### Get a Thread

`GET /api/public/threads/:slug`

`GET /api/threads/:id`

Auth: `Public when enabled` for `/api/public/threads/:slug`, `Session or token` for `/api/threads/:id`

Returns the Thread of the post the slug or ID names, root or reply. `include=fold` adds [the fold](#the-fold), and `content=markdown` works as on the list.

Notes:

- `/api/public/threads/:slug` returns `404` when the slug names a draft or a private post. A Thread hidden from Latest is returned.
- `/api/threads/:id` returns drafts and private Threads.

### List a Thread's posts

`GET /api/public/threads/:slug/posts`

`GET /api/threads/:id/posts`

Auth: `Public when enabled` for `/api/public/threads/:slug/posts`, `Session or token` for `/api/threads/:id/posts`

Returns the posts of the Thread the slug or ID names, in Thread order: the root first, then replies by creation time. The Thread page and the feeds use the same order.

Query parameters:

| Parameter | Type                   | Required | Default     | Notes                                                                  |
| --------- | ---------------------- | -------- | ----------- | ---------------------------------------------------------------------- |
| `status`  | `draft` \| `published` | no       | `published` | `/api/threads/:id/posts` only                                          |
| `cursor`  | string                 | no       | none        | Pass the previous `nextCursor` or a fold's `gap.cursor` back unchanged |
| `limit`   | integer                | no       | `100`       | `1` to `100`                                                           |
| `content` | `markdown`             | no       | none        | Return `bodyMarkdown` instead of the rendered body fields              |

Response: `{ "posts": [Post], "nextCursor": string | null }`, with each post as the Posts or Public posts endpoints return it.

Notes:

- `/api/public/threads/:slug/posts` returns published posts only.
- A reply published during a walk joins the end of the Thread, so the walk reaches it.
- Paging follows [Pagination](#pagination).

---

## Uploads

All upload endpoints require auth.

Jant exposes two upload APIs:

1. `/api/upload`: one-shot upload, preferred for ordinary scripts and migrations
2. `/api/uploads`: session-based upload, preferred for large files, unreliable connections, and application clients that need resumable transport

File size is limited by `UPLOAD_MAX_FILE_SIZE_MB` and defaults to `1024 MB`.

Jant accepts a broad set of image, video, audio, document, text, archive, font, design, and code MIME types. Unsupported types return `400`.

### Session-based upload flow

Base path: `/api/uploads`

Use this flow for new integrations:

1. `POST /api/uploads/init`
2. Upload the file using the returned transport
3. Optionally upload a poster image for video
4. `POST /api/uploads/:id/complete`

Upload sessions expire after roughly 15 minutes.

### Start an upload session

`POST /api/uploads/init`

Request body:

```json
{
  "filename": "photo.webp",
  "contentType": "image/webp",
  "size": 1024000,
  "checksumSha256": "base64-encoded-sha256"
}
```

Fields:

| Field            | Type    | Required | Default | Notes                           |
| ---------------- | ------- | -------- | ------- | ------------------------------- |
| `filename`       | string  | yes      | —       | Original filename               |
| `contentType`    | string  | yes      | —       | MIME type                       |
| `size`           | integer | yes      | —       | File size in bytes              |
| `checksumSha256` | string  | no       | `null`  | Base64-encoded SHA-256 checksum |

The response includes an upload session ID (`upl_*`) and one of three transport kinds. Send the file to `transport.url` as given: on a site with `SITE_PATH_PREFIX`, the relay URLs already start with the prefix.

#### Relay transport

```json
{
  "id": "upl_01jpyx9h0m8w4g5q1c7d2f3r4s",
  "transport": {
    "kind": "relay",
    "method": "PUT",
    "url": "/api/uploads/upl_01jpyx9h0m8w4g5q1c7d2f3r4s/body"
  }
}
```

#### Multipart relay transport

```json
{
  "id": "upl_01jpyx9h0m8w4g5q1c7d2f3r4s",
  "transport": {
    "kind": "multipartRelay",
    "method": "PUT",
    "url": "/api/uploads/upl_01jpyx9h0m8w4g5q1c7d2f3r4s/part",
    "partSize": 52428800
  }
}
```

#### Presigned PUT transport

When the storage driver supports direct uploads, Jant can return a presigned target instead:

```json
{
  "id": "upl_01jpyx9h0m8w4g5q1c7d2f3r4s",
  "transport": {
    "kind": "put",
    "url": "https://uploads.example.test/...",
    "method": "PUT",
    "headers": {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable"
    },
    "expiresAt": 1706000900
  }
}
```

### Upload the file body

Use the transport returned by `init`.

For `relay`:

`PUT /api/uploads/:id/body`

- Body: raw file bytes
- Success response: `204 No Content`

For `multipartRelay`:

`PUT /api/uploads/:id/part?partNumber=N`

- Body: raw part bytes
- Success response:

```json
{
  "partNumber": 1,
  "etag": "etag-value"
}
```

For `put`:

- Upload directly to the returned `transport.url`
- Use the returned HTTP method and headers unchanged

### Upload a poster image

`PUT /api/uploads/:id/poster`

Use this when uploading a video and you want a WebP poster frame.

- Body: raw WebP bytes
- Success response: `204 No Content`

### Complete an upload session

`POST /api/uploads/:id/complete`

Request body:

```json
{
  "width": 1200,
  "height": 800,
  "blurhash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
  "waveform": "optional-waveform",
  "summary": "Optional summary for text uploads",
  "chars": 123,
  "parts": [
    { "partNumber": 1, "etag": "etag-1" },
    { "partNumber": 2, "etag": "etag-2" }
  ]
}
```

Fields:

| Field      | Type    | Required                      | Default | Notes                                 |
| ---------- | ------- | ----------------------------- | ------- | ------------------------------------- |
| `width`    | integer | no                            | `null`  | Image/video width; positive           |
| `height`   | integer | no                            | `null`  | Image/video height; positive          |
| `blurhash` | string  | no                            | `null`  | Blurhash string, max `200`            |
| `waveform` | string  | no                            | `null`  | Audio waveform, max `2000`            |
| `summary`  | string  | no                            | `null`  | Mainly for text uploads, max `500`    |
| `chars`    | integer | no                            | `null`  | Mainly for text uploads; non-negative |
| `parts`    | array   | required for `multipartRelay` | —       | `[{partNumber, etag}]`                |

Response: `201 Created` with the [media object](#media) the upload became.

### Abort an upload session

`POST /api/uploads/:id/abort`

Response:

```json
{ "success": true }
```

### One-shot upload

Base path: `/api/upload`

Use this when a script or one-time migration benefits from sending one file in a single multipart request. Use `/api/uploads` when files are large or the connection is unreliable.

#### Upload a file

`POST /api/upload`

Content type: `multipart/form-data`

Form fields:

| Field             | Type    | Required | Default | Notes                          |
| ----------------- | ------- | -------- | ------- | ------------------------------ |
| `file`            | file    | yes      | —       | Main file                      |
| `width`           | integer | no       | `null`  | Image/video width              |
| `height`          | integer | no       | `null`  | Image/video height             |
| `alt`             | string  | no       | `null`  | Alt text                       |
| `blurhash`        | string  | no       | `null`  | Blurhash                       |
| `waveform`        | string  | no       | `null`  | Audio waveform                 |
| `summary`         | string  | no       | `null`  | Summary for text uploads       |
| `durationSeconds` | integer | no       | `null`  | Video or audio length          |
| `poster`          | file    | no       | —       | Poster frame for video uploads |

Response: `201 Created` with the [media object](#media) the file became.

## Media

Base path: `/api/media`

The files you've uploaded, whether attached to a post or not. Upload them with [`POST /api/upload`](#one-shot-upload) or an [upload session](#session-based-upload-flow).

Media responses, from these endpoints and the MCP media tools, include these fields:

| Field             | Type                                                  | Notes                                                                                                             |
| ----------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`              | `med_*` string                                        | Media ID                                                                                                          |
| `postId`          | `pst_*` string \| `null`                              | The post the file is attached to; `null` while unattached                                                         |
| `type`            | `media` \| `text`                                     | `text` for a text attachment, `media` for every other file                                                        |
| `mediaKind`       | `image` \| `video` \| `audio` \| `text` \| `document` | Kind of file                                                                                                      |
| `mimeType`        | string                                                | MIME type                                                                                                         |
| `originalName`    | string                                                | The file's name as uploaded                                                                                       |
| `size`            | integer                                               | Bytes                                                                                                             |
| `width`           | integer \| `null`                                     | Pixels, for images and video                                                                                      |
| `height`          | integer \| `null`                                     | Pixels, for images and video                                                                                      |
| `durationSeconds` | number \| `null`                                      | For audio and video                                                                                               |
| `alt`             | string \| `null`                                      | Alt text                                                                                                          |
| `blurhash`        | string \| `null`                                      | Placeholder hash for images                                                                                       |
| `waveform`        | string \| `null`                                      | Waveform data for audio                                                                                           |
| `summary`         | string \| `null`                                      | Text attachment summary                                                                                           |
| `chars`           | integer \| `null`                                     | Text attachment length in characters                                                                              |
| `createdAt`       | integer                                               | Unix seconds                                                                                                      |
| `updatedAt`       | integer                                               | Unix seconds                                                                                                      |
| `url`             | string                                                | The file's public URL; for `type: "text"`, its Markdown source                                                    |
| `previewUrl`      | string                                                | `type: "media"` only: a resized image for images, the file's URL otherwise                                        |
| `posterUrl`       | string \| `null`                                      | `type: "media"` only: the poster frame for video                                                                  |
| `contentFormat`   | `markdown`                                            | `type: "text"` only                                                                                               |
| `contentUrl`      | string                                                | `type: "text"` only: the Markdown source as JSON; see [Get text attachment content](#get-text-attachment-content) |

### List media

`GET /api/media`

Auth: `Session or token`

Query parameters:

| Parameter    | Type    | Required | Default | Notes                                         |
| ------------ | ------- | -------- | ------- | --------------------------------------------- |
| `limit`      | integer | no       | `50`    | `1` to `200`                                  |
| `mimePrefix` | string  | no       | none    | Prefix filter such as `image/` or `video/`    |
| `cursor`     | string  | no       | none    | Pass the previous `nextCursor` back unchanged |

Response:

```json
{
  "media": [
    {
      "id": "med_01jpyx4g9m8b4y50a4gx3t7p1n",
      "postId": null,
      "originalName": "photo.webp",
      "mimeType": "image/webp",
      "size": 1024000,
      "width": 1200,
      "height": 800,
      "durationSeconds": null,
      "alt": "Cover image",
      "blurhash": null,
      "waveform": null,
      "summary": null,
      "chars": null,
      "mediaKind": "image",
      "createdAt": 1706000000,
      "updatedAt": 1706000000,
      "type": "media",
      "url": "/media/med_01jpyx4g9m8b4y50a4gx3t7p1n.webp",
      "previewUrl": "/media/med_01jpyx4g9m8b4y50a4gx3t7p1n.webp",
      "posterUrl": null
    }
  ],
  "nextCursor": null
}
```

Notes:

- Newest first. `nextCursor` is `null` on the last page.
- This list may include ordinary uploaded binaries and stored text attachments.
- Text attachments use `type: "text"` and expose `contentFormat` plus `contentUrl` instead of `previewUrl` and `posterUrl`.

### Get a media item

`GET /api/media/:id`

Auth: `Session or token`

Returns one media or text attachment record using the same response shape as `GET /api/media`.

### Update media alt text

`PUT /api/media/:id`

Auth: `Session or token`

Request body:

```json
{
  "alt": "Cover image"
}
```

Rules:

- `alt` is trimmed before storing.
- Max length is `500`.

Response: `200 OK` with the updated media object.

### Delete a media item

`DELETE /api/media/:id`

Auth: `Session or token`

Deletes the media record and its stored object.

Response:

```json
{ "success": true }
```

## Collections

Base path: `/api/collections`

Collections group complete Threads by topic. A Thread can belong to multiple
Collections, and its root and children always share the same memberships.

Collection responses include these fields:

| Field              | Type                                  | Notes                            |
| ------------------ | ------------------------------------- | -------------------------------- |
| `id`               | `col_*` string                        | Collection ID                    |
| `slug`             | string                                | Canonical collection slug        |
| `title`            | string                                | Display title                    |
| `description`      | string \| `null`                      | Optional description             |
| `sortOrder`        | `newest` \| `oldest` \| `rating_desc` | Per-collection Thread sort order |
| `createdAt`        | integer                               | Unix seconds                     |
| `updatedAt`        | integer                               | Unix seconds                     |
| `threadCount`      | integer                               | Only present in list responses   |
| `recentActivityAt` | integer                               | Only present in list responses   |

Directory item responses include these fields:

| Field               | Type                                                      | Notes                                   |
| ------------------- | --------------------------------------------------------- | --------------------------------------- |
| `id`                | `cdi_*` string                                            | Directory item ID                       |
| `type`              | `collection` \| `smart_collection` \| `divider` \| `link` | Item kind                               |
| `collectionId`      | `col_*` string \| `null`                                  | Present for `type: "collection"`        |
| `smartCollectionId` | `smc_*` string \| `null`                                  | Present for `type: "smart_collection"`  |
| `label`             | string \| `null`                                          | Divider label or link label             |
| `url`               | string \| `null`                                          | Present for `type: "link"`              |
| `description`       | string \| `null`                                          | Optional description for `type: "link"` |
| `position`          | string                                                    | Fractional ordering key                 |
| `createdAt`         | integer                                                   | Unix seconds                            |
| `updatedAt`         | integer                                                   | Unix seconds                            |

Notes:

- A directory item is a _position_, not a membership. Every collection and smart collection appears in the directory whether or not one exists — unplaced entries are appended — so a directory item exists only to interleave an entry with dividers and links and to drag it around.
- Creating a collection automatically creates a `type: "collection"` directory item.
- Deleting a collection also deletes its `type: "collection"` directory item.
- `POST /api/collections/directory-items` only accepts `divider` and `link`. Collection-backed items are managed through collection CRUD, not this endpoint.

### List collections

`GET /api/collections`

Auth: `Session or token`

Query parameters:

| Parameter | Type       | Required | Default | Notes                                                                               |
| --------- | ---------- | -------- | ------- | ----------------------------------------------------------------------------------- |
| `view`    | `compose`  | no       | none    | Specialized compose view sorted by recent activity                                  |
| `lang`    | BCP 47 tag | no       | all     | Count only Threads in this content language in `threadCount` and `recentActivityAt` |

Default response:

```json
{
  "collections": [
    {
      "id": "col_01jpyx5qds8y79w2dd6sv4rznj",
      "slug": "reading",
      "title": "Reading",
      "description": "Books I've read",
      "sortOrder": "newest",
      "createdAt": 1706000000,
      "updatedAt": 1706000000,
      "threadCount": 12,
      "recentActivityAt": 1706100000
    }
  ],
  "smartCollections": [
    {
      "id": "smc_01jpyxa2k4d7n6r9s1t3v5w8xz",
      "slug": "quotes",
      "title": "Quotes",
      "description": "Things worth keeping.",
      "selection": { "format": "quote" },
      "sortOrder": "newest",
      "layout": null,
      "createdAt": 1706000000,
      "updatedAt": 1706000000,
      "threadCount": 34,
      "recentActivityAt": 1706090000
    }
  ],
  "directoryItems": [
    {
      "id": "cdi_01jpyx8r7s3v8m1q5c9k2f6gth",
      "type": "collection",
      "collectionId": "col_01jpyx5qds8y79w2dd6sv4rznj",
      "smartCollectionId": null,
      "label": null,
      "url": null,
      "position": "a0",
      "createdAt": 1706000000,
      "updatedAt": 1706000000
    }
  ]
}
```

Notes:

- The default response returns directory ordering in `directoryItems`, and every smart collection in `smartCollections`. Both kinds carry `threadCount` and `recentActivityAt`, measured the same way, because the directory prints them side by side. Both count private Threads.
- `view=compose` returns collections sorted by recent activity and always returns an empty `directoryItems` array. It carries no smart collections: a post cannot be added to one by hand, so offering it in a compose picker would be a control that does nothing.

### Get a collection

`GET /api/collections/:id`

Auth: `Session or token`

Response:

```json
{
  "id": "col_01jpyx5qds8y79w2dd6sv4rznj",
  "slug": "reading",
  "title": "Reading",
  "description": "Books I've read",
  "sortOrder": "newest",
  "createdAt": 1706000000,
  "updatedAt": 1706000000
}
```

### Check an address

`GET /api/collections/slug`

Auth: `Session or token`

| Parameter      | Type           | Required | Notes                                     |
| -------------- | -------------- | -------- | ----------------------------------------- |
| `mode`         | `check`        | yes      | Test a typed address                      |
| `slug`         | string         | yes      | Address to test                           |
| `collectionId` | `col_*` string | no       | Ignore the address this one already holds |

Returns `{ "slug": "…", "available": true }`. A collection shares the root URL
namespace with posts and smart collections, so anything holding the address
makes it unavailable.

### Create a collection

`POST /api/collections`

Auth: `Session or token`

Request body:

```json
{
  "slug": "reading",
  "title": "Reading",
  "description": "Books I've read",
  "sortOrder": "newest"
}
```

Fields:

| Field         | Type                                  | Required | Default  | Notes                                                                        |
| ------------- | ------------------------------------- | -------- | -------- | ---------------------------------------------------------------------------- |
| `slug`        | string                                | yes      | —        | Canonical collection slug, max `200`, lowercase letters/numbers/hyphens only |
| `title`       | string                                | yes      | —        | Display title, max `120`                                                     |
| `description` | string                                | no       | `null`   | Optional description, max `500`                                              |
| `sortOrder`   | `newest` \| `oldest` \| `rating_desc` | no       | `newest` | Per-Collection Thread sort order                                             |

Notes:

- Reserved slugs are rejected.
- On success, Jant also creates the collection's `type: "collection"` directory item.

Response: `201 Created` with the collection object.

### Update a collection

`PUT /api/collections/:id`

Auth: `Session or token`

This is a partial update.

Request body fields:

| Field         | Type                                  | Required | Default   | Notes                              |
| ------------- | ------------------------------------- | -------- | --------- | ---------------------------------- |
| `slug`        | string                                | no       | unchanged | Same rules as create               |
| `title`       | string                                | no       | unchanged | Max `120`                          |
| `description` | string \| `null`                      | no       | unchanged | Send `null` to clear               |
| `sortOrder`   | `newest` \| `oldest` \| `rating_desc` | no       | unchanged | Replaces the collection sort order |

Response: `200 OK` with the updated collection object.

### Delete a collection

`DELETE /api/collections/:id`

Auth: `Session or token`

This removes the collection itself. Posts remain intact.

Response:

```json
{ "success": true }
```

### Create a directory item

`POST /api/collections/directory-items`

Auth: `Session or token`

Creates a manual directory item for the `/collections` directory page.

Request body:

Divider:

```json
{
  "type": "divider",
  "label": "Essays"
}
```

Link:

```json
{
  "type": "link",
  "label": "Quotes",
  "url": "/archive?format=quote"
}
```

Fields by type:

| Field         | Type             | Required         | Default | Notes                                                         |
| ------------- | ---------------- | ---------------- | ------- | ------------------------------------------------------------- |
| `type`        | `divider`        | yes              | —       | Creates a divider item                                        |
| `label`       | string \| `null` | no               | `null`  | Divider label, max `60`; blank values are stored as `null`    |
| `type`        | `link`           | yes              | —       | Creates a custom link item                                    |
| `label`       | string           | yes (for `link`) | —       | Link label, 1-60 chars after trim                             |
| `url`         | string           | yes (for `link`) | —       | Relative path or absolute `http:`, `https:`, or `mailto:` URL |
| `description` | string \| `null` | no               | `null`  | Link only: Markdown shown under the link                      |

Notes:

- `type: "collection"` is not accepted here.
- New items are appended to the end of the directory.

Response:

```json
{
  "id": "cdi_01jpyx8r7s3v8m1q5c9k2f6gth",
  "type": "divider",
  "collectionId": null,
  "label": "Essays",
  "url": null,
  "position": "a1",
  "createdAt": 1706000000,
  "updatedAt": 1706000000
}
```

### Update a directory item

`PUT /api/collections/directory-items/:id`

Auth: `Session or token`

Request body:

```json
{ "label": "Essays" }
```

This is a partial update.

Request body fields:

| Field   | Type             | Required | Default   | Notes                                               |
| ------- | ---------------- | -------- | --------- | --------------------------------------------------- |
| `label` | string \| `null` | no       | unchanged | For dividers: update label, or send `null` to clear |
| `url`   | string           | no       | unchanged | For links: update URL                               |

Notes:

- Divider items only use `label`.
- Link items use `label` and `url`.
- Link labels cannot be cleared with `null`.
- Collection-backed items should be managed through collection endpoints, not updated directly here.

Response: `200 OK` with the updated directory item.

### Move a directory item

`PUT /api/collections/directory-items/:id/move`

Auth: `Session or token`

Request body:

```json
{
  "after": "cdi_01jpyx8r7s3v8m1q5c9k2f6gth",
  "before": "cdi_01jpyx9m4h7s2v6b1r8k3t5qc"
}
```

Fields:

| Field    | Type                     | Required | Default | Notes                               |
| -------- | ------------------------ | -------- | ------- | ----------------------------------- |
| `after`  | `cdi_*` string \| `null` | no       | `null`  | Place the item after this neighbor  |
| `before` | `cdi_*` string \| `null` | no       | `null`  | Place the item before this neighbor |

Notes:

- `after` and `before` are both optional and nullable.
- Use `before: "<id>"` with `after: null` to move to the beginning.
- Use `after: "<id>"` with `before: null` to move to the end.
- If both are missing or `null`, Jant appends the item to the end.

Response: `200 OK` with the moved directory item, including its new `position`.

### Delete a directory item

`DELETE /api/collections/directory-items/:id`

Auth: `Session or token`

Response:

```json
{ "success": true }
```

An ID that names no directory item returns `404`.

### Add a Thread to a collection

`POST /api/collections/:id/threads`

Auth: `Session or token`

Request body:

```json
{ "threadId": "pst_01jpyx3m7gw4w3h7m4bknq0v1d" }
```

Fields:

| Field      | Type           | Required | Default | Notes                        |
| ---------- | -------------- | -------- | ------- | ---------------------------- |
| `threadId` | `pst_*` string | yes      | —       | Thread root or child Post ID |

The ID is normalized to the Thread root. The root and every child share one
Collection membership set. Adding a Thread that is already in the Collection
changes nothing.

Response:

```json
{ "success": true }
```

On this endpoint and the three below, a Collection or post that doesn't exist
returns `404`.

### Remove a Thread from a collection

`DELETE /api/collections/:id/threads/:threadId`

Auth: `Session or token`

Removes the whole Thread from the Collection. It does not delete the Thread or
the Collection. Removing a Thread that isn't in the Collection changes nothing.

Response:

```json
{ "success": true }
```

### Pin or unpin a Thread in a collection

`PUT /api/collections/:id/threads/:threadId/pin`

`DELETE /api/collections/:id/threads/:threadId/pin`

Auth: `Session or token`

Both endpoints accept a Thread root or child Post ID and operate on the shared
Thread membership. Pinning a Thread that isn't in the Collection returns `409`;
unpinning one changes nothing. Response:

```json
{ "success": true }
```

---

## Smart Collections

Base path: `/api/smart-collections`

Auth: `Session or token` on every endpoint. A smart collection's _page_ is
public; managing one is not.

A smart collection is a collection whose members come from conditions rather
than from tagging. Nothing is added to one by hand, so there are no membership
endpoints here — the conditions are the membership.

Smart collection responses include these fields:

| Field              | Type                                  | Notes                                                                        |
| ------------------ | ------------------------------------- | ---------------------------------------------------------------------------- |
| `id`               | `smc_*` string                        | Smart collection ID                                                          |
| `slug`             | string                                | Canonical address, in the same namespace as posts                            |
| `title`            | string                                | Display title. Required                                                      |
| `description`      | string \| `null`                      | Optional description                                                         |
| `selection`        | object                                | The conditions. `{}` collects every post                                     |
| `sortOrder`        | `newest` \| `oldest` \| `rating_desc` | Order of the posts the conditions gather, named and valued as a collection's |
| `layout`           | `list` \| `grid` \| `null`            | `null` follows the site's archive layout                                     |
| `createdAt`        | integer                               | Unix seconds                                                                 |
| `updatedAt`        | integer                               | Unix seconds                                                                 |
| `threadCount`      | integer                               | Only present in list responses                                               |
| `recentActivityAt` | integer                               | Only present in list responses                                               |

### The `selection` object

Each key is one condition, and a key may appear once. Conditions are combined
with AND. Omitting a key means that dimension is not part of the conditions —
there is no "any" value, because a key that is absent already says that.

| Key          | Value                                                                     |
| ------------ | ------------------------------------------------------------------------- |
| `collection` | Array of exactly one `col_*` id                                           |
| `format`     | `note` \| `link` \| `quote`                                               |
| `title`      | boolean — `true` has a title, `false` has none                            |
| `year`       | integer, 1971 or later                                                    |
| `media`      | `"any"` \| `"none"` \| array of `image` `video` `audio` `text` `document` |
| `replies`    | boolean — `true` threads with replies, `false` single posts               |
| `visibility` | `public` \| `featured` \| `latest_hidden`                                 |

A key this table doesn't list answers `400` rather than being ignored like an
unknown field elsewhere: dropping a condition would publish a wider page than
the one asked for.

`visibility` never accepts `private`, and `collection` never accepts more than
one id. The first is because a smart collection is a published page and can
never name a set only its author can see; the second is because two ids would
be an OR, which the conditions do not express.

### List smart collections

`GET /api/smart-collections`

| Parameter | Type       | Required | Default | Notes                                      |
| --------- | ---------- | -------- | ------- | ------------------------------------------ |
| `lang`    | BCP 47 tag | no       | all     | Narrows both measures to one language view |

Response: `{ "smartCollections": SmartCollection[] }`, each carrying
`threadCount` and `recentActivityAt`.

Both measures answer for the caller. A private thread is counted, and dates the
smart collection, only for a caller who could read it — the same rule the
collection directory follows. `recentActivityAt` is the newest activity among
the threads the conditions match, where activity means the thread gained a
post; editing one is not activity. A smart collection whose conditions match
nothing reports its own `updatedAt`.

### Get a smart collection

`GET /api/smart-collections/:id`

Response: the smart collection object.

### Create a smart collection

`POST /api/smart-collections`

Body:

```json
{
  "slug": "quotes",
  "title": "Quotes",
  "description": "Things worth keeping.",
  "selection": { "format": "quote", "media": "any" },
  "sortOrder": "newest",
  "layout": null
}
```

`slug` and `title` are required; everything else is optional. Returns `201` with
the smart collection object. A slug already used by a post, a
collection, or another smart collection returns `409` — they share one address
space.

### Update a smart collection

`PUT /api/smart-collections/:id`

Same body, every field optional. Returns the updated smart collection object. Sending `selection` **replaces** the conditions
entirely: a dimension you leave out is cleared, not kept.

Changing `slug` moves the address immediately and does not leave a redirect
behind. Any navigation item pointing at this smart collection follows.

### Delete a smart collection

`DELETE /api/smart-collections/:id`

Response: `{ "success": true }`. The address stops working at once.

### Preview a selection

`POST /api/smart-collections/preview`

Counts what a set of conditions would gather, without saving anything.

Body: `{ "selection": { … } }` — the same shape create validates. `POST` rather
than `GET` because the conditions are a typed body; spelling them into a URL
would mean inventing a second encoding for them.

| Parameter | Type       | Required | Default | Notes                             |
| --------- | ---------- | -------- | ------- | --------------------------------- |
| `lang`    | BCP 47 tag | no       | all     | Narrows both counts to a language |

Response:

```json
{ "count": 34, "baseline": 1240 }
```

`count` is how many threads match; `baseline` is how many there are in total.
Both are counted for the caller, so a signed-in author may see larger numbers
than the page shows an anonymous reader — the same rule as everywhere else.

### Check an address

`GET /api/smart-collections/slug`

| Parameter           | Type                 | Required  | Notes                                        |
| ------------------- | -------------------- | --------- | -------------------------------------------- |
| `mode`              | `suggest` \| `check` | yes       | Derive one from a title, or test a typed one |
| `title`             | string               | `suggest` | Title to derive from                         |
| `slug`              | string               | `check`   | Address to test                              |
| `smartCollectionId` | `smc_*` string       | no        | Ignore the address this one already holds    |

`mode=suggest` returns `{ "slug": "…" }`; `mode=check` returns
`{ "slug": "…", "available": true }`.

---

## Navigation Items

Base path: `/api/nav-items`

Navigation items power the header navigation.

Nav item responses include these fields:

| Field               | Type                                                                                                 | Notes                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `id`                | `nav_*` string                                                                                       | Nav item ID                                                                                  |
| `type`              | `link` \| `system` \| `collection` \| `smart_collection` \| `page`                                   | What the item points at                                                                      |
| `systemKey`         | `latest` \| `featured` \| `archive` \| `collections` \| `subscribe` \| `rss` \| `settings` \| `null` | `null` unless `type: "system"`                                                               |
| `collectionId`      | `col_*` string \| `null`                                                                             | `null` unless `type: "collection"`                                                           |
| `smartCollectionId` | `smc_*` string \| `null`                                                                             | `null` unless `type: "smart_collection"`                                                     |
| `postId`            | `pst_*` string \| `null`                                                                             | `null` unless `type: "page"`                                                                 |
| `label`             | string                                                                                               | Author's override, or `""` to follow the target                                              |
| `url`               | string                                                                                               | Stored URL or path                                                                           |
| `targetTitle`       | string \| `null`                                                                                     | The target's current title, shown when `label` is `""`. `null` for `link` and `system` items |
| `placement`         | `header` \| `more`                                                                                   | In the header, or in its More menu                                                           |
| `position`          | string                                                                                               | Fractional ordering key                                                                      |
| `createdAt`         | integer                                                                                              | Unix seconds                                                                                 |
| `updatedAt`         | integer                                                                                              | Unix seconds                                                                                 |

### List nav items

`GET /api/nav-items`

Auth: `Session or token`

Response:

```json
{
  "navItems": [
    {
      "id": "nav_01jpyxcv3m7w4b8k2r5s9t1qfh",
      "type": "link",
      "label": "GitHub",
      "url": "https://github.com/your-username",
      "position": "a0",
      "createdAt": 1706000000,
      "updatedAt": 1706000000
    }
  ]
}
```

### Create a nav item

`POST /api/nav-items`

Auth: `Session or token`

Create a custom link:

```json
{
  "type": "link",
  "label": "GitHub",
  "url": "https://github.com/your-username"
}
```

Create a built-in item:

```json
{
  "type": "system",
  "systemKey": "archive"
}
```

Fields by type:

| Field               | Type                                                                                       | Required                     | Default   | Notes                                                            |
| ------------------- | ------------------------------------------------------------------------------------------ | ---------------------------- | --------- | ---------------------------------------------------------------- |
| `type`              | `link`                                                                                     | yes                          | —         | Creates a custom nav link                                        |
| `label`             | string                                                                                     | yes (for `link`)             | —         | Link label, 1-100 chars after trim                               |
| `url`               | string                                                                                     | yes (for `link`)             | —         | Relative path or absolute `http:`, `https:`, or `mailto:` URL    |
| `type`              | `system`                                                                                   | yes                          | —         | Creates a built-in nav item                                      |
| `systemKey`         | `latest` \| `featured` \| `archive` \| `collections` \| `subscribe` \| `rss` \| `settings` | yes (for `system`)           | —         | Built-in destination key                                         |
| `type`              | `collection` \| `smart_collection` \| `page`                                               | yes                          | —         | Points at a collection, a smart collection, or a standalone page |
| `collectionId`      | `col_*` string                                                                             | yes (for `collection`)       | —         | Collection to point at                                           |
| `smartCollectionId` | `smc_*` string                                                                             | yes (for `smart_collection`) | —         | Smart collection to point at                                     |
| `postId`            | `pst_*` string                                                                             | yes (for `page`)             | —         | Published, non-private, titled Note to point at                  |
| `placement`         | `header` \| `more`                                                                         | no                           | see notes | In the header, or in its More menu                               |

System keys:

- `latest`
- `featured`
- `archive`
- `collections`
- `subscribe`
- `rss`
- `settings`

Notes:

- Built-in items get their label and URL automatically.
- `placement` defaults to `header`, except for the built-in `collections`, `subscribe`, `rss`, and `settings` items, which default to `more`.
- Jant rejects duplicate built-in items.
- A `collection`, `smart_collection`, or `page` item stores its `label` empty unless you send one. It then shows its target's current title and follows it when the target is renamed, and its URL follows when the target's address moves. Only a label you typed is stored, and it then wins in every language view.

Response: `201 Created` with the new nav item.

### Move a nav item

`PUT /api/nav-items/:id/move`

Auth: `Session or token`

Request body:

```json
{
  "after": "nav_...",
  "before": "nav_..."
}
```

- `after` and `before` are optional and nullable.
- If neither is provided, the item moves to the end.

Response: `200 OK` with the moved nav item, including its new `position`.

### Update a nav item

`PUT /api/nav-items/:id`

Auth: `Session or token`

Request body:

```json
{
  "label": "Source",
  "url": "https://github.com/your-username"
}
```

Notes:

- This is a partial update.
- Built-in system items reject manual label and URL edits.
- Only `label`, `url`, and `placement` are accepted.

Response: `200 OK` with the updated nav item.

### Delete a nav item

`DELETE /api/nav-items/:id`

Auth: `Session or token`

Response:

```json
{ "success": true }
```

---

## Custom URLs

Base path: `/api/custom-urls`

Custom URLs let you attach extra paths to posts or collections, or define internal redirects.

Custom URL responses include these fields:

| Field          | Type                                              | Notes                                                                              |
| -------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`           | `pth_*` string                                    | Custom URL ID                                                                      |
| `path`         | string                                            | The address, with a leading slash                                                  |
| `targetType`   | `post` \| `collection` \| `redirect` \| `archive` | Target kind                                                                        |
| `targetId`     | string \| `null`                                  | The post's or collection's TypeID; `null` for other kinds                          |
| `toPath`       | string \| `null`                                  | `redirect` only: a path on the site, with a leading slash, or an `http(s)` address |
| `redirectType` | `301` \| `302` \| `null`                          | `redirect` only: the status it answers with                                        |
| `archiveQuery` | string \| `null`                                  | `archive` only: the archive query the address shows                                |
| `createdAt`    | integer                                           | Unix seconds                                                                       |

Target types:

| Type         | Meaning                                    | Key fields               |
| ------------ | ------------------------------------------ | ------------------------ |
| `post`       | Alias that resolves to a post              | `targetId`               |
| `collection` | Alias that resolves to a collection        | `targetId`               |
| `redirect`   | Redirect to another path or another site   | `toPath`, `redirectType` |
| `archive`    | A saved archive view; read and delete only | `archiveQuery`           |

`archive` addresses can't be created anymore; a [smart collection](#smart-collections) does the same job. Existing ones keep working, and the list returns them.

### List custom URLs

`GET /api/custom-urls`

Auth: `Session or token`

Query parameters:

| Parameter | Type    | Required | Default | Notes                                         |
| --------- | ------- | -------- | ------- | --------------------------------------------- |
| `limit`   | integer | no       | `100`   | `1` to `100`                                  |
| `cursor`  | string  | no       | none    | Pass the previous `nextCursor` back unchanged |

Response:

```json
{
  "customUrls": [
    {
      "id": "pth_01jpyxb27t6m4v9r2k8s5c1qfh",
      "path": "/blog/old-post",
      "targetType": "redirect",
      "targetId": null,
      "toPath": "/my-new-slug",
      "redirectType": 301,
      "archiveQuery": null,
      "createdAt": 1706000000
    },
    {
      "id": "pth_01jpyxbk8v4m2s7r9c5t1g6qdn",
      "path": "/essays/on-writing",
      "targetType": "post",
      "targetId": "pst_01jpyx3m7gw4w3h7m4bknq0v1d",
      "toPath": null,
      "redirectType": null,
      "archiveQuery": null,
      "createdAt": 1706000000
    }
  ],
  "nextCursor": null
}
```

Notes:

- Newest first. `nextCursor` is `null` on the last page; see [Pagination](#pagination).
- The list covers aliases, redirects, and archive addresses. Canonical post and collection slugs are not custom URLs and aren't listed.

### Create a custom URL

`POST /api/custom-urls`

Auth: `Session or token`

Request body:

```json
{
  "path": "/blog/old-post",
  "targetType": "redirect",
  "toPath": "/my-new-slug",
  "redirectType": 301
}
```

Fields:

| Field          | Type                                 | Required                            | Default | Notes                                                                                                                                                                        |
| -------------- | ------------------------------------ | ----------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`         | string                               | yes                                 | —       | Max `512`; starts with a letter or digit, then lowercase letters, numbers, `-`, `.`, and `/`; the leading `/` may be left off                                                |
| `targetType`   | `post` \| `collection` \| `redirect` | yes                                 | —       | Target kind                                                                                                                                                                  |
| `targetId`     | string                               | required for `post` or `collection` | —       | The post's or collection's TypeID, or its slug                                                                                                                               |
| `toPath`       | string                               | required for `redirect`             | —       | A path on the site, such as `/new-path?format=note`, or a full `http://` or `https://` address. A path is lowercased and keeps its query string; an address is kept as given |
| `redirectType` | `301` \| `302`                       | no                                  | `301`   | Only used for `redirect`. The strings `"301"` and `"302"` are accepted too                                                                                                   |

Examples:

Redirect an old path:

```json
{
  "path": "/blog/2024/my-old-post",
  "targetType": "redirect",
  "toPath": "/my-new-slug",
  "redirectType": 301
}
```

Create an alias for a post:

```json
{
  "path": "/essays/on-writing",
  "targetType": "post",
  "targetId": "on-writing"
}
```

Important notes:

- `path` must not collide with an existing slug or custom URL.
- Reserved paths are rejected.
- A redirect can point at a path on the site or at another site. A path is followed within the language view it was reached from.
- A post or collection target that doesn't exist answers `404`.
- The response names the target by TypeID, whichever you sent.

Response: `201 Created` with the new custom URL object.

### Delete a custom URL

`DELETE /api/custom-urls/:id`

Auth: `Session or token`

This only deletes non-canonical custom URL records. Canonical post and collection slugs are not removable through this endpoint.

Response:

```json
{ "success": true }
```

---

## Settings

Base path: `/api/settings`

These endpoints manage user-editable site settings and a small amount of UI state.

All settings endpoints require auth.

### Editable setting keys

`GET /api/settings` and `PUT /api/settings` operate on these, and on the [appearance settings](#appearance-setting-keys). `GET` also reports the [site's languages](#restore-the-sites-languages).

All values are strings because they map directly to stored config values.

| Key                          | Meaning                    | Example value       |
| ---------------------------- | -------------------------- | ------------------- |
| `SITE_NAME`                  | Site title                 | `"My Blog"`         |
| `SITE_DESCRIPTION`           | Site description           | `"Notes and links"` |
| `SITE_LANGUAGE`              | BCP 47 content language    | `"en"`              |
| `DASHBOARD_LANGUAGE`         | Dashboard catalog language | `"zh-Hans"`         |
| `MAIN_RSS_FEED`              | Canonical feed kind        | `"featured"`        |
| `ARCHIVE_DEFAULT_LAYOUT`     | Archive default layout     | `"list"`            |
| `PAGE_SIZE`                  | Default page size          | `"25"`              |
| `SEARCH_PAGE_SIZE`           | Search page size           | `"25"`              |
| `ARCHIVE_PAGE_SIZE`          | Archive page size          | `"25"`              |
| `SUMMARY_MAX_PARAGRAPHS`     | Summary paragraph limit    | `"5"`               |
| `SUMMARY_MAX_CHARS`          | Summary character limit    | `"500"`             |
| `RSS_FEED_LIMIT`             | RSS item limit             | `"50"`              |
| `RSS_PUBLISH_DELAY_SECONDS`  | Feed publication delay     | `"300"`             |
| `TIME_ZONE`                  | IANA timezone              | `"Asia/Shanghai"`   |
| `SITE_FOOTER`                | Footer HTML/text           | `"<p>Footer</p>"`   |
| `SHOW_JANT_BRANDING_ON_HOME` | Branding toggle            | `"true"`            |
| `NOINDEX`                    | Search-engine exclusion    | `"true"`            |
| `PUBLIC_API_ENABLED`         | Anonymous JSON reads       | `"true"`            |
| `RSS_FEEDS_ENABLED`          | Atom feed publishing       | `"true"`            |

Notes:

- Editable keys use an explicit allowlist in the config registry; env-only,
  secret, and internal keys are excluded by default.
- Boolean and numeric settings are still strings in the API.
- Send strings in `PUT /api/settings`, not JSON booleans or numbers.
- `TIME_ZONE` is normalized to canonical IANA names when possible.
- `GET /api/settings` returns the effective environment or built-in fallback
  for editable keys that are not stored yet.
- In demo mode, `NOINDEX` is always returned as `"true"`.

### Appearance setting keys

Each has its own screen under Settings rather than a Config Editor row. `PUT /api/settings` checks a value the way that screen would.

| Key                  | Meaning                                          | Example value            |
| -------------------- | ------------------------------------------------ | ------------------------ |
| `THEME`              | Color theme ID; `""` follows `DEFAULT_THEME`     | `"paper"`                |
| `FONT_THEME`         | Font theme ID; `""` follows `DEFAULT_FONT_THEME` | `"literary"`             |
| `THEME_MODE`         | `auto`, `light`, or `dark`                       | `"dark"`                 |
| `CUSTOM_CSS`         | Custom CSS, trimmed; locked on the demo site     | `"body { color: red; }"` |
| `SHOW_HEADER_AVATAR` | Avatar in the site header, `"true"` or `"false"` | `"true"`                 |

A theme or font theme ID that Jant doesn't have answers `400`.

### Get editable settings

`GET /api/settings`

Auth: `Session or token`

Response:

```json
{
  "settings": {
    "SITE_NAME": "Jant",
    "SITE_DESCRIPTION": "Thoughts, links, and quotes — one post at a time",
    "SITE_LANGUAGE": "en",
    "MAIN_RSS_FEED": "featured",
    "ARCHIVE_DEFAULT_LAYOUT": "list",
    "PAGE_SIZE": "25",
    "SEARCH_PAGE_SIZE": "25",
    "ARCHIVE_PAGE_SIZE": "25",
    "SUMMARY_MAX_PARAGRAPHS": "5",
    "SUMMARY_MAX_CHARS": "500",
    "RSS_FEED_LIMIT": "50",
    "RSS_PUBLISH_DELAY_SECONDS": "300",
    "TIME_ZONE": "UTC",
    "SITE_FOOTER": "",
    "SHOW_JANT_BRANDING_ON_HOME": "false",
    "NOINDEX": "false",
    "PUBLIC_API_ENABLED": "true",
    "RSS_FEEDS_ENABLED": "true",
    "THEME": "tufte",
    "FONT_THEME": "classic",
    "THEME_MODE": "auto",
    "CUSTOM_CSS": "",
    "SHOW_HEADER_AVATAR": "false",
    "MULTILINGUAL_ENABLED": "false",
    "ADDITIONAL_LANGUAGES": ""
  }
}
```

Notes:

- The response always returns every setting with the value in effect, not only keys stored in the database.
- Environment-only and internal keys never appear in this response.

### Update editable settings

`PUT /api/settings`

Auth: `Session or token`

Request body:

```json
{
  "SITE_NAME": "New Name",
  "SITE_DESCRIPTION": "Updated description"
}
```

Request rules:

- The body must be a JSON object whose values are strings.
- `SITE_NAME` is trimmed and limited to `120` characters.
- `SITE_DESCRIPTION` is trimmed and limited to `1000` characters.
- `SITE_FOOTER` is trimmed and limited to `5000` characters.
- Boolean settings accept only `"true"` or `"false"`.
- Enum settings accept only the options listed above.
- `SITE_LANGUAGE` accepts and canonicalizes valid BCP 47 language tags.
- `TIME_ZONE` accepts canonical IANA names and normalizes legacy aliases such as `"Beijing"` to `"Asia/Shanghai"`.
- `PAGE_SIZE`, `SEARCH_PAGE_SIZE`, and `ARCHIVE_PAGE_SIZE` accept integers from `1` to `100`.
- `SUMMARY_MAX_PARAGRAPHS` accepts integers from `1` to `50`.
- `SUMMARY_MAX_CHARS` accepts integers from `1` to `1500`.
- `RSS_FEED_LIMIT` accepts integers from `1` to `200`.
- `RSS_PUBLISH_DELAY_SECONDS` accepts integers from `0` to `7200`; `0` disables the delay.
- Resetting `SEARCH_PAGE_SIZE` or `ARCHIVE_PAGE_SIZE` makes it inherit the effective `PAGE_SIZE` value.

Behavior:

- Editable keys are updated.
- Rejected keys are ignored if at least one editable key remains.
- If every provided key is rejected, the endpoint returns `400`.
- Successful responses return the full current editable settings object, plus optional top-level `rejectedKeys`.

Example partial-apply response:

```json
{
  "settings": {
    "SITE_NAME": "New Name",
    "SITE_DESCRIPTION": "Thoughts, links, and quotes — one post at a time",
    "SITE_LANGUAGE": "en",
    "MAIN_RSS_FEED": "featured",
    "ARCHIVE_DEFAULT_LAYOUT": "list",
    "TIME_ZONE": "UTC",
    "SITE_FOOTER": "",
    "SHOW_JANT_BRANDING_ON_HOME": "",
    "NOINDEX": ""
  },
  "rejectedKeys": ["AUTH_SECRET"]
}
```

Rejected keys are returned:

- in `details.rejectedKeys` on `400`
- in top-level `rejectedKeys` on successful partial updates

In demo mode, `NOINDEX` updates are rejected and the returned value stays `"true"`.

### Restore the site's languages

`PUT /api/settings/import`

Auth: `Session or token`

Restores the languages a site export recorded. `PUT /api/settings` doesn't take them: Settings → Languages changes them one at a time with its own checks.

| Key                    | Notes                                                 |
| ---------------------- | ----------------------------------------------------- |
| `ADDITIONAL_LANGUAGES` | Comma-separated language tags besides `SITE_LANGUAGE` |
| `MULTILINGUAL_ENABLED` | `"true"` or `"false"`; on only with a second language |

Request body: an object of those keys and string values. A key left out keeps its current value.

The response is what `PUT /api/settings` returns.

- Other keys are left out and listed in `rejectedKeys`. A request with neither key answers `400`.
- Each language passes the checks adding it in Settings would, against the current `SITE_LANGUAGE`. A language whose URL prefix collides with an existing address answers `409`.

### Reset a Config Editor setting

`DELETE /api/settings/:key`

Auth: `Session or token`

Removes the database override for one resettable Config Editor setting. This
includes directly editable values and the safe scalar linked settings `THEME`,
`FONT_THEME`, `THEME_MODE`, and `SHOW_HEADER_AVATAR`.

The successful response is what `GET /api/settings` returns, with the value the
setting falls back to:

```json
{ "settings": { "SITE_NAME": "Jant" } }
```

Environment-only, secret, unknown, specialized content/file keys, and
demo-locked keys return `400` without changing stored settings.

### Upload site avatar and icons

`POST /api/settings/avatar`

Auth: `Session or token`

Content type: `multipart/form-data`

Form fields:

| Field        | Type | Required | Default | Notes                                 |
| ------------ | ---- | -------- | ------- | ------------------------------------- |
| `file`       | file | yes      | —       | Main avatar image: PNG, JPEG, or WebP |
| `favicon`    | file | no       | —       | Favicon `.ico` payload                |
| `appleTouch` | file | no       | —       | Apple touch icon, PNG                 |

Response:

```json
{ "success": true }
```

Notes:

- File storage must be configured or the endpoint returns `500`.
- Omitting `file` returns `400`, as does a file whose contents aren't the image type it names. An SVG is refused.
- On success, this endpoint updates the internal avatar/favicon settings used by site rendering.

### Remove site avatar and related icons

`DELETE /api/settings/avatar`

Auth: `Session or token`

Removes the stored avatar and related favicon settings.

Response:

```json
{ "success": true }
```

---

## Search

Base path: `/api/search`

Search is the author's: it covers every published post, including private posts and replies in a private Thread. Readers search on the `/search` page, which leaves private posts out for anyone signed out.

### Search posts

`GET /api/search`

Auth: `Session or token`

Query parameters:

| Parameter | Type    | Required | Default | Notes                |
| --------- | ------- | -------- | ------- | -------------------- |
| `q`       | string  | yes      | none    | Maximum length `200` |
| `limit`   | integer | no       | `20`    | `1` to `50`          |

Result objects include these fields:

| Field         | Type                                     | Notes                                                                                                    |
| ------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `id`          | `pst_*` string                           | Post ID                                                                                                  |
| `format`      | `note` \| `link` \| `quote`              | Post format                                                                                              |
| `slug`        | string                                   | Canonical slug                                                                                           |
| `snippet`     | string \| omitted                        | Search snippet; may contain `<mark>` tags                                                                |
| `publishedAt` | integer \| `null`                        | Publish timestamp                                                                                        |
| `permalink`   | string                                   | Public path, including any configured site prefix: the post's first custom URL, or `/{slug}` without one |
| `visibility`  | `public` \| `latest_hidden` \| `private` | Resolved visibility, inherited from the Thread's root                                                    |
| `title`       | string \| `null`                         | Present for `note` and `link` results                                                                    |
| `url`         | string \| `null`                         | Present for `note` and `link` results                                                                    |
| `sourceName`  | string \| `null`                         | Present instead of `title` for `quote` results                                                           |
| `sourceUrl`   | string \| `null`                         | Present instead of `url` for `quote` results                                                             |

Response:

```json
{
  "query": "hello",
  "results": [
    {
      "id": "pst_01jpyx3m7gw4w3h7m4bknq0v1d",
      "format": "note",
      "title": "Hello World",
      "slug": "hello-world",
      "snippet": "...matched <mark>hello</mark> text...",
      "publishedAt": 1706000000,
      "permalink": "/hello-world",
      "visibility": "public",
      "url": null
    }
  ],
  "count": 1
}
```

Notes:

- `snippet` may contain `<mark>` tags.
- All search results include `permalink`.
- Quote results use `sourceName` and `sourceUrl` instead of `title` and `url`.
- Search covers published posts only. Drafts don't match.
- Search isn't rate-limited. The per-client limit, `RATE_LIMIT_SEARCH_PER_MIN`, applies to signed-out readers on the `/search` page.

---

## Export

Base path: `/api/export`

### Export the site as a Hugo archive

`POST /api/export/hugo`

Auth: `Session or token`

Request body: none

Response:

- Content type: `application/zip`
- Download filename: `jant-export.zip`

Archive contents:

- `hugo.toml`
- `content/{root-slug}/_index.md` for each thread root (branch bundle)
- `content/{root-slug}/{reply-slug}/index.md` for each reply (leaf bundle, `build.render = "never"`)
- `content/{collection-slug}/_index.md` for each collection
- `content/_index.md`, `content/archive/_index.md`, `content/featured/_index.md`, `content/collections/_index.md`
- `data/jant.toml` (nav, branding, collections directory)
- `themes/jant/layouts/*` and `themes/jant/static/*`
- `README.md`

Notes:

- Each thread root is a Hugo branch bundle; its replies live as nested leaf bundles rendered inline by the thread template.
- Collection membership is exported once per Thread as a top-level `collections` front-matter array on the root bundle, with per-entry `collected_at` / `position` / `pinned_at`. Reply bundles do not repeat it.
- Navigation items, theme CSS, custom CSS, favicon, and Apple touch icon are included in the scaffold when available.
- Exported post bodies become Markdown. Media references point back to the original Jant media URLs; the ZIP does not bundle original media binaries.

Example:

```bash
curl -X POST https://your-site.com/api/export/hugo \
  -H "Authorization: Bearer jnt_YOUR_TOKEN" \
  -o jant-export.zip
```

This export is suitable for:

- static publishing with Hugo
- archival
- round-trip import into another Jant instance

For the CLI import/export workflow, see [Export and Import](export-and-import.md).

---

## Internal Admin API

Base path: `/api/internal`

These endpoints are for hosted control-plane and maintenance workflows, not normal site integrations.

Requirements:

- `Authorization: Bearer <INTERNAL_ADMIN_TOKEN>`
- Some site-management endpoints also require host-based site resolution mode

If `INTERNAL_ADMIN_TOKEN` is not configured, these endpoints return `404`.

Notes:

- `api-tokens` and upload-cleanup endpoints operate on the current resolved site.
- Managed-site lifecycle and domain endpoints return `409` outside host-based mode.

### API token maintenance

#### Health check

`GET /api/internal/api-tokens/health`

Auth: `Internal admin token`

Response:

```json
{ "ok": true }
```

#### Purge all user API tokens for the current site

`POST /api/internal/api-tokens/purge`

Auth: `Internal admin token`

This removes user-created API tokens for the currently resolved site only.

Response:

```json
{ "deleted": 2 }
```

### Upload session maintenance

#### Clean up expired temporary upload sessions

`POST /api/internal/uploads/cleanup`

Auth: `Internal admin token`

Request body:

```json
{ "limit": 10 }
```

Fields:

| Field   | Type    | Required | Default     | Notes                           |
| ------- | ------- | -------- | ----------- | ------------------------------- |
| `limit` | integer | no       | unspecified | Positive integer, maximum `500` |

Notes:

- The JSON body is optional. If the request is not JSON, the endpoint treats it as an empty object.
- File storage must be configured or the endpoint returns `500`.

Response:

```json
{
  "abortedMultipartUploads": 0,
  "deletedSessions": 1
}
```

Response fields:

| Field                     | Type    | Notes                                          |
| ------------------------- | ------- | ---------------------------------------------- |
| `abortedMultipartUploads` | integer | Number of underlying multipart uploads aborted |
| `deletedSessions`         | integer | Number of expired upload-session rows removed  |

### Managed site lifecycle

These endpoints are only available in host-based mode.

#### Create a managed site

`POST /api/internal/sites`

Auth: `Internal admin token`

Request body:

```json
{
  "key": "demo-cloud",
  "primaryHost": "demo-cloud.example.com",
  "siteName": "Demo Cloud",
  "siteLanguage": "en-US",
  "timeZone": "America/New_York"
}
```

Fields:

| Field            | Type   | Required | Default | Notes                                                        |
| ---------------- | ------ | -------- | ------- | ------------------------------------------------------------ |
| `key`            | string | yes      | —       | Lowercase site key, `3-40` chars, letters/numbers/hyphens    |
| `primaryHost`    | string | yes      | —       | Lowercase hostname, max `255`                                |
| `siteName`       | string | yes      | —       | Display name, `1-120` chars after trim                       |
| `siteLanguage`   | string | no       | `en`    | Content locale detected by the control plane                 |
| `timeZone`       | string | no       | `UTC`   | Runtime-supported IANA name or fixed offset such as `+08:00` |
| `idempotencyKey` | string | no       | —       | Retry key, max `128` chars                                   |

Response:

```json
{
  "primaryHost": "demo-cloud.example.com",
  "siteId": "sit_01...",
  "status": "active"
}
```

Notes:

- New managed sites start with `status: "active"`.
- Jant seeds onboarding as completed and stores the provided `SITE_NAME`.
- Valid browser timezone identifiers retain their own IANA or fixed-offset
  semantics instead of being collapsed by the curated settings UI list.
- Unknown optional timezone metadata falls back to UTC and does not fail site
  provisioning. Explicit settings updates still reject invalid timezones.
- Duplicate site keys return `409`.
- Duplicate primary hosts return `409`.

#### Delete a managed site

`DELETE /api/internal/sites/:siteId`

Auth: `Internal admin token`

Response: `204 No Content`

This removes the target site and its associated site-scoped records.

#### Get managed-site media usage

`GET /api/internal/sites/:siteId/media-usage`

Auth: `Internal admin token`

Response:

```json
{
  "siteId": "sit_01...",
  "mediaBytesUsed": 3072
}
```

#### Export a managed site

`GET /api/internal/sites/:siteId/export`

Auth: `Internal admin token`

Response:

- Content type: `application/zip`
- Filename resembles `<site-key>-site-export.zip`
- Export shape matches `POST /api/export/hugo`, but for the specified managed site

#### Suspend a managed site

`POST /api/internal/sites/:siteId/suspend`

Auth: `Internal admin token`

Response:

```json
{
  "siteId": "sit_01...",
  "status": "suspended"
}
```

#### Resume a managed site

`POST /api/internal/sites/:siteId/resume`

Auth: `Internal admin token`

Response:

```json
{
  "siteId": "sit_01...",
  "status": "active"
}
```

### Managed site domains

Domain objects include these fields:

| Field               | Type                 | Notes                     |
| ------------------- | -------------------- | ------------------------- |
| `id`                | string               | Site domain ID            |
| `host`              | string               | Lowercase hostname        |
| `kind`              | `primary` \| `alias` | Domain role for the site  |
| `redirectToPrimary` | boolean              | Whether requests redirect |

#### List domains

`GET /api/internal/sites/:siteId/domains`

Auth: `Internal admin token`

Response:

```json
{
  "domains": [
    {
      "host": "example.com",
      "id": "sdm_01...",
      "kind": "primary",
      "redirectToPrimary": true
    }
  ]
}
```

#### Add a domain

`POST /api/internal/sites/:siteId/domains`

Auth: `Internal admin token`

Request body:

```json
{
  "host": "www.example.com",
  "makePrimary": false
}
```

Fields:

| Field         | Type    | Required | Default | Notes                                         |
| ------------- | ------- | -------- | ------- | --------------------------------------------- |
| `host`        | string  | yes      | —       | Lowercase hostname, max `255`                 |
| `makePrimary` | boolean | no       | `false` | When true, demotes the current primary domain |

Notes:

- Hosts are trimmed and normalized to lowercase.
- Adding a host already attached to this site returns `409`.
- Adding a host already attached to another site returns `409`.

Response: `201 Created` with the full `domains` list.

#### Promote a domain to primary

`POST /api/internal/sites/:siteId/domains/:domainId/primary`

Auth: `Internal admin token`

Response: updated `domains` list.

Notes:

- If the target domain is already primary, the response still returns the current `domains` list.
- Missing `domainId` returns `404`.

#### Delete a domain

`DELETE /api/internal/sites/:siteId/domains/:domainId`

Auth: `Internal admin token`

Response: updated `domains` list.

Notes:

- Deleting the current primary domain without promoting another domain first returns `409`.
- Missing `domainId` returns `404`.

---

## Other Public Endpoints

These are not part of the JSON content-management API, but they are often useful in automation or operations.

| Endpoint                      | Auth   | Response | Notes                                                           |
| ----------------------------- | ------ | -------- | --------------------------------------------------------------- |
| `GET /healthz`                | Public | JSON     | Lightweight liveness probe                                      |
| `GET /readyz`                 | Public | JSON     | Readiness check for startup config and database                 |
| `GET /feed`                   | Public | RSS      | Canonical site feed (`latest` or `featured`, based on settings) |
| `GET /feed/atom.xml`          | Public | Atom     | Canonical site feed in Atom format                              |
| `GET /latest/feed`            | Public | RSS      | Latest public posts feed (accepts `?format=`)                   |
| `GET /featured/feed`          | Public | RSS      | Featured posts feed                                             |
| `GET /archive/feed`           | Public | RSS      | Full archive feed incl. `latest_hidden` (archive filters apply) |
| `GET /feed/latest`            | Public | Redirect | Legacy `308` → `/latest/feed` (preserves query string)          |
| `GET /feed/latest/atom.xml`   | Public | Redirect | Legacy `308` → `/latest/feed`                                   |
| `GET /feed/featured`          | Public | Redirect | Legacy `308` → `/featured/feed`                                 |
| `GET /feed/featured/atom.xml` | Public | Redirect | Legacy `308` → `/featured/feed`                                 |
| `GET /feed/all`               | Public | Redirect | Legacy alias → `/latest/feed`                                   |
| `GET /feed/all/atom.xml`      | Public | Redirect | Legacy Atom alias → `/latest/feed`                              |
| `GET /:slug/feed`             | Public | RSS      | Collection feed for one collection                              |
| `GET /collections/:slug/feed` | Public | RSS      | Collection feed for a collection selection                      |
| `GET /sitemap.xml`            | Public | XML      | Sitemap for published posts                                     |
| `GET /robots.txt`             | Public | Text     | Robots rules and sitemap location                               |
| `GET /api/discover/posts`     | Public | JSON     | Whether posts are still in the feeds a Discover directory reads |

### Health and readiness

#### Liveness

`GET /healthz`

Auth: `Public`

Response:

```json
{ "status": "ok" }
```

This endpoint bypasses site resolution and only answers whether the process is up.

#### Readiness

`GET /readyz`

Auth: `Public`

Response:

```json
{
  "status": "ok",
  "version": "0.7.0-3f9c2a7b1e4d8c60",
  "startedAt": 1789000000,
  "checks": {
    "startupConfig": { "ok": true },
    "database": { "ok": true }
  }
}
```

Notes:

- Returns `200` when all checks pass.
- Returns `503` when `status` is `"error"`.
- `startupConfig.error` and `database.error` appear when a check fails.
- `version` is the package version followed by the first 16 characters of the build's commit id.
- `startedAt` is when the process started serving, in Unix seconds. Node only; absent on Workers.
- This endpoint is stricter than `/health`: it verifies startup configuration and performs a lightweight database query.

### Feeds

Feed endpoints are public and return cached XML with `Cache-Control: public, max-age=60` while `RSS_FEEDS_ENABLED=true`. When disabled, canonical and legacy feed URLs return `404`; previously cached responses may remain available for up to 60 seconds.

Feed notes:

- Feeds are resource-first: a feed lives at `{page}/feed`, the same shape as collection feeds (`/{slug}/feed`). The site root `/` is the only special case — its feed is `/feed`.
- `GET /feed` and `GET /feed/atom.xml` use the configured `MAIN_RSS_FEED` to choose `latest` or `featured`.
- `GET /latest/feed` accepts `?format=note|link|quote`.
- Invalid `format` values are ignored rather than rejected.
- Every feed accepts `?limit=` for one response of a different length, from `1` to `500`; a larger value gets `500`, and a value that is not a positive whole number leaves the site's `RSS_FEED_LIMIT` in place. The feed's `rel="self"` link keeps the address without it.
- Every entry carries `<jant:id>`, the post's ID, beside `<id>`, which is the permalink. The permalink changes when a slug is renamed or the site moves domain; the ID never does.
- Latest feeds include published root posts only, excluding private posts and `latest_hidden` posts.
- Featured feeds include published featured root posts and exclude private posts.
- `GET /archive/feed` returns the complete published record (including `latest_hidden`) and accepts the archive filters `?year=`, `?format=`, `?collection=`, `?media=`, `?title=`, `?replies=`, `?visibility=`, and `?sort=`. A `?collection=` slug that names no collection returns `404`, as the page does — handing back the unfiltered archive under the collection's name would give a subscriber a set they never asked for.
- `GET /feed/latest` and `GET /feed/featured` are kept indefinitely as `308` redirects to the canonical `/latest/feed` and `/featured/feed`, so existing subscribers never break.
- `GET /feed/all` and `GET /feed/all/atom.xml` are legacy aliases that redirect to `/latest/feed` with `308`, preserving the query string.
- `GET /:slug/feed` returns an RSS feed for a single collection.
- `GET /collections/:slug/feed` returns an RSS feed for a collection selection and redirects normalized selections to the canonical path with `301`.
- Pages advertise feeds in the HTML head with `<link rel="alternate" type="application/atom+xml">`. Every page carries the main feed and its counterpart; Collection and Archive pages list their own feed first — the archive one carrying the active filters — so a reader subscribing from the page gets the feed it shows.
- Disabling feeds also removes HTML autodiscovery, Archive and Collection feed buttons, and the built-in RSS navigation item. Saved navigation configuration is retained for later re-enabling.

### Discover post status

`GET /api/discover/posts?id={postId}&id={postId}…`

Auth: `Public`

A Discover directory reads a site's feeds, and a feed shows only its newest entries. When a post the directory holds is missing from one, the feed cannot say whether the post was taken out or pushed past the feed's length, and the permalink cannot say it either: a post hidden from Latest or unfeatured is still a live page. This endpoint answers for each post it is asked about. A directory does not build the address: every feed names it in the `status` attribute of `<jant:discover>`. See [Feeds](feeds.md#asking-about-posts).

Query parameters:

| Parameter | Type                 | Required | Notes                                                                  |
| --------- | -------------------- | -------- | ---------------------------------------------------------------------- |
| `id`      | `pst_*` string       | yes      | Repeat for each post, `1` to `50` of them. The ID from `<jant:id>`     |
| `lang`    | BCP 47 language code | no       | Answer for that language view's feeds. The declared address carries it |

Response:

```json
{
  "posts": [
    {
      "id": "pst_01jpyx3m7gw4w3h7m4bknq0v1d",
      "latest": true,
      "featured": false
    },
    {
      "id": "pst_01jpyx5bq4e0c9t2wq0h6gk3r8",
      "latest": false,
      "featured": false
    }
  ]
}
```

Notes:

- `latest` is whether the post is in the Latest feed; `featured` is whether its Thread is in the featured feed, which holds a Thread when any post in it is featured. Both are decided by the same rules the feeds use, RSS delay included.
- Every ID asked about is answered once, in the order asked. A post that was deleted, made private, moved back to draft, is a reply, or does not exist answers `false` for both.
- Available whenever the site is listed in Discover, whatever `PUBLIC_API_ENABLED` says: it tells nothing the public feeds do not. A site that is not listed answers `404`.
- No IDs, more than `50`, or a value that is not a post ID returns `400`.

### Sitemap and robots

#### Sitemap

`GET /sitemap.xml`

Auth: `Public`

Notes:

- Returns XML with content type `application/xml; charset=utf-8`.
- Includes up to `1000` published root posts.
- Excludes private posts.

#### Robots

`GET /robots.txt`

Auth: `Public`

Notes:

- Returns text with content type `text/plain; charset=utf-8`.
- When `NOINDEX` is enabled, the file disallows the entire site with `Disallow: /`.
- Otherwise it allows the public site and disallows the internal utility prefix `/_/`.
- Always includes an absolute `Sitemap:` line that points at `/sitemap.xml`.

---

## Common Workflows

### Publish a post with an uploaded image

1. Start an upload session:

```bash
curl -X POST https://your-site.com/api/uploads/init \
  -H "Authorization: Bearer jnt_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "photo.jpg",
    "contentType": "image/jpeg",
    "size": 1024000
  }'
```

2. Upload the file using the returned transport.
3. Complete the upload and keep the returned `med_*` ID.
4. Create the post:

```bash
curl -X POST https://your-site.com/api/posts \
  -H "Authorization: Bearer jnt_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "note",
    "title": "Hello World",
    "bodyMarkdown": "First post.",
    "attachments": [
      { "type": "media", "mediaId": "med_01..." }
    ]
  }'
```

### Automate content from a generated site

Projects created with `create-jant` include `examples/agent-content-automation/README.md`.

Use that folder when you want ready-made examples for:

- creating note and quote posts from JSON
- updating editable settings from JSON
- uploading media and attaching the returned `med_*` ID to a post
- calling `/api/mcp` from an MCP-capable agent

Minimum HTTP equivalents (the README has the full set):

```bash
curl -X POST "$JANT_URL/api/posts" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @./examples/agent-content-automation/note.json

curl -X POST "$JANT_URL/api/upload" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -F "file=@./path/to/photo.webp" \
  -F "alt=Cover image"

curl -X PUT "$JANT_URL/api/settings" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @./examples/agent-content-automation/site-settings.json
```

### Migrate content from another system

Recommended order:

1. Create collections first if you want to preserve categories or tags.
2. Upload files and keep the returned media IDs.
3. Create posts with original `publishedAt` timestamps.
4. Use `path` on post creation or `custom-urls` after creation to preserve old URLs.

Migration tips:

- Use `bodyMarkdown` unless you already have TipTap JSON.
- Use `replyToId` to rebuild threads.
- Use `status: "draft"` for unpublished imports.
- The API is not idempotent on its own. If your importer may retry, track created IDs or slugs in your own process.

### Export a site

```bash
curl -X POST https://your-site.com/api/export/hugo \
  -H "Authorization: Bearer jnt_YOUR_TOKEN" \
  -o jant-export.zip
```

---

## GitHub webhooks

GitHub calls these addresses, so they sit in GitHub's settings rather than in any client. Each checks the `X-Hub-Signature-256` signature against its secret and answers `401` when it doesn't match.

| Address                             | GitHub calls it for                                                                                                                    | Secret                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `POST /api/github-sync/webhook`     | Pushes to the repository [GitHub Sync](github-sync.md) is connected to. Jant registers this webhook on the repository when you connect | `GITHUB_APP_WEBHOOK_SECRET` when set, otherwise the secret Jant generated when you connected |
| `POST /api/github-sync/app-webhook` | A GitHub App's installation events: uninstalled, suspended, or repositories removed. You enter it in the App's settings                | `GITHUB_APP_WEBHOOK_SECRET`; the address answers `404` while that isn't set                  |

Both answer `200` to an event they don't act on, such as an event of another kind or a push that holds only Jant's own sync commits, so GitHub doesn't mark the delivery failed.

## Telegram webhook

`POST /api/telegram/webhook/:botId`

Telegram calls this address with the messages people send the site's [Telegram bot](configuration.md#telegram-bot-optional). Jant registers it with Telegram: when you save a bot token under Settings → Telegram, or, for a bot pool, with [`jant telegram register-webhooks`](cli.md#jant-telegram-register-webhooks) or on startup in hosted mode. `:botId` is the number before the colon in the bot's token.

- An unknown `botId` answers `404`, and an `X-Telegram-Bot-Api-Secret-Token` that doesn't match the registered secret answers `401`.
- Every update it accepts answers `200`, even one that fails to publish: the sender gets the error as a chat message, and Telegram doesn't deliver the update again.

---

## Versioning and Stability

The API has no version in its URLs. What this page documents follows Jant's [compatibility promise](compatibility.md), which says what each kind of release may change. `/api/internal/*` connects core to the hosted service and can change in any release.
