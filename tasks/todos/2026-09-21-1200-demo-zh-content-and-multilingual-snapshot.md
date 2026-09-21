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
- [x] 19 `zh-Hans` posts published on demo-source, adapted from
      www.owenyoung.com: 8 plain notes, 3 notes with images, 3 titled notes,
      6 quotes, 5 links, 4 featured, 8 images across 6 posts.
- [x] Translation groups run from the Chinese side: English versions of three
      Chinese posts (a note, a quote, a link), linked with `translationOfId`.
      The first pass had it backwards — Chinese versions of the demo's own
      English posts — and those three were deleted.
- [x] Images re-encoded to ≤1000px webp (628 KB total) and uploaded with
      Chinese alt text.
- [x] `mise run demo-source-export-canonical` — snapshot now carries
      `MULTILINGUAL_ENABLED = true`, `ADDITIONAL_LANGUAGES = zh-Hans`, 65 posts
      (30 `en` + 19 `zh-Hans` thread roots, plus replies and drafts).
- [x] `mise run check-tests` (4472 passed), `mise run check-lint`,
      `mise run check-copy`.
- [x] Verified live: `/zh-hans`, `/zh-hans/collections`, `/zh-hans/archive`,
      "Also available in" in both directions on the three translation groups,
      and the "Nothing in 简体中文 here yet" state on Home Cooking.

## Left

- [ ] Commit `sites/demo-source/canonical/snapshot/` and the code change, then
      let the nightly `reset-demo.yml` run (or `mise run demo-rebuild` by hand)
      restore demo.jant.me as a multilingual site.
- [ ] Decide whether to refresh `sites/demo-source/canonical/site-export/`.
      It is a separate HTTP export used for `jant site import` testing and local
      Node/Postgres bootstrapping; refreshing it adds another copy of the images
      to the repo.

## Noted, not done here

- The public reader UI catalogs for Chinese are ~512/518 untranslated
  (`src/i18n/locales/public/zh-Hans.po`, `zh-Hant.po`), so `/zh-hans` renders
  its chrome in English. Spun off as its own task.
- `media.listOrphanedMediaIds` is now dead code: `uploads.cleanupExpired`
  hardcodes `deletedOrphanMedia: 0` because body-embedded media has no
  `post_id`. Worth deleting or wiring up deliberately.
- The two Toastmasters photos from the source post were left out on purpose:
  a printed agenda with a club address and QR codes, and a group illustration
  of identifiable people at a named club. Not material for a public demo.
