# Featured Page + Roundtrip Refactor

Give `/featured/` native pagination via a `feed=featured` taxonomy term,
and make export/import **lossless** for featured/pinned state, collection
membership (with `collected_at`, `position`, per-collection `pinned_at`),
and reply-level featured/pinned state. Collection membership is shared by the
whole Thread and serialized on its root. Reorganize Jant-private
frontmatter under `extra.jant.*` and switch the reply marker to a
JSON-inside-HTML-comment format so nested data stops fighting with
attribute escaping.

## Context & Why

Two problems sit on top of each other:

1. **`/featured/` has no pagination.** The current `featured.html` renders
   `root.pages | filter(attribute="extra.featured", value=true)` in one
   unpaginated list (`export.ts:1652`). Every other listing page —
   `/`, `/archive/`, `/feed/unlisted/`, collections — is already paginated
   through the `feed` taxonomy or a section paginator. Featured is the odd
   one out.

2. **Export is lossy on multiple axes**, all visible after one round-trip
   through `jant site export | jant site import`:
   - `featuredAt` (timestamp, `schema.ts:155`) is exported as bare
     `extra.featured = true` — recency ordering collapses to `now()` on
     reimport.
   - `pinnedAt` has the same bug via `extra.pinned = true`.
   - Reply markers (`<!-- jant:reply ... -->` in `export.ts:687-707`) carry
     no `featured` or `pinned` attributes, so those reply states are lost on
     export. Legacy reply-level Collection entries are folded into the shared
     Thread union during import rather than serialized on replies again.
   - `thread_collection.createdAt` (= "collected_at"), `position`, and
     `pinnedAt` (collection-level pin, independent from global pin) are
     not exported at all — only the bare slug list in `taxonomies.collections`
     and a bool-only `extra.collection_pins`. Import resets `createdAt` to
     `now()` and ignores `collection_pins` entirely.

The data model supports shared Thread Collections, reply featured state, and
per-collection pin timestamps. The serialization layer must keep Collection
metadata on the Thread root and preserve legacy reply memberships by union.

Since Jant is pre-1.0, this refactor does **not** preserve
backward compatibility with the previously committed canonical fixture.
Export format is redefined cleanly; the fixture is regenerated in the same
commit.

## Format spec

### Root post frontmatter (TOML)

All Zola-consumed fields stay where Zola expects them. All Jant-private
structured data collapses under `extra.jant`.

```toml
+++
title = "Weekend baking notes"
date = "2026-02-10T14:30:00Z"
updated = "2026-02-15T09:00:00Z"
slug = "weekend-baking-notes"

# Optional: when Zola needs redirect aliases for merged reply URLs
aliases = ["/old-slug", "/reply-1"]

# Zola taxonomies — used for routing and pagination. "featured" is new.
[taxonomies]
collections = ["home-cooking", "weekend-notes"]
feed = ["public", "archive", "featured"]

# Fields the Zola theme still reads directly stay at [extra] root.
[extra]
format = "note"
status = "published"
visibility = "public"
summary_text = "..."
# link / quote specific:
# link_url = "..."
# source_name = "..."
# source_url = "..."
# quote_text = "..."
# rating = 5

# Everything Jant-private goes under extra.jant. Zola templates that want
# any of these read them here explicitly; no implicit coupling.
[extra.jant]
featured_at = "2026-03-15T10:00:00Z"      # null/absent = not featured
pinned_at = "2026-03-10T08:00:00Z"        # null/absent = not pinned
root_aliases = ["/old-slug"]              # unchanged: already namespaced

[[extra.jant.collections]]
slug = "home-cooking"
collected_at = "2026-02-01T12:00:00Z"
position = 3
pinned_at = "2026-02-20T09:00:00Z"        # omitted when not pinned in this collection

[[extra.jant.collections]]
slug = "weekend-notes"
collected_at = "2026-02-10T14:30:00Z"
position = 7
+++
```

Removed:

- `extra.featured` (bool) — replaced by `extra.jant.featured_at`
- `extra.pinned` (bool) — replaced by `extra.jant.pinned_at`
- `extra.collection_pins` — replaced by per-entry `pinned_at` in
  `extra.jant.collections[]`

`taxonomies.collections` still carries a slug list so Zola can route
`/{collection-slug}/` pages. Timestamps/positions never enter Zola's
taxonomy layer.

### Reply marker

Switch from HTML-attribute to multi-line HTML comment with JSON body:

