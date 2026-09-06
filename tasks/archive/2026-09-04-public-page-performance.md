# Public page performance

Measured on https://www.owenyoung.com/ (Lighthouse 12, mobile, simulated 4G).

| Metric         | Home (50 posts) | Post detail |
| -------------- | --------------- | ----------- |
| Performance    | 71              | 86          |
| FCP            | 3.5 s           | 2.9 s       |
| LCP            | 4.0 s           | 3.1 s       |
| Speed Index    | 9.1 s           | 5.2 s       |
| TBT            | 130 ms          | 0 ms        |
| CLS            | 0               | 0           |
| DOM elements   | 4,020           | 1,517       |
| HTML transfer  | 62 KB           | 16 KB       |
| Style & Layout | 1,069 ms        | 155 ms      |

Origin render time, measured inside the box against the container
(`curl` -> `172.18.0.19:3000`): `/readyz` 4 ms, `/` 41-55 ms for the full
347 KB homepage. The server is not the bottleneck; everything below is
payload we choose to ship.

## Done

- [x] 1. `PAGE_SIZE` default 50 -> 25 (`src/types/config.ts`), plus the docs,
      `.env.example`, `.dev.vars.example`, `.env.node.example` and both
      `wrangler.toml` files. `SEARCH_PAGE_SIZE` / `ARCHIVE_PAGE_SIZE` inherit it.
      Measured on the live HTML: 50 items = 57.8 KB gzip / 3,943 elements,
      25 items = 21.4 KB / 1,353.
- [x] 2. Author-only markup is no longer sent to readers. `PostStatusBadges`
      keeps all four badges for the author (the post menu toggles
      `data-post-pinned` and friends in place) and gives a reader only what
      applies — usually nothing. `PostFooter` drops the whole
      `.post-menu-actions` group and the featured mark, both revealed by
      `body[data-authenticated]` / `article[data-post-featured]` alone.
      The viewer is bound once per render in `lib/viewer-context.ts`, from the
      same `c.var.isAuthenticated` that `BaseLayout` writes into
      `data-authenticated`, rather than threaded through six component layers.
- [x] 3. Author-only CSS is out of the reader stylesheet. `styles/ui.css`
      keeps what a visitor needs (386 KB -> 181 KB of source); the composer,
      the editor chrome, the command palette, the settings pages and the draft
      preview bar moved to `styles/ui-author.css`, built as `client-author.css`
      and linked by `BaseLayout` only when the page is authenticated. Built
      `client.css` fell 568,404 -> 422,441 bytes, 58.0 -> 43.5 KB brotli
      (-25%), off the critical path of every public page.
- [x] 3b. `components.css` followed. 171 of its 205 rules (32 KB of 41 KB) were
      the settings pages, the config editor, the navigation manager, the custom
      URL manager, the dash chrome and the form skeletons; they moved to
      `styles/components-author.css`. `client.css` fell a further 420,302 ->
      380,027 bytes, 43.5 -> **39.4 KB brotli**. Cumulative from the start of
      this file: 58.0 -> 39.4 KB brotli, **-32%**.
