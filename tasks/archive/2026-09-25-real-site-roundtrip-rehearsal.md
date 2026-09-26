# Real-site round-trip rehearsal (owenyoung.com)

Run the export → import round trip on real data before 1.0, and record what
breaks. Source: www.owenyoung.com (hosted, Node runtime behind Caddy, 0.7.0 at
ab788e00, the same commit as local HEAD).

## Constraints

- Production is read-only. `site export` is `POST /api/export/hugo`, which only
  reads (`storage.get`); the only write is the token's `last_used_at`. Every
  other production request was a GET.
- The token and the exported content stayed in the session scratchpad, never
  in the repo.
- `site snapshot` needs direct database access, which a hosted site does not
  give, so the production side is `site export` only. Snapshot ran between
  the local targets, on the imported real data.

## What ran

- [x] A: `site export` from production. ZIP output failed (finding 1);
      `--directory` succeeded: 1698 content files, 465 media files, 3.1 GB,
      345 s, peak memory 11.3 GB
- [x] Baseline through the API (GET only): 1664 posts (1322 public,
      322 latest_hidden, 1 private, 19 draft; 308 replies, 23 quiet),
      139 featured, 1 pinned, 299 attachments (280 media, 19 text),
      30 collections + 3 smart, 41 directory items, 482 custom URLs
- [x] Hugo: `hugo --gc --minify` on A builds in 3 s, 2294 pages; no draft or
      private page built; every published root and collection present; feeds
      and `_redirects` correct
- [x] Docker target (image from HEAD, Node + SQLite + local storage):
      `jant setup`, dry run, import. 25 s, peak memory 8.1 GB
- [x] Workers target (scaffolded create-jant project, local D1/R2): import.
      47 s. Result identical to Docker except import timestamps
- [x] Node + Postgres target: import. 41 s. Identical to Docker except import
      timestamps
- [x] Verify each target against production: field-level compare by slug,
      every production custom URL over HTTP, every media URL with its size,
      feed entry order
- [x] B: `site export` from the Docker target; same file set as A; diff
      reduces to the findings below
- [x] Snapshot Workers (local D1) → fresh Docker instance: no differences,
      IDs kept (after working around finding 4)
- [x] Snapshot SQLite → Postgres: refused by design (dialect check), with a
      clear message
- [x] Published 0.7.0 (`owenyoung/jant:0.7.0` with its own CLI) importing the
      canonical demo export

## Findings

Ordered by severity.

1. **Large sites cannot use ZIP archives at all.** `site export -o x.zip`
   downloads every media file, then `writeFileSync` throws `ERR_OUT_OF_RANGE`
   on the 3.32 GB buffer (one write is capped at 2 GiB) and leaves a 0-byte
   file. `site snapshot export` does write its 3.32 GB ZIP (async
   `writeFile`), but `site snapshot import` cannot read it:
   `ERR_FS_FILE_TOO_LARGE` from `readFile` (`snapshot/import.js:149`). Same
   for `site import` (`import-site.js:2008`) and `site pull-media` on a ZIP
   (`pull-media.js:105`). `docs/backups.md` recommends the `.zip` snapshot,
   so a site with over 2 GB of media gets a backup the tool cannot restore.
   Every path builds the whole archive in memory: export peaks at
   11.3–11.9 GB, import at 8.1 GB. Needs streaming zip read/write.
2. **The published 0.7.0 cannot import any export.** `Error applying
exported site settings: HTTP 400: Choose true or false.`, zero posts
   written. Fixed on main (cae6cfcd), along with the snapshot provider fix
   (cfd72d5b), but in no release on npm or Docker Hub.
3. **Markdown parser deletes words.** `@tiptap/extension-list`'s tokenizer
   accepts roman numerals and 1–2 letters as ordered-list markers
   (`\d+|[ivxlcdmIVXLCDM]+|[a-zA-Z]{1,2}`), in every version since ≥3.27.3.
   `parseMarkdownDocument("Mr. Smith went")` yields an ordered list item
   "Smith went"; same for "Ps.", "No.", "Ok.". Hit on `9ysdg` ("Ps." lost).
   Affects every Markdown write path: import, API/MCP Markdown bodies, the
   skill.md migration flow. Fix in Jant's Markdown pipeline: digits only.