```markdown
<!--jant:reply
{
  "date": "2026-03-15T10:00:00Z",
  "slug": "my-reply",
  "format": "note",
  "status": "published",
  "visibility": "public",
  "featured_at": "2026-03-15T10:00:00Z",
  "pinned_at": null,
  "rating": null,
  "title": null,
  "url": null,
  "quote_text": null,
  "source_name": null,
  "source_url": null,
  "collections": [
    {
      "slug": "city-walks",
      "collected_at": "2026-02-01T12:00:00Z",
      "position": 3,
      "pinned_at": "2026-02-20T09:00:00Z"
    }
  ]
}
-->
```

Rationale:

- HTML comment — disappears from the rendered public HTML (Zola's default
  markdown pipeline doesn't emit raw comments into templates that use
  `{{ page.content }}`; and even when emitted, browsers don't render
  them).
- JSON body — nested collection entries work natively, no nested quoting.
- Adding a new field is a JSON field, not a new attribute regex branch.
- The preceding visual decoration (`---` + `<time>...</time>` from
  `export.ts:676-682`) is unchanged — it's already stripped on import by
  `stripTrailingReplyDecoration` (`zola-markdown.ts:111`).

Defensive encoding: `export` must `replaceAll("-->", "--\\u003e")` on the
JSON string before wrapping it in the comment. JSON's `\uXXXX` escape
parses back to `>` on read. Without this, a quoted `-->` inside any
string field would prematurely close the comment. In practice this is
almost never triggered, but we do it once on write so readers never have
to care.

### Feed taxonomy terms

`feedTermsForPost` becomes additive for the featured dimension:

| Jant state                         | Feed terms                      |
| ---------------------------------- | ------------------------------- |
| `public`, not pinned, not featured | `public`, `archive`             |
| `public`, not pinned, **featured** | `public`, `archive`, `featured` |
| `public`, **pinned**, not featured | `pinned`, `archive`             |
| `public`, **pinned**, **featured** | `pinned`, `archive`, `featured` |
| `latest_hidden` (unlisted)         | `unlisted`                      |
| `private`                          | (none — drafted)                |

`featured` is orthogonal to the public/pinned/archive axis. A pinned
featured post appears on `/` (via manual pinned prepend),
`/feed/pinned/`, `/feed/archive/page/N/`, and `/feed/featured/page/N/` —
all intentional.

### URL scheme

| URL                           | Rendered by                                                      |
| ----------------------------- | ---------------------------------------------------------------- |
| `/`                           | `index.html` — pinned + first page of `feed=public`              |
| `/feed/public/page/N/`        | Zola native paginator (N ≥ 2)                                    |
| `/featured/`                  | `featured.html` — manual render of first page of `feed=featured` |
| `/feed/featured/page/N/`      | Zola native paginator (N ≥ 2)                                    |
| `/archive/`                   | `archive.html` — manual render of first page of `feed=archive`   |
| `/feed/archive/page/N/`       | Zola native paginator (N ≥ 2)                                    |
| `/feed/pinned/`               | taxonomy_single (rarely browsed directly)                        |
| `/feed/unlisted/`             | taxonomy_single with `<meta robots=noindex>`                     |
| `/{post-slug}/`               | `page.html`                                                      |
| `/{collection-slug}/`         | collection taxonomy term page                                    |
| `/collections/{slug}/page/N/` | collection paginator                                             |

`/featured/` URL is preserved for nav item parity with the existing
`systemKey === "featured"` mapping in `export.ts:1000`.

## Files changed (overview)

### Core services (behavior)

- **`packages/core/src/services/post.ts`** — `createWithAttachments` /
  `update` payloads accept `featuredAt?: number | null` and
  `pinnedAt?: number | null` directly (current `featured`/`pinned` bools
  become unused and can be removed; drop them, no backward compat).
- **`packages/core/src/services/collection.ts`** — `addThread` accepts
  `addThread(collectionId, threadId, opts?: { createdAt?, position?, pinnedAt? })`.
  New internal helper `syncThreadCollectionsWithMeta(threadId, entries: CollectionEntryInput[])`
  used by import to set `createdAt`/`position`/`pinnedAt` per entry in one
  transaction. Existing callers (admin UI) pass no opts and get
  `now()`-based defaults — unchanged behavior.

### Export