- [x] 3c. Assets upload brotli-compressed at quality 11
      (`bin/commands/assets/upload.js`). The bucket sits behind a CDN that
      compresses at a fixed low quality — measured as brotli q4 (50,359 bytes
      for `client.css`), _worse_ than its own gzip (49,446) — with no setting
      to raise it. Compressing at build time reaches 39,427. Verified against
      the live bucket that a client without brotli is unaffected: the edge
      decompresses and re-encodes, byte-identical after decoding.
      First view for a signed-out reader (`client.css` + `client.js`):
      70,309 -> **56,703 bytes**. A Chinese-language site saves a further
      12,694 on `client-cjk.css`. Across `_assets`: 23.6 MB -> 18.2 MB.
      **This one change beats both stylesheet splits combined** (which saved
      26,797 at the CDN's own compression level) and carries no maintenance.
- [x] 6. `private, no-store` is now `private, no-cache` for anonymous
      responses; a signed-in author keeps `no-store`
      (`middleware/cache-control.ts`). `private` is what keeps shared caches
      out, and it is untouched — this only lets the browser hold its own copy.
      The win is not the 304s this item originally asked for: `no-store` also
      **disables the browser's back/forward cache**, so going back re-requested
      and re-rendered the page instead of restoring it instantly. Measured with
      `PerformanceNavigationTiming.notRestoredReasons` on a back navigation:

  |        | reasons bfcache was refused                                                          |
  | ------ | ------------------------------------------------------------------------------------ |
  | before | `masked`, `response-cache-control-no-store`, `websocket`, `websocket-used-with-ccns` |
  | after  | `masked`, `websocket`                                                                |

  The remaining `websocket` is Vite dev's HMR channel, which production
  does not have — the reader bundle opens no `EventSource` or `WebSocket`
  of its own (checked in the built `client.js`).

  An author keeps `no-store` on purpose: the back/forward cache restores a
  whole page snapshot without asking the server, so an authenticated view
  would survive signing out — on a shared machine that shows the previous
  session. Readers are the traffic that matters for this anyway.

  **ETag deliberately not added.** Under `no-cache` the browser still
  revalidates on every navigation and the server still renders in full, so
  an ETag would save only the ~9 KB gzipped HTML transfer, not the TTFB.
  Against that it needs a cache key covering every render input —
  `isAuthenticated`, page language and CJK font profile, theme and font
  theme, custom CSS and head HTML, `CORE_VERSION`, nav, collections, site
  settings, content — where one missed input is a wrong 304 in someone's
  browser, `private` so it reproduces nowhere else. Bad trade; the bfcache
  win above needed none of it.

- [x] 4. Both images that skipped `getImageUrl` now go through it:
      `lib/media-helpers.ts` sizes the timeline video poster the way
      `lib/view.ts` already did (a raw 244 KB PNG on the live homepage), and
      `lib/resolve-config.ts` derives `siteAvatarThumbUrl` at 128px for the
      header and drawer marks. `siteAvatarUrl` stays full-resolution for the
      social card, the settings editor and the control-plane sync.
- [x] 7. `<link rel="preconnect">` to the hosts a page's subresources come
      from, emitted first thing in `<head>` (`getPreconnectHints` in
      `lib/asset-path.ts`, rendered by `BaseLayout`). DNS, TCP and TLS now
      start while the rest of `<head>` is still parsing, instead of after the
      parser reaches the stylesheet.
      Which hosts, and how many links each: the asset host (`ASSET_BASE_URL`)
      gets two, because the stylesheet is fetched without CORS and the module
      script with it, and a browser pools those separately. The media host
      (`R2_PUBLIC_URL` / `S3_PUBLIC_URL`) serves images, so it gets the
      uncredentialed one only. A host equal to the site's own origin is already
      connected and gets none, and when assets and media share a host the asset
      hints already cover the images — so the common single-CDN setup emits two
      links, not three.
      The other half of this item — Caddy handing Chrome gzip (61.5 KB) rather
      than zstd (57 KB) — is dropped: it lives in
      `/srv/caddy/config/snippets/cache.caddy`, not in core.

## Verified

- `mise run check-tests`: 304 files, 3,979 tests, all passing. New coverage:
  reader vs author footers and badges, `buildMediaMap` poster sizing, avatar
  thumb derivation with and without a configured transform, and the stylesheet
  split (`src/__tests__/stylesheet-audience.test.ts` plus the `BaseLayout`
  link gate).
- `mise run check-lint`, `pnpm format:check`: clean.
- The preconnect hints are covered both ways: `getPreconnectHints` unit tests
  for a CDN asset host, a separate media host, a shared one, same-origin, and
  missing or unparseable URLs; `BaseLayout` tests asserting the links render,
  that a shared asset/media host produces exactly two, that a same-origin setup
  produces none, and that they precede the stylesheet they warm.
- The stylesheet split was A/B'd against `HEAD` in a browser: `/`, `/archive`,
  a post page, `/_/theme-sample`, `/settings` and the open composer, 3,240
  elements over 34 computed properties each, zero differences. Cascade layers
  confirmed live — the author sheet's `@layer components` joins the layer
  `client.css` opens, so utilities still win.
- The `components.css` split was A/B'd the same way over `/`, `/archive`,
  `/collections`, `/settings`, `/settings/navigation`, `/settings/config` and
  `/settings/custom-urls` — 2,869 elements, zero differences. That pass caught
  one real cascade flip (`.config-editor-value-input`'s monospace declaration,
  dead since `preset.css` overrode it, would have come back to life); a static
  scan for the same shape across the whole tree found no others.
- Local dev instance, same 15-post feed rendered both ways:
  anonymous 236 elements / 30 KB, author 587 elements / 66 KB. Anonymous
  carries 0 badges, 0 menu triggers, 0 reply triggers and exactly the one
  featured mark that is real. `/`, a post page, `/collections`, `/featured`,
  `/archive`, `/search` all 200 with no author-only markers; the author's
  view still shows compose, reply and menu controls.

## Dropped

- 5. `content-visibility: auto` + `contain-intrinsic-size` on off-screen
     timeline items. The premise was a 50-post feed whose style and layout cost
     1,069 ms; item 1 halved that feed to 25 posts, so the saving this would
     buy is roughly half of what it was measured against, against a real cost:
     every card needs a `contain-intrinsic-size` guess, and a wrong guess moves
     the scrollbar under the reader and lands in-page anchors in the wrong
     place. Not worth it unmeasured. Re-open only if `Style & Layout` on the
     25-post feed is still the largest render cost.
