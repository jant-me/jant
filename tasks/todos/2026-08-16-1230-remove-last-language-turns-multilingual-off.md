# Removing the last other language turns multilingual off

Removing languages one by one until only the primary is left leaves the site in
a half-state: every runtime reader treats it as single-language (they all guard
on "the additional list is non-empty"), but `MULTILINGUAL_ENABLED` stays `true`
in the settings table. The Config Editor, the exported `jant.data.toml`, and the
GitHub site-config sync all still report the feature as on, while the Language
page — which recomputes `enabled` from the list — offers "Turn on".

The author's decision: when the removal would empty the list, say so first, and
turn the feature off as part of the same step. The existing refusal stays exactly
as it is — a language that posts are still written in cannot be removed, whether
or not it is the last one.

## Findings that drove the plan

- `removeLanguage` writes an empty list, which deletes the `ADDITIONAL_LANGUAGES`
  row (`services/language.ts:270`), and never touches `MULTILINGUAL_ENABLED`.
- `readState()` masks it (`services/language.ts:212`: `enabled && additional.length > 0`),
  which is why nothing visibly breaks — the flag is simply left lying around.
- The client does not reload after a removal (`jant-settings-language.ts:390`),
  so the page keeps showing the "On" badge and the language list until a refresh.
- Turning multilingual **off** keeps the list, so `/en` still 301s to `/`
  (`routes/pages/__tests__/language-routing.test.ts:148`). Removal genuinely
  drops the language, so its prefix 404s — that is the point of removing it, and
  the confirmation should say so rather than hide it.

## Plan

- [x] `removeLanguage` returns `{ multilingualDisabled }` and clears
      `MULTILINGUAL_ENABLED` when it empties the list while the feature is on
- [x] Keep both existing guards untouched (primary language, posts in use)
- [x] `respondToLanguageAction` accepts a toast built from the action's result
- [x] `/settings/language/remove` reports the combined outcome in one toast
- [x] Confirm before the last removal; on success reload the way disable does
- [x] Copy for the new dialog in en + zh-Hans + zh-Hant
- [x] Tests: service (flag cleared / flag kept / still refused), component
      (declined, confirmed, non-last removal still silent)
- [x] Document it in `docs/multilingual.md` + `docs/zh-Hans/multilingual.md`
- [x] Verify: check-tests, check-lint, i18n-check

## Results

**Service.** `removeLanguage` now returns `{ multilingualDisabled: boolean }`.
When the language it drops is the last additional one and multilingual content is
on, it removes `MULTILINGUAL_ENABLED` in the same step, so the stored settings and
the site's behaviour agree again. Both refusals are unchanged and run first: the
primary language cannot be removed, and a language posts are still written in is
refused with the count — the last language included, which is what keeps the
"change those posts first" rule intact.

**Route.** `respondToLanguageAction` is generic over the action's result and takes
either a fixed toast or one built from it, so `/language/remove` can answer
"Language removed. Multilingual content is off." without duplicating the
`LanguageInUseError` handling.

**Client.** Removing the last other language now opens a confirmation naming the
consequence — the feature turns off, the root address goes back to showing every
language, and the prefix stops working — and on success reloads with the toast
queued, the same shape as `#turnOffMultilingual`. Removing any other language is
unchanged: no dialog, no reload.

**Docs.** `docs/multilingual.md` and its zh-Hans mirror describe the combined
step under "Managing languages", and "Turning it off" now names the one way the
two routes to a single-language site differ: a language you turn off keeps its
redirecting prefix, a language you remove does not.

**Verified.** Full vitest suite: 270 files, 3532 tests, all passing.
`mise run check-lint` clean, Prettier clean across the touched files. Catalogs
rebuilt with `mise run i18n-build` (settings coverage back to 100% in both
Chinese locales) and stable across a second rebuild — `mise run i18n-check`
itself diffs against HEAD, so it cannot pass on an uncommitted copy change; see
`tasks/lessons.md`. `mise run check-tests` still stops at the pre-existing `tsc`
error in `src/routes/pages/collection.tsx` (`c.req.param("slug")` is
`string | undefined`); reproduced with this work stashed, so it predates it and
is untouched here — same finding as the 2026-08-16-1030 task.