- **`packages/core/src/services/export.ts`**
  - `feedTermsForPost` becomes `feedTermsForPost(post: Pick<Post, "visibility" | "pinnedAt" | "featuredAt">)` and appends `"featured"` when `featuredAt !== null`.
  - `buildPostMarkdown` rewrites frontmatter emitter:
    - Drop `extra.pinned`, `extra.featured`, `extra.collection_pins`.
    - Emit `[extra.jant]` with `featured_at` / `pinned_at` (ISO) when set.
    - Emit `[[extra.jant.collections]]` array with per-entry
      `slug` / `collected_at` / `position` / `pinned_at`.
  - Reply serialization emits the new JSON comment with `featured_at` and
    `pinned_at`; Collection entries stay on the Thread root only.
  - Fetch Collection entries by Thread root and reuse that single membership
    set for the exported Thread.
  - `featured.html` template: manual render of first page of
    `feed=featured`, links to `/feed/featured/page/N/` for N ≥ 2.
  - `index.html` template: always pull from `feed=public`; featured stays on
    its dedicated page.
  - `taxonomy_single.html`: add `featured` case for the page title.
  - Templates that used `extra.pinned` / `extra.featured` /
    `extra.collection_pins` switch to `extra.jant.pinned_at` /
    `extra.jant.featured_at` / `extra.jant.collections`. Truthiness tests
    become `!= null` / presence checks against the new timestamps.

### Shared markdown

- **`packages/core/src/lib/zola-markdown.ts`**
  - Rewrite `splitReplies`: regex changes from
    `/<!-- jant:reply (.*?) -->/g` to a multi-line match
    `/<!--jant:reply\n([\s\S]*?)\n-->/g`, then `JSON.parse` the captured
    payload after reversing the `--\u003e` → `-->` defensive escape.
  - `ReplySegment.attrs` type changes from `Record<string, string> | null`
    to a strongly-typed `ReplyMeta | null` (shared with export).

### Import

- **`packages/core/bin/commands/import-site.js`**
  - `postData` drops `pinned`/`featured` bools. Read
    `extra.jant.featured_at` / `pinned_at` and pass them straight through
    as `featuredAt` / `pinnedAt` ISO strings (or `null`) to `createPost`
    — the API schema normalizes ISO → Unix seconds at the route layer,
    so the CLI doesn't own that conversion.
  - Read `extra.jant.collections[]`. If present, pass structured entries
    to the post service instead of `collectionIds`. If absent, fall back
    to `taxonomies.collections` slug list with no timestamp metadata
    (tolerates hand-authored Zola sites, not a compat shim for Jant's own
    output).
  - `replyData` gains `featuredAt` and `pinnedAt` parsed from the reply JSON.
    `replySegment.attrs` is now an object
    with typed fields, not a flat string map.
  - Union any legacy root/reply Collection entries before creating the root;
    reply `createPost` calls omit Collection membership.

### Theme

- **Remove `themes/jant/templates/featured.html`'s ad-hoc filter**; replace
  with manual-first-page + paginator pattern (mirrors `archive.html`).
- Any template reads of `page.extra.pinned`, `page.extra.featured`,
  `page.extra.collection_pins` migrate to
  `page.extra.jant.pinned_at != null`, `page.extra.jant.featured_at != null`,
  and iterating `page.extra.jant.collections`.
- `macros.html` post-footer: `page.extra.jant.featured_at != null` instead of
  `page.extra.featured`.

### Tests

- **`packages/core/src/__tests__/export-service.test.ts`**
  - Featured post emits `feed=[..., "featured"]`.
  - Frontmatter uses `extra.jant.featured_at` ISO, not `extra.featured`.
  - Collection membership emits `[[extra.jant.collections]]` with
    `collected_at`, `position`, and `pinned_at` when set.
  - Reply marker is a multi-line HTML comment with valid JSON, including
    `featured_at` / `pinned_at` but no per-reply Collection list.
- **New `packages/core/src/__tests__/export-import-roundtrip.test.ts`**
  - Seed DB: root post featured at T1, pinned at T2, in collection A
    (collected at T3, pinned in A at T4, position 5) and collection B.
    Reply featured at T5; the Thread shares the root's Collection set.
  - Export, re-import into a fresh DB, assert all timestamps, positions,
    and pinning flags match exactly.
- **`packages/core/src/services/__tests__/post.test.ts`** and
  **`collection.test.ts`** — cover the new `featuredAt`/`pinnedAt`
  direct-timestamp path and `addThread` with opts.

### Docs

- **`docs/internal/theme-export.md`** — update the feed taxonomy table
  to include `featured`, document `extra.jant.*` layout, link to the new
  reply marker spec.
