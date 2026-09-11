# Feeds: a `?limit=` parameter, up to 500

A directory reading a blog for the first time wants its history, not the last
50 entries. Every Atom feed accepts `?limit=` so one request can carry more (or
fewer) than the site's `RSS_FEED_LIMIT`. Decided 2026-09-11: ceiling 500.

The cloud side (read with `?limit=500` on a feed's first read, plus a one-off
backfill for already-listed blogs) is not part of this change. It waits on the
cloud withdrawal bug: `detectWithdrawnEntryIds` treats `<published>` as the
feed's sort key, but `/latest/feed` is ordered by Thread activity, so a
backfill would be withdrawn the next time an author replies to an old Thread.

## Decisions

- One rule for every Atom feed: `/feed`, `/latest/feed`, `/featured/feed`,
  `/archive/feed`, collection and smart-collection feeds, and their language
  views. A parameter that works on some feeds and not others is a surprise.
- Value: a positive integer. Above 500 → 500. Anything else (missing, `0`,
  negative, not an integer) → the site's `RSS_FEED_LIMIT`, the same leniency
  `?format=` gets on a feed.
- `limit` changes how much of a feed one response carries, not which feed it
  is: `rel="self"`, the language alternates and the `jant:discover`
  declaration keep pointing at the address without it. It stays in the Worker
  cache key (it is not a tracking parameter), so each value caches separately.

## Found while planning

`posts.getPublishedThreads` and `media.getByPostIds` put every id in one
`IN (…)` list. D1 rejects a statement with more than 100 bound parameters, so
any feed past ~97 entries fails on D1 today — including `RSS_FEED_LIMIT`
values the setting already allows (up to 200). Both move to `batchQueryRows`.

## Steps

- [x] `lib/feed-policy.ts`: `FEED_LIMIT_MAX`, `parseFeedLimit`, `getFeedLimit`
- [x] use it in `buildFeedData`, the archive, collection and smart-collection feeds
- [x] batch `getPublishedThreads` and `media.getByPostIds`
- [x] tests: parser cases; `?limit=` on latest/featured/main/archive; a
      D1-shaped test that fails any statement over 100 bound parameters
- [x] `docs/feeds.md`
- [x] verify: focused suites, then `mise run check-tests`, `check-lint`, `check-copy`

## Results

- `enforceD1BoundParameterLimit` (test helper in `__tests__/helpers/db.ts`)
  makes the test database refuse a statement over 100 bound parameters. With
  the two service fixes reverted, the 120-entry feed test fails on a
  123-parameter statement; with them it passes.
- `check-types`, `check-lint`: clean. `check-tests`: 317 files, 4331 tests
  pass. Prettier clean on every changed file.
- `check-copy`: `docs/feeds.md` passes. The run still reports three errors in
  `docs/internal/struggle.zh-Hans.md`, committed in `fcebc1ae` and untouched
  here.
- Not done: a check against a running dev server.
