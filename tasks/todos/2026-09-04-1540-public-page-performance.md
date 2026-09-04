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
- [x] 4. Both images that skipped `getImageUrl` now go through it:
      `lib/media-helpers.ts` sizes the timeline video poster the way
      `lib/view.ts` already did (a raw 244 KB PNG on the live homepage), and
      `lib/resolve-config.ts` derives `siteAvatarThumbUrl` at 128px for the
      header and drawer marks. `siteAvatarUrl` stays full-resolution for the
      social card, the settings editor and the control-plane sync.

## Verified

- `mise run check-tests`: 304 files, 3,971 tests, all passing. New coverage:
  reader vs author footers and badges, `buildMediaMap` poster sizing, avatar
  thumb derivation with and without a configured transform.
- `mise run check-lint`, `pnpm format:check`: clean.
- Local dev instance, same 15-post feed rendered both ways:
  anonymous 236 elements / 30 KB, author 587 elements / 66 KB. Anonymous
  carries 0 badges, 0 menu triggers, 0 reply triggers and exactly the one
  featured mark that is real. `/`, a post page, `/collections`, `/featured`,
  `/archive`, `/search` all 200 with no author-only markers; the author's
  view still shows compose, reply and menu controls.

## Still open

- [ ] 3. Split author-only CSS out of the reader stylesheet. Written up in
      full, with the build mechanism and the cascade risks, in
      `2026-09-05-0100-split-author-css.md`. Sharpened estimate: ~147 KB of the
      568 KB stylesheet is author-only, worth ~20 KB brotli and ~100 ms of FCP
      on every page. Largest of the remaining items, and the riskiest.
- [ ] 5. `content-visibility: auto` + `contain-intrinsic-size` on off-screen
      timeline items. Worth re-measuring after 1 and 2 — a 25-post feed may no
      longer be tall enough to justify it.
- [ ] 6. Revisit `private, no-store` (`middleware/cache-control.ts:36`).
      The auth-variant reasoning is right, but `no-store` also forbids the
      browser's own copy, so back/forward and repeat visits re-download and
      re-render. `private, no-cache` + ETag keeps shared caches out and lets
      repeat visits be 304s.
- [ ] 7. Small: `preconnect` to the asset origin in `<head>`; Caddy's
      `encode gzip zstd` hands Chrome gzip (61.5 KB) instead of zstd (57 KB) —
      that one lives in `/srv/caddy/config/snippets/cache.caddy`, not in core.
