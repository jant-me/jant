# Jant Import Skill

This page is written for AI assistants. If a human is reading you this URL, they are asking you to migrate content from another blog or CMS into a Jant site. Follow the steps below.

The full HTTP API reference lives at <https://jant.me/docs/API.md>. This file is the focused subset you need for content imports, plus opinionated guidance on how to map common source formats onto Jant's data model.

---

## What Jant Is

Jant is a single-author microblog. There are no users to import, no comments, no likes, no followers. You are moving **content** — posts, media, and the way they are grouped.

Three things to understand before you start:

1. **Posts come in three formats** — `note`, `link`, `quote`. Pick the right one per source item; do not coerce everything into `note`.
2. **Threads** are how connected thoughts stay together. A reply is a post with `replyToId` pointing at another post. There is no separate "comments" table.
3. **Collections** are curated groupings (like "Reading" or "Design"). They are not tags. A Thread can belong to multiple collections; its root and replies share the same memberships.

If the source has tags or categories, ask the user whether to map them to collections, drop them, or fold them into post bodies. Do not invent collections silently.

---

## Step 1: Confirm the Target and Get a Token

Before writing any code, confirm with the user:

- The Jant site URL (e.g. `https://notes.example.com`).
- That the **target site is empty**, or that they accept duplicates erroring out. The HTTP API does not require an empty site, but slug collisions return `409 CONFLICT`.
- Whether to publish posts immediately (`status: "published"`) or import as drafts (`status: "draft"`) for review.

Then have the user create an API token:

1. Sign in to Jant at `<site>/signin`.
2. Open **Settings → API Tokens**.
3. Create a token. It is shown once — copy it immediately.

The token is used as `Authorization: Bearer jnt_...`. Treat it like a password. Do not log it, do not commit it, do not paste it back to the user in plain text after they share it with you.

```bash
export JANT_API_TOKEN=jnt_...
export JANT_SITE=https://notes.example.com
```

---

## Step 2: Read the Source

Identify what you have. Common shapes:

| Source                | Typical export                                                          |
| --------------------- | ----------------------------------------------------------------------- |
| WordPress             | WXR XML (`Tools → Export`), with media URLs pointing at the source host |
| Ghost                 | JSON export from `Settings → Labs → Export`                             |
| Substack              | ZIP with `posts.csv` and `posts/*.html`                                 |
| Medium                | ZIP with `posts/*.html`                                                 |
| Tumblr                | API dump or `tumblr-utils` archive                                      |
| Hugo / Jekyll / Astro | Markdown files with YAML/TOML front matter                              |
| Notion                | Markdown + media ZIP                                                    |
| Custom                | A SQL dump, a folder of HTML, an RSS feed, …                            |

Always inspect a few items first. Do not assume schema — read 3-5 source posts end to end so you understand titles, bodies, dates, embedded media, internal links, and categories before you start transforming anything. Tell the user what you found.

---

## Step 3: Map Source Items to Jant Post Formats

This is the most important decision in the migration. Jant's three formats are not interchangeable.

### `note` — original writing

The default. Use this when the user wrote the content themselves: essays, journal entries, status updates, photo posts with a caption, anything that is "the user's own words."

Required: nothing beyond `format: "note"`.
Recommended: `bodyMarkdown`, optional `title`.

### `link` — a shared reference

Use this when the source item is fundamentally "look at this thing on the internet": link blogs, reading lists, "interesting article" posts. The post's identity is the external URL.

Required: `format: "link"`, `title`, `url`.
Optional: `bodyMarkdown` for the user's commentary on the link.

### `quote` — a quoted passage with attribution

Use this when the post is built around someone else's words: a pulled quote with attribution. **Do not** use `title`/`url` here — quote posts use `sourceName`/`sourceUrl` instead, and the API will reject `title` on a quote.

Required: `format: "quote"`, `quoteText`.
Optional: `sourceName`, `sourceUrl`, `bodyMarkdown` for the user's commentary on the quote.

### Heuristics for common sources

- **WordPress / Ghost / Substack standard posts** → `note` (with `title` and `bodyMarkdown`).
- **Linklog posts that are mostly a URL plus a sentence** → `link`.
- **"Quote" post type in WordPress / Tumblr** → `quote`.
- **Tumblr photo posts with a caption** → `note` with images as attachments.
- **Tumblr link posts** → `link`.
- **Tumblr quote posts** → `quote`.
- **Reblogs / reposts** → ask the user. Jant does not have a native reblog concept; usually map to `quote` with `sourceUrl` pointing at the original.

When in doubt, default to `note`. Coercing a real `link` or `quote` post into `note` loses semantic information; coercing a `note` into `link` or `quote` invents structure that was not there.

---

## Step 4: Convert Bodies to Markdown