4. **D1 snapshot export fails on a real-size site.** Each table is one
   `SELECT *` through `wrangler d1 execute --json`, and `execFileSync` keeps
   its default 1 MiB `maxBuffer` (`wrangler-cli.js:60`): `ENOBUFS` on the
   `post` table. The error message is ~800 KB of the site's post JSON, not
   the cause. Applies to `--remote` too. Worked around in the scratch copy
   only; the export then took 549 s (one wrangler process per object).
5. **Silent body loss in export.** `tiptapJsonToMarkdown` catches every
   serializer error and returns `""`. A draft (`blog-nixos-setup`) with an
   empty `listItem` (`content: []`) exported with no body, so the import
   created an empty draft. Same function feeds `/api/public/posts`
   `bodyMarkdown`, `getBodyContent`, text attachment saves in the composer
   (`compose-bridge.ts:688`), and `media.ts`.
6. **Thread structure and order are not preserved.** Replies carry no parent
   or order in front matter; the importer chains each reply to the previous
   one (`import-site.js:2484`) and breaks same-second ties by directory name
   (`:1646`). 114 of 308 replies got a different parent; 8 branch points
   flattened; 26 of 91 threads with same-second replies reordered.
7. **Same-second ordering changes site-wide.** 720 of 1337 published roots
   share a `published_at` second with another post; lists break the tie by
   ID, and import creates posts in directory order, so their relative order
   on home, archive, and feeds changes (featured feed differs from entry 38).
   Creating posts in (date, original id) order would keep it.
8. **Navigation loses placement, labels, and targets.**
   `normalizeImportedNavItems` keeps only `type`/`systemKey` or
   `label`/`url`: two `more` links moved to the header, the archive's "All"
   label dropped, the Now collection item became a plain link.
9. **Redirects and archive custom URLs are not exported.** `atom.xml → /feed`,
   `inspires → /inspired`, `categories/journal → /links`, and the `/links`
   archive URL (`format=link`) all 404 after import. `/atom.xml` is an old
   feed address, so those subscribers break.
10. **Content changes in the Markdown round trip.** CJK bold `**…。**字`
    cannot close under CommonMark flanking rules and renders as literal
    asterisks in both the Hugo site and the re-import (5 posts); the exported
    `hugo.toml` does not enable goldmark's CJK extension. Code blocks inside
    list items gain a leading space per line (6 posts). A literal "1. " after
    a hard break becomes a list (8 posts gain `<ol>`). The rest of the 157
    body differences are harmless normalization (trailing empty paragraphs,
    `<p><figure>` nesting, merged adjacent lists).
11. **Custom URL listing skips entries on Postgres.** `custom-url.ts:111`
    orders by `created_at` only, so OFFSET pages overlap: production lists
    482 rows with 478 unique (4 never shown); the local Postgres target, 36
    duplicates. Needs `id` as a tiebreaker.
12. Media duration is dropped on import: `duration_seconds` is in the front
    matter, 77 attachments come back `null`.
13. Timestamps: every post's `createdAt`/`updatedAt` becomes the import time,
    and the 19 drafts' `lastActivityAt` too; the re-export then writes
    `updated` = import time on 377 posts.
14. Documented gaps: smart collections (3) and their directory entries are
    not exported; a directory link's description is dropped.
15. API: `GET /api/upload` caps at 200 with no cursor; 0.7.0 has no
    `jant setup`.

Held up: all 1664 posts, visibility/status/featured/pinned/quiet flags,
publish dates, titles, quotes, collections and memberships, all 478 post
aliases over HTTP, all 280 media files byte-sized, all 19 text attachments,
settings, and the snapshot itself (lossless, IDs kept).

## Fix plan

Branch `fix/roundtrip-rehearsal`, one commit per fix. 0.7.1 is not a goal.

Markdown pipeline

