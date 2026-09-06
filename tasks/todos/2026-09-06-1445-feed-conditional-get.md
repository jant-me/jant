# Conditional GET on feed responses (ETag / Last-Modified)

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

## Scope

Four routes assemble a feed and set `Cache-Control` themselves:

- `routes/feed/feed.ts:352`
- `routes/pages/archive.tsx:924`
- `routes/pages/collection.tsx:385`
- `routes/pages/smart-collection.tsx:341`

The validator belongs next to `RSS_FEED_CACHE_CONTROL` in `lib/feed-policy.ts`
so all four share one derivation, the same way `buildFeedDiscoveryFields`
already works.

## Open questions to settle before building

- **Which validator.** `Last-Modified` is a second's resolution and needs a
  "newest thing in this view" timestamp; an `ETag` over the rendered body is
  exact and covers everything that varies (site name, language view, feed
  policy, the `jant:discover` declaration), at the cost of rendering the feed
  before deciding. Rendering is cheap here and correctness is not — an ETag
  over the serialized body is the likely answer, with `Last-Modified` only if
  a per-view max timestamp is already at hand.
- **Weak vs strong.** A weak ETag (`W/"…"`) is the honest label unless the
  bytes are guaranteed identical.
- **Where the 304 is returned.** A shared helper that takes the rendered body
  and the request and returns either the 200 or a bare 304 keeps the four call
  sites identical.

## Verify

`mise run check-tests` (feed tests cover all four surfaces already),
`check-lint`, `check-types`. Add cases for: no request validator → 200 with an
ETag; matching validator → 304 with no body; changed content → new ETag.
