# Discover: `jant:id` and a batch post-status endpoint

A directory holding posts it read from a feed cannot tell, from the feed alone,
a post that left it (deleted, private, draft, Hidden from Latest, unfeatured)
from one that was pushed past the feed's length. The cloud guessed from order
and got it wrong: `/latest/feed` is ordered by Thread activity, not by
`<published>`. Decided 2026-09-11: stop guessing, ask the site.

## Decisions

- **`<jant:id>` on every entry**: the root post's TypeID, next to
  `<jant:format>`. `<id>` stays the permalink — changing it would make every
  subscriber's reader show the current entries again. The cloud keys entries
  on `jant:id`, so a slug rename or a domain change no longer re-keys anything.
- **`GET /api/discover/posts?id=…&id=…`**: up to 50 post ids. Each id gets
  `{ id, latest, featured }` — whether the post is in this view's Latest feed
  and whether its Thread is in this view's featured feed, decided by the same
  filters the two feeds use. Unknown, deleted, private and draft ids come back
  `false`/`false`. The directory does not need the reason.
- **Gated by Discover, not `PUBLIC_API_ENABLED`**: it answers only while the
  site's effective mode is not `none`, and says nothing the public feeds do
  not already say. `404` otherwise.
- **Language**: `?lang=` scopes the answer to one language view, the way a
  language feed is scoped. The declaration's address carries it on a
  multilingual site.
- **The declaration names it**: `status="…"` on `<jant:discover>`, beside
  `feed` and `featured`, absolute and same-origin like them.
- **No compatibility path**: a feed without `jant:id` or `status` is an error
  to the directory. Nothing has launched.

## Steps

- [x] `<jant:id>` in `lib/feed.ts`
- [x] shared Latest/featured selections (`latestFeedSelection`,
      `featuredFeedSelection` in `lib/feed-policy.ts`); `ids` on `PostFilters`,
      `threadIds` on `ThreadRootPageOptions`
- [x] `routes/api/discover.ts`, mounted at `/api/discover`
- [x] `status` attribute: `FeedData`, `buildFeedDiscoveryFields`, renderer
- [x] tests: `jant:id`; the endpoint (hidden, private, draft, deleted,
      unknown, featured reply, language, gate, limits); the declaration
- [x] docs: `docs/feeds.md`, `docs/API.md`, `docs/internal/feed-contract.md`,
      `docs/internal/feed-reading.md`
- [x] a note for the cloud session (handed to the owner in chat)
- [x] verify: focused suites, `check-types`, `check-lint`, `check-tests`,
      `check-copy`

## Results

- `check-types`, `check-lint` clean; `check-tests` 318 files, 4344 tests.
  `routes/api/__tests__/discover.test.ts` covers the endpoint, including a
  full 50-ID request under the D1 bound-parameter guard.
- `check-copy`: the changed docs pass; the three errors it reports are in
  `docs/internal/struggle.zh-Hans.md`, committed in `fcebc1ae`.
- Not done: a request against a running dev server. The route tests mount the
  real route module, not the full app; the mount sits beside the public posts
  API in `app.tsx`, behind the same middleware.
- The exported static theme gets no `jant:id` (listed under Known Limits in
  the feed contract).
