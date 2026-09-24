---
name: jant-site
description: >-
  Work with the Jant site identified in this document through its HTTP API or
  MCP interface. Use when the user asks an AI assistant to read, publish, edit,
  organize, search, or migrate content, upload media, manage Collections, or
  update site settings.
---

# Jant Site Skill

This page is written for AI assistants working with one Jant site. Use it when the user asks you to read, publish, edit, organize, search, or migrate site content through Jant's HTTP API or MCP interface.

The full HTTP API reference lives at <https://jant.me/docs/API.md>. This skill explains how to choose the right interface, work safely, understand Jant's content model, and run common workflows. Consult the reference for complete request and response schemas instead of guessing fields.

---

## Scope and Safety

- Use this skill only for the target site identified below. Do not substitute another site without the user's confirmation.
- Start with read-only inspection when the state of the site or the user's intent is unclear.
- Get explicit confirmation before bulk publishing, bulk deletion, destructive settings changes, or any action that is difficult to reverse. A request to perform a specific ordinary write, such as publishing one post, already supplies that confirmation.
- For uncertain or bulk content changes, ask whether to save posts as drafts or publish them immediately.
- Treat API tokens like passwords. Never log, commit, or repeat a token back to the user after they provide it.
- Use the public API or MCP interface. Do not edit the database directly and do not call `/api/internal/*`; those endpoints belong to the hosted control plane.
- Keep bulk writes sequential. Save returned IDs after each successful write so interrupted work can resume without creating duplicates.

---

## Choose an Interface

Jant exposes the same site-owner capabilities through two interfaces:

| Interface               | Use it when                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| HTTP JSON API           | Writing scripts, making a few direct requests, or running a one-time migration. This is the default. |
| MCP at `<site>/api/mcp` | The caller already supports MCP and benefits from tool discovery and structured tool calls.          |

For MCP, call `initialize`, then `tools/list`, and use the returned schemas rather than assuming tool arguments. The tool groups cover posts, media, attachments, Collections, settings, and search.

For HTTP, these are the main entry points:

| Task                         | Endpoint                                                         |
| ---------------------------- | ---------------------------------------------------------------- |
| Read public posts            | `GET /api/public/posts`, `GET /api/public/posts/:slug`           |
| List or inspect all posts    | `GET /api/posts`, `GET /api/posts/:id`                           |
| Create, update, delete       | `POST /api/posts`, `PUT /api/posts/:id`, `DELETE /api/posts/:id` |
| Upload or manage media       | `/api/upload` or `/api/uploads`                                  |
| Manage Collections           | `/api/collections`                                               |
| Search published content     | `GET /api/search`                                                |
| Read or update site settings | `GET /api/settings`, `PUT /api/settings`                         |

Public post, Collection, navigation, and search reads can work without a token. A site can disable anonymous API reads; `/api/public/*` then becomes unavailable, while Collection, navigation, and search JSON reads require a browser session or Bearer token. Private content and all writes always require authentication.

---

## Confirm the Target and Authenticate

Before an authenticated or multi-step operation, confirm:

- The Jant site URL (e.g. `https://example.com`).
- The exact outcome the user wants, including which content may change.
- For bulk work, whether new posts should use `status: "published"` or `status: "draft"`.

Have the user create an API token when the operation needs authentication:

1. Sign in to Jant at `<site>/signin`.
2. Open **Settings → API Tokens**.
3. Create a token and copy it immediately. It is shown only once.

Send the token as `Authorization: Bearer jnt_...`.

```bash
export JANT_API_TOKEN=jnt_...
export JANT_SITE=https://example.com
```

---

## Understand the Content Model

Jant is a single-author microblog. There are no users, comments, likes, followers, or social relationships to manage.

Three concepts shape almost every content operation:

1. **Posts have three formats** — `note`, `link`, and `quote`. Preserve the semantic format instead of coercing everything into `note`.
2. **Threads connect posts** — a reply is a post whose `replyToId` points to another post. There is no separate comments table.
3. **Collections curate Threads** — they are intentional groupings, not tags. A Thread can belong to multiple Collections; its root and replies share the same memberships.

### `note` — original writing

Use for essays, journal entries, status updates, photo posts with captions, and other content written by the site owner.

- Required: `format: "note"`
- Recommended: `bodyMarkdown`
- Optional: `title`

### `link` — a shared reference

Use when the post is fundamentally pointing readers to another resource.

- Required: `format: "link"`, `title`, `url`
- Optional: `bodyMarkdown` for the owner's commentary

### `quote` — a cited passage

Use when the post is built around someone else's words.

- Required: `format: "quote"`, `quoteText`
- Optional: `sourceName`, `sourceUrl`, and `bodyMarkdown` for commentary
- Do not send `title` or `url`; quote posts use `sourceName` and `sourceUrl` instead.

---

## Common Content Operations

Read the current state before modifying existing content. Use `GET /api/posts/:id` when you need fields that may not appear in a list response, including Thread-level Collection memberships.

Create a note with an explicit status and visibility:

```bash
curl -X POST "$JANT_SITE/api/posts" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "note",
    "bodyMarkdown": "Hello from Jant.",
    "status": "published",
    "visibility": "public"
  }'
```