Send `bodyMarkdown`, not `body`. The `body` field expects TipTap JSON and is intended for the editor; `bodyMarkdown` is the supported scripted-import path.

Conversion notes:

- **HTML source → Markdown**: use a real HTML-to-Markdown converter (turndown, pandoc, etc.). Do not regex-strip tags. Preserve headings, lists, tables, code blocks, blockquotes, and inline formatting.
- **Line breaks**: a single newline stays inside the same paragraph; a blank line starts a new paragraph; trailing two-spaces or a backslash before the newline forces a hard break. Standard CommonMark rules.
- **Excerpt break**: `<!--more-->` is honored as an excerpt cut point.
- **Embedded images and videos**: do not leave them as remote `<img src="...">` tags. Upload the media to Jant first (Step 5), then reference the returned `med_*` ID either as an inline image in `bodyMarkdown` (using the media URL the upload returns) or as an entry in the post's `attachments` array. Inline images render inside the body; attachments render as a gallery below it. Pick the one that matches how the source displayed them.
- **Internal links**: rewrite cross-post links to the new Jant slugs once you know them. Plan a two-pass import (create posts → rewrite bodies) or build a slug map up front.
- **Code blocks**: keep them fenced with the language hint.

---

## Step 5: Upload Media First

Posts reference media by `med_*` ID. Upload media before the post that uses it.

The recommended modern flow (`/api/uploads`) is a 4-step session:

1. `POST /api/uploads/init` with `{ filename, contentType, size }` → returns an upload session ID and a transport descriptor.
2. Upload the file body using the transport (`relay`, `multipartRelay`, or `put`).
3. Optionally `PUT /api/uploads/:id/poster` for video poster frames.
4. `POST /api/uploads/:id/complete` → returns the final `med_*` ID and URL.

If you are writing a one-off migration script and want less ceremony, the **legacy one-shot endpoint** is fine and much shorter:

```bash
curl -X POST "$JANT_SITE/api/upload" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -F "file=@./photo.jpg" \
  -F "alt=A red door"
# → { "id": "med_...", "url": "/media/med_....jpg", "mimeType": "image/jpeg", "size": 1024000 }
```

Use this for migrations unless the source has files large enough to need multipart (the upload size limit defaults to 1024 MB, configurable via `UPLOAD_MAX_FILE_SIZE_MB`). For new application code, prefer `/api/uploads`.

Always set `alt` for images when the source has it (WordPress `_wp_attachment_image_alt`, Ghost `alt`, etc.). If the source has no alt text, do not invent one — leave it null.

---

## Step 6: Create Collections (If Needed)