- **`docs/export-and-import.md`** — user-facing note on the new
  frontmatter shape and round-trip guarantees.

### Canonical fixture

- Regenerate `sites/demo-source/canonical/site-export/` with
  `mise run demo-source-export-canonical-site-export`. Commit the diff in
  the same change.

## Implementation order

1. **Service layer: internal representation is timestamps only.**
   - `post.ts` create/update internals store `featuredAt: number | null`
     / `pinnedAt: number | null` (already the DB shape — `schema.ts:154-155`).
     Drop the internal `featured` / `pinned` bool path.
   - **API schema (route / zod layer) accepts both**:
     `featured?: boolean` and `featuredAt?: string | null` (same pair for
     pinned). Normalize at one entry point — preferably via a zod
     `.transform()` on the request schema — so the service method only
     sees `featuredAt: number | null | undefined`. Precedence rule:
     - `featuredAt !== undefined` → parse ISO (or null) verbatim, ignore
       the bool.
     - Else `featured !== undefined` → `true` → `now()`, `false` → `null`.
     - Else leave unchanged (update path only).
   - Admin UI form **unchanged** — it keeps sending `featured: true/false`.
   - Extend `collection.ts` `addThread(id, id, opts?)` and add
     `syncThreadCollectionsWithMeta`.
   - Tests cover: UI-style bool input, import-style ISO input, both
     provided (ISO wins), neither provided (no change on update).

2. **Export: new frontmatter + reply marker format.**
   - Rewrite `buildPostMarkdown` frontmatter block.
   - Rewrite reply serialization with `buildReplyMarker`.
   - Keep Collection metadata on the Thread root; replies carry only their
     own post-level featured/pinned metadata.
   - Update `feedTermsForPost` for featured.
   - Update `export-service.test.ts` assertions to the new format.

3. **Shared parser: JSON reply marker.**
   - Rewrite `splitReplies` regex + JSON parsing.
   - Remove the HTML-attribute regex path.
   - Type `ReplySegment.attrs` strictly.

4. **Import: new frontmatter + reply marker consumption.**
   - Read `extra.jant.featured_at` / `pinned_at` and reply JSON fields.
   - Pass timestamps as-is to `createPost`.
   - Union structured Collection entries across legacy root/reply input and
     pass them only when creating the Thread root.
   - Add the roundtrip test.

5. **Theme: `/featured/` pagination + new frontmatter reads.**
   - Rewrite `featured.html` as manual-first-page + paginator (mirror
     `archive.html`).

- Keep `index.html` fixed to the public latest feed.
- Update `taxonomy_single.html` title switch.
- Update `macros.html` / anywhere else that read the old `extra.*`
  fields.

6. **Regenerate canonical fixture.** Run the mise task, commit diff.

7. **Docs.** Update `theme-export.md` + `export-and-import.md`.

## Verification

- `mise run check-tests` — full suite (behavior change touches DB,
  services, routes-adjacent logic, and shared markdown parsing).
- `mise run check-lint`.
- `mise run demo-source-export-canonical-site-export` — fixture
  regenerates cleanly.
- Manual: export a site with a featured reply whose Thread lives in two
  Collections, one of which pins the Thread; import into a fresh local DB;
  confirm:
  - `/featured/` lists the post and paginates when there are enough
    featured posts.
  - `featured_at` / `pinned_at` timestamps in DB match the original.
  - `thread_collection.createdAt` / `position` / `pinnedAt` for the root
    match the original shared Thread membership.
  - `/` renders Latest and `/featured/` renders Featured.

## Risks & open questions

- **`-->` in JSON string fields** — defensive `\u003e` escape on write.
  Add a unit test that round-trips a post body containing literally
  `-->`.
- **Zola's TOML parser on nested array-of-tables under `extra.jant`** —
  confirmed supported by Zola (`[[extra.jant.collections]]` is valid
  TOML). Add a fixture-level test.
- **Pre-existing callers of `feedTermsForPost`** — only export uses it;
  the signature extension is local. No external consumers.
- **Admin UI payloads** — the API accepts **both** `featured: boolean`
  and `featuredAt: ISO | null` (same for `pinned` / `pinnedAt`), with
  `featuredAt` winning when explicitly set; passing neither leaves the
  field unchanged on update. Admin UI continues to send the bool (no
  form changes). Import sends the ISO string to preserve roundtrip
  fidelity. The service layer collapses both inputs into a single
  `featuredAt: number | null` internal value at one entry point, so
  downstream code only sees the timestamp form.