- [x] F3 Ordered-list markers are digits only (CommonMark), overriding
      `@tiptap/extension-list`'s alpha/roman tokenizer. Upstream #8377
      (merged 2026-09-24, unreleased) only drops mixed-case markers; `PS.`,
      `OK.`, `I.`, `a.` still parse as lists there
- [x] F10b Code blocks inside list items keep their exact lines
- [x] F10c Serializer escapes a line-start `1.` after a hard break
- [x] F10a CJK emphasis survives a CommonMark parser (Hugo and Jant)
- [x] F5 Serializer normalizes schema-invalid docs instead of throwing; no
      catch-all returning `""`; find how the empty `listItem` got stored and
      validate at the write boundary

- [x] Hard breaks that start a line use the backslash form (double breaks
      and a list item opening with a break broke the paragraph or the list)
- Real-data check: all 936 production bodies serialize (0 throw); 805
  round-trip to identical HTML; the other 131 differ only in whitespace,
  empty nodes, `<p><figure>` nesting, or adjacent lists merging

Export/import fidelity

- [x] F6 Replies export their Thread position (`weight`); the theme and the
      importer order by it. No `reply_to`: Threads are linear and the API
      only accepts a reply to the tail, so the importer's chaining is right
- [x] F7 Roots import in (date, original id) order
- [x] F8 Navigation keeps placement, labels, and collection targets
- [x] F9 Redirect custom URLs export (data + `_redirects`) and import
- [x] F12 Media duration survives import
- [x] F13 Post create accepts `createdAt`/`updatedAt`; import restores them

CLI

- [x] F1 Streaming zip64 read/write for site export/import/pull-media and
      snapshot export/import
- [x] F4 D1 snapshot dump pages each table by key; bounded, readable errors

API

- [x] F11 Custom URL listing orders by a unique key; audit OFFSET queries
- [x] F15 `GET /api/upload` cursor pagination

Decided with the author (2026-09-25)

- [x] Legacy archive custom URLs: **no backfill**. b56e4feb already decided
      against one (a backfill invents titles; `visibility=private` views have
      no smart collection form). Existing ones keep working. Settings →
      Custom URLs deliberately offers no conversion for a stored archive path
      (the row holds the address the collection would need); the way is to
      delete it and create a smart collection at that slug. The author does
      that for `/links` (format=link) on owenyoung.com.
- [x] Import warning for a skipped archive URL says to create a smart
      collection at that path with the same conditions, here or on the
      source before exporting.
- [x] Smart collections in the export, live in Hugo, round-tripped by
      definition (plan below)

- [x] Rerun the rehearsal locally on this branch (see "Rerun" below)

## Rerun on the branch (2026-09-25)

Production export A (old format) → T1 → new-code export B2 → T2 (Docker)
and W2 (Workers); snapshots T2 → T3 (Node ZIP) and W2 → Docker (D1).

- Old-format import (A → T1), against production: `updatedAt`, drafts'
  activity times, media durations, and feed order now match; 86 of 91
  Threads read in the same order (the 5 others need `created`, which old
  exports lack). 717 MB peak, down from 8.2 GB.
- New-format round trip (T1 → B2 → T2): every post field identical,
  timestamps included; navigation identical; 3 redirects recreated; 91 of
  91 Threads in the same order. Two bodies differ: an empty list item left
  by the old import, and a figure after a paragraph in a list item (renders
  the same). The archive URL is skipped with a warning (awaiting decision).
- Workers target W2 from B2: identical to T2.
- Server export from a Docker site with 3.1 GB of local media: streamed,
  container peak 360 MB (was OOM-killed); CLI peak 399 MB.
- Hugo on B2: builds; same-second replies in source order; CJK emphasis as
  `<strong>`; custom redirects in `_redirects`; `settings` not in the nav.
- Node snapshot T2 → 3.3 GB ZIP → T3: no differences, IDs included. Export
  8 s / 440 MB, import 3 s / 452 MB.
- D1 snapshot W2 (Workers) → 3.3 GB ZIP → Docker: no differences, IDs
  included, with no workaround. Export 577 s / 54 MB (one Wrangler process
  per object is the slow part), import 4 s / 454 MB.

