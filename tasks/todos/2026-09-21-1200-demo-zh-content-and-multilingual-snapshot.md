# Demo zh-Hans content + multilingual survives the nightly reset

## Root cause (found)

`demo-source` has been multilingual (`en` primary + `zh-Hans`) for a while, but
`demo.jant.me` came back single-language after every nightly rebuild.

`packages/core/bin/lib/site-snapshot.js` filters `site_setting` through the
hand-written `SNAPSHOT_SETTING_KEYS` allowlist, and neither
`MULTILINGUAL_ENABLED` nor `ADDITIONAL_LANGUAGES` was on it. The whole-row
`post` dump already carried `language` and `translation_group_id`, so the
restored site had posts stamped per language and no per-language views at all.
Re-exporting the canonical snapshot alone would not have fixed it.

## Done

- [x] Add `MULTILINGUAL_ENABLED` / `ADDITIONAL_LANGUAGES` to
      `SNAPSHOT_SETTING_KEYS`.
- [x] Add `SNAPSHOT_EXCLUDED_SETTING_KEYS` with a reason per group.
- [x] `src/__tests__/snapshot-settings.test.ts`: every DB-backed key in
      `CONFIG_FIELDS` must be in exactly one registry; env-only keys in neither.
      Verified it fails when a key is dropped from both.
- [x] `snapshot-canonical-replay.test.ts`: the committed snapshot must restore
      the language setup its posts are stamped for. Verified it fails when the
      `MULTILINGUAL_ENABLED` row is removed from the dump.
- [x] `docs/export-and-import.md` + `docs/zh-Hans/export-and-import.md`: say the
      language setup travels, and that code injection and integration bindings
      don't.
- [x] 20 `zh-Hans` thread roots on demo-source, adapted from
      www.owenyoung.com: 8 plain notes, 2 notes with media, 3 titled notes,
      7 quotes (one of them a two-post Thread), 5 links, 3 featured.
- [x] Translation groups run from the Chinese side: English versions of three
      Chinese posts (a note, a quote, a link), linked with `translationOfId`.
      The first pass had it backwards — Chinese versions of the demo's own
      English posts — and those three were deleted.
- [x] Media: 20 content images, 4 videos with poster frames. Videos re-encoded
      to ≤960px H.264 (CRF 31, mono 64k AAC): the storefront post carries
      7 photos + 3 videos, the Bluetooth remote post a video + a photo.
- [x] Timeline re-dated so no two posts of the same format sit next to each
      other in the Chinese view (`N Q N L N Q L Q N L N Q N L Q N L N Q N`),
      and no two links are adjacent in the English view either. Ordering is
      `publishedAt` — there is no separate position to set, and a Thread is
      placed by its root, so moving one re-dates the reply too.
- [x] The compounding Thread sits in the second slot, dated so it stays there
      whether a view orders by `publishedAt` or by `lastActivityAt`.
- [x] Images re-encoded to ≤1000px webp and uploaded with Chinese alt text.
      Snapshot `objects/` is 30 files, 2.2 MB in total.
- [x] `mise run demo-source-export-canonical` — snapshot carries
      `MULTILINGUAL_ENABLED = true`, `ADDITIONAL_LANGUAGES = zh-Hans` and
      `SITE_NAME = 'Jant Demo'`, with 67 posts (30 `en` + 20 `zh-Hans` thread
      roots, plus replies) and 26 media rows.
- [x] `mise run check-tests` (4473 passed), `mise run check-lint`,
      `mise run check-copy`.
- [x] Verified live: `/zh-hans`, `/zh-hans/collections`, `/zh-hans/archive`,
      "Also available in" in both directions on the three translation groups,
      and the "Nothing in 简体中文 here yet" state on Home Cooking.

## Left

- [ ] Commit the re-exported `sites/demo-source/canonical/snapshot/`. The
      nightly `reset-demo.yml` run (or `mise run demo-rebuild` by hand) then
      restores demo.jant.me as a multilingual site named Jant Demo.
- [ ] Decide whether to refresh `sites/demo-source/canonical/site-export/`.
      It is a separate HTTP export used for `jant site import` testing and local
      Node/Postgres bootstrapping; refreshing it adds another copy of the images
      to the repo.

## Follow-up: the snapshot outgrew a CLI argument

CI failed on the commit that added the Chinese side, and the demo reset
therefore fell back to the last green commit — which is why demo.jant.me did
not change.

`jant site snapshot import` sends the whole statement batch to Wrangler as one
`--command=` argument. Linux caps a single argv entry at 128 KiB
(`MAX_ARG_STRLEN`) and fails the spawn with `E2BIG`; macOS has no such cap, so
the 190 KB `db.sql` imported fine locally and died in CI.

- [x] `executeD1` routes any batch at or above 96 KiB through a temp file and
      the existing `executeD1File` (`--file`), so every caller — snapshot
      import, migrate, backfills — is fixed, not just this one.
- [x] `src/db/__tests__/d1-query.test.ts` covers both branches, asserts the
      temp file holds the batch and is cleaned up, and pins the threshold below
      the Linux cap.
- [x] `src/db/__tests__/demo-canonical-snapshot.test.ts` now imports the real
      190 KB snapshot through the file path against a local D1.

## Noted, not done here

- The public reader UI catalogs for Chinese are ~512/518 untranslated
  (`src/i18n/locales/public/zh-Hans.po`, `zh-Hant.po`), so `/zh-hans` renders
  its chrome in English. Spun off as its own task.
- `media.listOrphanedMediaIds` is now dead code: `uploads.cleanupExpired`
  hardcodes `deletedOrphanMedia: 0` because body-embedded media has no
  `post_id`. Worth deleting or wiring up deliberately.
- The author deleted the concert and Anji posts from demo-source. Their
  media went with them (deleting a post hard-deletes its media), so the demo
  no longer has an audio attachment anywhere — video is still covered by the
  storefront and Bluetooth remote posts.
- The Bluetooth remote link keeps its `e.tb.cn` short URL but drops the `tk=`
  affiliate parameter. Restore it if the demo should carry it.
- The two Toastmasters photos from the source post were left out on purpose:
  a printed agenda with a club address and QR codes, and a group illustration
  of identifiable people at a named club. Not material for a public demo.