Use `PUT /api/posts/:id` to update a post and `DELETE /api/posts/:id` to delete one. Fetch the post first, preserve fields the user did not ask to change, and confirm before deletion.

Use `POST /api/upload` for an ordinary single-file script or one-time migration. Use the session-based `/api/uploads` flow for large files, unreliable connections, or clients that need resumable transport. Save the returned `med_*` ID before attaching media to a post.

Use `GET /api/settings` before `PUT /api/settings`. Settings values are strings in the HTTP API; preserve settings outside the user's requested change.

For exact fields, filters, pagination, and response schemas, read the [full HTTP API reference](https://jant.me/docs/API.md).

---

## Import Content from Another Platform

Use this workflow when the user wants to move an old blog, site, or archive into this Jant site. The request may arrive as one sentence, with no export and no token yet. Lead the user through the rest.

### Lead the user

Ask for one thing at a time, when the next step needs it. Name the menus the user clicks, not API endpoints.

1. Check that you can send HTTP requests to `<site>` and read files the user gives you. If you cannot, say so first and suggest an assistant that can, such as a coding agent with shell access. Do not hand over a script unless the user asks for one.
2. Ask which platform the old blog is on and where it lives.
3. Get the content. Use an export if the user has one. If not, tell them where their platform exports it (the table under "Read the source" lists the usual places) and wait for the file. When the old blog is public and its feed carries full posts, you can read the feed instead. Feeds usually hold only recent posts, so compare the count with the old blog's archive before relying on one.
4. Ask for the API token just before the first write, using the steps in "Confirm the Target and Authenticate". Do not ask for it at the start.

### Plan before writing

1. Inspect the target site so you know whether it already contains content.
2. Inspect 3–5 representative source posts end to end before deciding how to transform anything.
3. Report what you found: source formats, item counts, dates, media, internal links, categories, and anything unsupported.
4. Ask how to handle ambiguous categories or tags. Map them to Collections, drop them, or fold them into post bodies only with the user's direction.
5. Agree on draft versus published status and on a duplicate policy before creating posts.
6. Build a resumable source-ID map and persist `{ sourceId -> jantId, slug }` after every successful write.

A slug or path collision returns `409 CONFLICT`, but that does not make an import automatically idempotent. Items with new or generated slugs can still be duplicated, so use the source-ID map rather than relying on conflicts.

### Read the source

Common source shapes include:

| Source                | Typical export                                                          |
| --------------------- | ----------------------------------------------------------------------- |
| WordPress             | WXR XML (`Tools → Export`), with media URLs pointing at the source host |
| Ghost                 | JSON export from `Settings → Labs → Export`                             |
| Substack              | ZIP with `posts.csv` and `posts/*.html`                                 |
| Medium                | ZIP with `posts/*.html`                                                 |
| Tumblr                | API dump or `tumblr-utils` archive                                      |
| Hugo / Jekyll / Astro | Markdown files with YAML or TOML front matter                           |
| Notion                | Markdown plus a media ZIP                                               |
| Custom                | SQL dump, HTML folder, RSS feed, or another structured source           |

Do not assume the source schema from the platform name alone. Check titles, bodies, dates, embedded media, internal links, categories, and source identifiers in real records.

### Map source formats

Use these heuristics as a starting point:

- WordPress, Ghost, and Substack standard posts → `note` with `title` and `bodyMarkdown`.
- Linklog posts that are primarily an external URL plus commentary → `link`.
- WordPress or Tumblr quote posts → `quote`.
- Tumblr photo posts with captions → `note` with uploaded images.
- Tumblr link posts → `link`.
- Reblogs or reposts → ask the user. Jant has no native reblog concept; `quote` with `sourceUrl` is often the closest representation.

When uncertain, prefer `note`. Turning a real `link` or `quote` into a `note` loses semantic information, while turning original writing into a `link` or `quote` invents structure.

### Convert bodies to Markdown

Send `bodyMarkdown`, not `body`. The `body` field expects TipTap JSON and is intended for editor integrations.

- Convert HTML with a real HTML-to-Markdown tool such as Turndown or Pandoc. Do not strip tags with regular expressions.
- Preserve headings, lists, tables, fenced code blocks, blockquotes, and inline formatting.
- A blank line starts a new paragraph. Use two trailing spaces or a backslash for a hard line break.
- Preserve `<!--more-->` when the source has an intentional excerpt break.
- Upload embedded media to Jant instead of leaving remote `<img>` references that may disappear with the old site.
- Rewrite internal links after the destination slugs are known. Either build the slug map first or use a two-pass process: create posts, then update their bodies.

### Upload media first

Posts reference uploaded media by `med_*` ID. For a one-time migration, the one-shot endpoint is usually enough:

```bash
curl -X POST "$JANT_SITE/api/upload" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -F "file=@./photo.jpg" \
  -F "alt=A red door"
# → { "id": "med_...", "url": "/media/med_....jpg", ... }
```

Use `/api/uploads` when a file is large or the connection is unreliable. Its session flow initializes the upload, transfers one or more parts, optionally adds a video poster, and completes the session to produce the final `med_*` record.

Preserve source alt text. If the source has no alt text, leave it unset rather than inventing a description.

### Create Collections when needed

Create approved Collections before the posts that use them:

```bash
curl -X POST "$JANT_SITE/api/collections" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "reading",
    "title": "Reading",
    "description": "Books worth coming back to",
    "sortOrder": "newest"
  }'
```

Save each returned `col_*` ID. Send `collectionIds` on standalone posts and Thread roots, not on replies.

### Create posts

`POST /api/posts` creates every post format. Send one post at a time and record the result before continuing.

Minimal `note`:

```json
{
  "format": "note",
  "title": "Hello world",
  "bodyMarkdown": "First post on the new site.",
  "publishedAt": 1706000000,
  "status": "draft"
}
```

Minimal `link`:

```json
{
  "format": "link",
  "title": "An interesting article",
  "url": "https://example.com/post",
  "bodyMarkdown": "Worth your fifteen minutes."
}
```

Minimal `quote`:

```json
{
  "format": "quote",
  "quoteText": "What stands in the way becomes the way.",
  "sourceName": "Marcus Aurelius",
  "sourceUrl": "https://example.com/meditations"
}
```

Fields commonly needed during migration:

| Field           | Purpose                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ |
| `publishedAt`   | Original publication time as Unix seconds, preserving archive chronology.                  |
| `slug`          | Original stable slug when it should remain the canonical URL.                              |
| `path`          | Alternative to `slug` for an original path such as `2024/01/hello-world`; never send both. |
| `status`        | `published` or `draft`; set it explicitly according to the import plan.                    |
| `visibility`    | `public`, `latest_hidden`, or `private`.                                                   |
| `pinned`        | Preserve a pinned state when the source had one; replies cannot be pinned.                 |
| `featured`      | Preserve a featured or starred state when it has the same meaning.                         |
| `collectionIds` | Approved `col_*` IDs on standalone posts and Thread roots.                                 |
| `attachments`   | Ordered media or text attachments.                                                         |
| `replyToId`     | Destination `pst_*` ID of the parent when importing a Thread reply.                        |

Remember these validation rules:

- Send either `body` or `bodyMarkdown`, never both.
- Send either `slug` or `path`, never both.
- `note` rejects link- and quote-specific fields.
- `link` requires `title` and `url`.
- `quote` requires `quoteText`, uses `sourceName` and `sourceUrl`, and rejects `title` and `url`.

A successful create returns `201` with the full post. Save `id`, `slug`, and `threadId` under the source ID for replies, link rewriting, verification, and recovery.

### Rebuild Threads

1. Import the Thread root first.
2. Import replies in parent-first order with `replyToId` set to the destination parent's `pst_*` ID.
3. Do not set `threadId`; Jant derives it from `replyToId`.
4. Set `collectionIds` on the root only. Replies share the Thread's Collection memberships.
5. Replies inherit root visibility and status unless explicitly created as drafts. They cannot be pinned or receive independent visibility changes.

### Verify and report

After the import:

- Compare source and destination counts by format, media type, Collection, and Thread.
- Fetch representative posts through `GET /api/posts/:id` and verify dates, slugs, bodies, attachments, Collection memberships, and reply relationships.
- Open representative public URLs and verify rendered Markdown, media, and rewritten internal links.
- Report anything skipped, transformed, duplicated, or unresolved, with a short list of URLs for manual review.

If an import stops partway through, resume from the persisted source-ID map. If cleanup is required, identify only the posts, media, and Collections created by that run, show the user the cleanup scope, and get confirmation before deleting them. Do not use account deletion as an automated recovery strategy.

---

## Handle Errors

HTTP API errors use this shape:

```json
{ "error": "...", "code": "VALIDATION_ERROR", "details": {} }
```

| Code                  | Response                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`    | Read `details.fieldErrors`, correct the request, and do not retry unchanged input.                |
| `UNAUTHORIZED`        | Stop. The token is missing, invalid, or revoked; ask the user to create or provide a valid token. |
| `FORBIDDEN`           | Stop and explain which operation was denied. Do not look for an internal bypass.                  |
| `NOT_FOUND`           | Re-check the target site and resource ID before deciding whether the item was removed.            |
| `CONFLICT`            | Resolve the reported state conflict; never silently change a user-selected canonical slug.        |
| `RATE_LIMIT`          | Respect `Retry-After` when present, back off, and keep bulk writes sequential.                    |
| `CONFIGURATION_ERROR` | Surface the server message; the site owner may need to correct deployment configuration.          |

For MCP, transport and protocol failures use JSON-RPC errors. Tool validation and domain failures are returned as tool results with `isError: true`; inspect their structured content before retrying.

---

## Reference

- Full HTTP API: <https://jant.me/docs/API.md> — endpoints, fields, filters, and response schemas.
- Automation overview: <https://jant.me/docs/automation-and-api.md> — tokens, HTTP, MCP, and debugging.
- Round-trip Jant exports: <https://jant.me/docs/export-and-import.md> — use `site export` and `site import` when both ends are Jant.
- Public documentation index: <https://jant.me/docs/SUMMARY.md>.