Found and fixed during the rerun: the create route dropped
`createdAt`/`updatedAt`; import memory (Blob copies); replies older than
their root broke the tail check on import; redirect type sent as a number;
server export built the archive in memory; snapshot post order broke
foreign keys; snapshot objects buffered in memory.

## Smart collections plan (approved 2026-09-25)

Not frozen membership: a frozen list is the one Hugo list that would stop
updating when someone keeps writing in the repo (the concern in the
`export.ts` comment "Smart collections are left out of a static export").
Instead the definition travels, and each side computes membership.

- [x] 1. Export: `content/<slug>/_index.md` per smart collection
      (`type: smart_collection`, `selection` with the collection by slug,
      `sort_order`, `display_layout`); directory rows and nav
      (`smart_collection_slug`) in `data/jant.toml`. Skipped with a warning when
      the collection a condition names is gone.
- [x] 2. Hugo: `partials/smart-collection-members.html` (conditions + orders,
      rating fallback), `smart_collection/list.html`, RSS branch, directory
      entry. Collection thread markup shared via `partials/collection-threads.html`.
- [x] 3. Import: walker collects `smart_collection` bundles; created after
      collections (`buildSmartCollectionCreateRequest`, skip + warn when the
      named collection didn't come across); directory sync keeps their rows;
      nav resolves `smart_collection_slug`.
- [x] 4. Equivalence test `src/__tests__/export-smart-collection.test.ts`:
      21 smart collections × real DB × real Hugo, HTML order and feed order equal
      Jant's list. Mutation (drop the quote source-name rule) fails 2 cases.
- [x] 5. Docs: `docs/export-and-import.md` and
      `docs/zh-Hans/export-and-import.md`; `mise run check-copy` clean.
- [x] 6. Verify: `mise run check-tests` (333 files, 4613 tests) and
      `check-format` pass. Rehearsal: production export A → S1 (+ production's
      3 smart collections in production's directory places, one with a
      collection condition, one nav entry) → export S1.zip → S2. States equal
      apart from reassigned IDs (the collection ID inside a selection resolves
      to the same slug; the 19 text-attachment hashes cover a JSON envelope with
      the attachment ID, content identical). Members of all 4 smart collections
      (381 + 254 + 131 + 3) identical and in the same order on S1, S2, and the
      Hugo build of S1.zip. Hugo directory, nav link, and feed render.
- [x] Found on the way: Hugo manual collection pages sorted by
      `position` / `collected_at_desc`, but Jant collections sort `newest` /
      `oldest` / `rating_desc` with collection pins first, reading the whole
      Thread (activity, earliest published post, highest rating). Fixed with
      `partials/collection-members.html` (page and feed), checked by
      `src/__tests__/export-collection-order.test.ts` (every order, pins, a
      rating on a reply, a reply dated before its root, a quiet reply, the
      rating fallback, same-second ties, across pagination; two mutations
      caught). The smart collection feed now keeps its stored order with no
      rating fallback, as Jant's does. Real data: production export → T1 with
      8 collections switched to `oldest` / `rating_desc` and 8 pins → export →
      Hugo: 30/30 collection pages (836 Threads) and 30/30 feeds in Jant's
      order.
- Open, not in this change: an exported feed's entry `<id>` is the Hugo
  permalink (trailing slash; the slug where Jant uses a custom path), so
  every `<id>` changes on a move to the static site and readers show the
  feed again. `docs/internal/feed-contract.md` says `<id>` stays the
  permalink for exactly that reason, and doesn't list this gap.

## Where things are

- Branch `fix/roundtrip-rehearsal`, not pushed. `mise run check-tests`
  (334 files, 4642 tests) and `check-format` pass.
- The rehearsal scripts (`capture-state.mjs`, `compare-state.mjs`,
  `mk-target.sh`, `seed-*.mjs`, `smart-members.mjs`,
  `collection-order-compare.mjs`) lived in a session scratchpad and are not
  kept. A target was a fresh Node + SQLite Jant in Docker built from the
  working tree (`docker build -t jant-rehearsal:<sha> .`), set up with
  `jant setup` and a `DEV_API_TOKEN`.
