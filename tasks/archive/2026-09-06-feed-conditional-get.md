# Conditional GET on feed responses (ETag)

Carried out of `2026-08-24-discover-setting-and-feed-declaration.md` (now in
`tasks/archive/`), the only item that never landed there. It is not Discover
work — it makes every feed poll cheaper, for any reader — so it lives on its
own.

## Why

Feed responses carry `Cache-Control: public, max-age=60`
(`RSS_FEED_CACHE_CONTROL` in `lib/feed-policy.ts`) and nothing else. No
validator is emitted anywhere, so a conditional request cannot be answered
with `304` and every poll transfers the whole document. The Discover crawler
sends conditional-GET headers today and gets a full body back each time; so
does every ordinary feed reader.

## Decisions (settled 2026-09-08)

- **Validator: strong ETag over the rendered body.** It covers everything that
  varies (site name, language view, feed policy, the `jant:discover`
  declaration) without a per-view timestamp query that would have to
  re-derive all of those inputs and would silently serve stale bytes when it
  missed one. Cost is that the feed is built and rendered before the `304` is
  decided — bandwidth is saved, compute is not. A cheap pre-render validator
  stays possible later, behind the same helper.
- **Strong, not weak.** The tag is a SHA-256 of the exact bytes that would be
  sent, so equal tags do mean identical bytes — `W/` would understate it.
- **One helper, six call sites.** `renderFeed(c, xml)` moves into
  `lib/feed-policy.ts` next to `RSS_FEED_CACHE_CONTROL`, and the three routes
  that hand-rolled their own `new Response(...)` go through it.

## Steps

- [x] `lib/http-cache.ts`: `strongETag(body)` and `matchesIfNoneMatch(header, etag)`
      (RFC 9110 weak comparison, comma lists, `*`).
- [x] Move `renderFeed` from `routes/feed/feed.ts` into `lib/feed-policy.ts`,
      make it async, emit `ETag`, answer `If-None-Match` with a bare `304`.
- [x] Route all six feed responses through it: `routes/feed/feed.ts`,
      `pages/latest.tsx`, `pages/featured.tsx`, `pages/archive.tsx`,
      `pages/collection.tsx`, `pages/smart-collection.tsx`.
- [x] Tests: `lib/__tests__/http-cache.test.ts` for the primitives; feed route
      cases for 200-with-ETag, matching validator → 304 with no body, changed
      content → new ETag, and one non-`/feed` surface.

## Known hole

An empty feed's `<updated>` falls back to `new Date().toISOString()`
(`lib/feed.ts:1303`), so its body — and its ETag — changes on every poll. Rare
and low-traffic (a site with nothing published, or a filtered feed that
matches nothing), and giving it a stable value is a feed-output decision of
its own. Left alone; flagged rather than silently fixed.

## What landed

`renderFeed` only _emits_ the tag. Answering it is `withConditionalResponse`
in `lib/http-cache.ts`, applied in `createApp()`'s `app.fetch` outside
`withWorkerResponseCache` — which turned out to be the whole ballgame:

- The Worker response cache already stored feed responses in `caches.default`
  and answered from them before any route ran, so a validator emitted inside a
  route was invisible on a cache hit. Verified with `curl -D -` against
  `dev-debug`: `cf-cache-status: HIT`, `200`, every time.
- Answering inside the route also breaks the cache the other way: a `304` is
  not `response.ok`, so `canStoreWorkerCacheResponse` refuses it, and a reader
  that always sends a validator would leave the cache permanently empty.

One layer outside the cache fixes both, and covers the Node runtime (which
skips the Worker cache entirely) with the same code. Any response carrying an
`ETag` now gets conditional handling, so `/api/media/:id/content` picked it up
too; its own early exit stays, because matching before the storage read is
what saves the fetch, and it now uses the shared matcher.

## Verify

- `mise run check-tests` — 314 files, 4256 tests, all passing. `check-types`,
  `check-lint`, `check-format` clean.
- Real HTTP against `mise run dev-debug`: `/feed`, `/latest/feed`,
  `/featured/feed`, `/archive/feed` and three collection feeds each return a
  strong tag, `304` on replay, `304` for the `W/` form, `200` for a stale tag.
  An HTML page carries no tag and is unaffected.