If you are mapping source categories or tags to Jant collections, create the collections **before** the posts that go in them.

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
# → 201 Created with the collection object including its col_* id
```

Save the returned `col_*` IDs; pass them in `collectionIds` on each standalone post or Thread root.

`slug` must be lowercase `a-z`, `0-9`, and `-`, max 200 chars. `title` is max 120. `sortOrder` is one of `newest`, `oldest`, `rating_desc`.

---

## Step 7: Create Posts

`POST /api/posts` is the single entry point for creating any post format. Send one post at a time; there is no bulk endpoint.

Minimal `note`:

```json
{
  "format": "note",
  "title": "Hello world",
  "bodyMarkdown": "First post on the new site.",
  "publishedAt": 1706000000
}
```

Minimal `link`:

```json
{
  "format": "link",
  "title": "Why I left Twitter",
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

Common fields you will set during a migration:

| Field           | Why it matters in a migration                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `publishedAt`   | Unix **seconds**. Set this to the original post's publish date so the new archive preserves chronology.                   |
| `slug`          | Send the original slug if the source has stable URLs you want to preserve. Otherwise let Jant auto-generate from `title`. |
| `path`          | Alternative to `slug` for paths like `2024/01/hello-world` — Jant slugifies it for the canonical URL and stores an alias. |
| `status`        | `published` (default) or `draft`. Use `draft` if the user wants to review before going live.                              |
| `visibility`    | `public` (default), `latest_hidden` (excluded from the homepage feed but still reachable), or `private`.                  |
| `pinned`        | Pre-pin a post if the source had it pinned. Replies cannot be pinned.                                                     |
| `featured`      | Pre-feature a post if the source had a "starred"/"featured" concept.                                                      |
| `collectionIds` | Array of `col_*` IDs from Step 6. Set this on standalone posts and Thread roots; omit it on replies.                      |
| `attachments`   | Ordered media + text attachments. See below.                                                                              |
| `replyToId`     | If the source has threaded posts, set this to the parent post's `pst_*` ID to make this post a reply (see Threads below). |

Attachments are ordered:

```json
{
  "attachments": [
    { "type": "media", "mediaId": "med_...", "alt": "Cover image" },
    {
      "type": "text",
      "contentFormat": "markdown",
      "content": "# Footnote\n\nExtra context.",
      "summary": "Optional summary"
    }
  ]
}
```

Mutually exclusive rules to remember (the API enforces them):

- `body` xor `bodyMarkdown` — never both.
- `slug` xor `path` — never both.
- `note` posts reject `url`, `quoteText`, `sourceName`, `sourceUrl`.
- `link` posts require `title` + `url`.
- `quote` posts require `quoteText`, use `sourceName`/`sourceUrl`, and reject `title`/`url`.

A successful create returns `201` with the full post object. Save `id`, `slug`, and `threadId` keyed by source ID — you will need them for thread replies, internal-link rewriting, and reporting.

---

## Step 8: Threads

If the source has threaded or reply-style posts (Twitter exports, Tumblr conversation threads, custom CMS reply chains):

1. Import the thread root first as a normal post.
2. Import each reply with `replyToId` set to the parent's `pst_*` ID. The reply can point at the root or at another reply — Jant resolves the thread.
3. Replies inherit the root's `visibility` and `status` unless explicitly created as `draft`. They cannot be `pinned`. They reject direct `visibility` changes.
4. Set `collectionIds` on the root only. Every reply projects that same Thread-level membership set; do not replay per-post collection assignments.

You do not set `threadId` on creation; Jant computes it from `replyToId`.

---

## Step 9: Verify

After import, sanity-check from the user's perspective:

- `GET /api/public/posts?limit=5` returns the most recent posts. Spot-check titles, slugs, dates, and bodies.
- `GET /api/posts/:id` for a few specific posts to confirm `attachments`, `collectionIds`, `pinnedAt`, `featuredAt`, and `replyToId`.
- Open one or two URLs in a browser to confirm rendered HTML, embedded media, and internal links resolve.

Report to the user:

- Counts: how many posts of each format, how many collections, how many media items, how many threads.
- Anything you skipped and why (unknown post types, missing media, broken source links).
- A short list of slugs to verify manually.

---

## If You Need to Start Over

First-time bulk migrations often need 2-3 attempts before the mapping is right. If the script halted halfway, posts came out wrong, or the user wants to re-run with a different mapping, the cleanest reset is through Settings:

**Settings → Account & Data → Delete Account**

This wipes posts, media, collections, and settings for the site, and also deletes the account itself. The user will:

1. Be forced to download a `site export` ZIP first (they can ignore it if there's nothing worth keeping — it's a safety net for users with real data).
2. Type a confirmation phrase like `I want to delete <site name>`.
3. Click the destructive button.
4. Sign up again, create a new API token, and re-run the import.

This is heavier than a "wipe content only" button (which Jant does not currently expose), but for a failed first-time migration where there is no real data to preserve, it is the right tool. Tell the user to use this path if their import is in a bad state — do not try to clean up post-by-post via `DELETE /api/posts/:id`, that is slow and easy to do wrong.

If the user has good content alongside the failed import attempt, do **not** suggest Delete Account. Instead, identify the specific posts/media/collections you created, and delete those individually via the API.

---

## Error Handling

Errors come back as:

```json
{ "error": "...", "code": "VALIDATION_ERROR", "details": {} }
```

Handle these explicitly during a migration:

| Code                  | What to do                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`    | Read `details.fieldErrors`. Usually a format-mismatch (e.g. `title` on a `quote`) or a length cap.         |
| `UNAUTHORIZED`        | Token missing, wrong, or revoked. Stop; ask the user to recreate the token.                                |
| `CONFLICT`            | Duplicate slug or path. Either change the slug, fall back to auto-generation, or skip if already imported. |
| `RATE_LIMIT`          | Back off and retry. Add a small delay between requests for large migrations.                               |
| `CONFIGURATION_ERROR` | Server-side; surface the message to the user — they likely need to fix env config.                         |

For long migrations, write a resumable script: persist `{ sourceId → jantId }` to disk after each successful post so you can re-run without duplicates.

---

## What Not to Do

- Do not invent collections, tags, or threads that were not in the source.
- Do not coerce every post into `note`. Honor `link` and `quote` semantics.
- Do not skip media uploads and leave remote `<img>` tags pointing at the old host. The old host may go away.
- Do not edit the database directly. Use the HTTP API.
- Do not assume the import is idempotent. The API will reject duplicate slugs with `409`. Build a resume map.
- Do not call `/api/internal/*` — that is for the hosted control plane, not for site owners.

---

## Reference

- Full HTTP API: <https://jant.me/docs/API.md> — every endpoint, every field.
- Round-trip exports between Jant sites: <https://jant.me/docs/export-and-import.md> — use `site export` / `site import` instead of this skill when both ends are Jant.
- Sitemap of public docs: <https://jant.me/docs/SUMMARY.md>.
