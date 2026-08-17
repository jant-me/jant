# Archive view labels: one vocabulary, three composers

## Why

The archive page names itself `All`, which reads as a bare quantifier as a
heading and is plainly false on a filtered view. Separately, `<title>` ignores
filters entirely, so every bookmarked filtered archive produces the same tab
text. And the same filter state currently has two names: the chips say
`Untitled`, the feed title says `without title`.

Decision from the discussion: unify the **vocabulary** (what a filter state is
called), not the **composition** (how many parts each surface shows and how it
joins them) — the surfaces have genuinely opposite constraints. The page shows
no prose summary of the filters at all: the filter bar already carries that, and
the reader applied it. What the page adds instead is a comparative count, which
announces "this is a subset" without enumerating seven dimensions.

## Plan

- [x] New `src/ui/shared/archive-labels.ts`: per-dimension words plus
      `describeArchiveFilters()` returning them in most-identifying-first order.
      Mirrors the chips' existing format×hasTitle collapse (`Untitled` replaces
      `Notes, without title`).
- [x] `ArchivePage.tsx`: H1 `All` → `All posts`; import the shared vocabulary
      instead of defining format/media/visibility words locally.
- [x] Comparative count: `42 of 1,240 threads` when a filter is active.
      Needs `baselineCount` on `ArchivePageProps`.
- [x] `routes/pages/archive.tsx`: baseline count query (only when filtered,
      inside the existing `Promise.all`); `<title>` from
      `describeArchiveFilters()` capped at 2 parts; feed label reuses the shared
      vocabulary and keeps its exhaustive composition.
- [x] Tests + i18n extract.

## Not in this change

- `path_registry` author-set title/description for custom archive URLs — separate
  task, needs a dual-dialect schema migration.
- The feed title's `Archive: ` prefix, which is now the last reader-facing use of
  the old word.

## Results

Done. `describeArchiveFilters()` is the single vocabulary; the chips, `<title>`
and the feed compose from it with their own rules. Six feed-only msgids
(`with title`, `without title`, `with media`, `without media`, `threads`,
`single posts`) collapsed into the chip words.

Verified: `check-tests` 278 files / 3613 tests pass, `check-lint` clean,
`check-copy` 0/0.
