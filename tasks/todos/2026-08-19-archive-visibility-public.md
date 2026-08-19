# Archive visibility: one dimension, one rule about who may name it

## Why

Two things, and the second is why the first has to be fixed first.

**The bug.** `path_registry` already stores archive queries (`kind: "archive"` +
`archive_query`), and `page.tsx:577` renders them through `renderArchivePage`.
For a signed-out reader `buildArchivePostFilters` forces `effectiveVisibility`
to `undefined` (`archive.tsx:208`), so a stored `visibility=private` clause
simply evaporates: the path renders **the entire public archive**. Content is
safe — `excludePrivate: !isAuthenticated` holds — but the path's _name_ now
covers a set nobody chose. `archiveQuery` is `z.string().optional()`
(`lib/schemas.ts:870`), unvalidated, and `page.tsx:577` has zero test coverage,
which is how this shipped.

**The change.** The visibility chip becomes visible to signed-out readers, minus
`private`. That turns the silent clause-drop from an owner-only curiosity into a
public-facing one, and it drags the feed along: the feed currently neither emits
nor reads `visibility`, so the page's own subscribe button hands back a
different set than the page shows.

## The rule

`visibility=private` requires auth. It is never silently dropped.

| Query came from               | Signed-out reader gets                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| the request URL               | 302 to the same URL without `visibility` — URL and content agree |
| `path_registry.archive_query` | 404 — there is nothing to redirect to; the path _is_ the name    |

`visibility=all` stays public: for a signed-out reader it means "everything you
can see", which is exactly what renders. A no-op, not a lie.

Two constraints that are easy to lose later:

- **302, not 308.** The existing legacy rewrites are permanent because they are
  unconditional. This one is not: the URL moved for _you_, _now_, and must still
  work once the author signs in. `defaultCacheControl` happens to stamp
  `private, no-store` on it today, but the status code has to mean the right
  thing on its own.
- **The decision never touches the database.** It is made from the param plus
  `c.var.isAuthenticated`, before any query. A redirect that fired only when
  private posts existed would be an existence oracle.

## Plan

- [x] `types/constants.ts`: `PUBLIC_ARCHIVE_VISIBILITIES` (public, featured,
      latest_hidden) and `ARCHIVE_VISIBILITIES` derived from it by appending
      `private`, with `ArchiveVisibility` derived from the array. `props.ts`
      re-exports it the way it already re-exports `ArchiveLayout`, so the route
      and the filter bar read one list instead of each keeping its own.
- [x] `archive.tsx`: `archiveQueryRequiresAuth()` reading the param and the
      session only, plus `visibilityFilterClause()` so the page and the feed
      cannot drift on how `featured` maps to a different `PostFilters` field
      than the other three.
- [x] `legacyArchiveParamsRedirect` → `archiveParamsRedirect`, returning
      `{ location, status }`. One pass, one hop: legacy rewrites and the
      auth-dependent strip are computed together, and the status is 302 when the
      strip fired, 308 otherwise. (Not exported; the tests drive it through
      `app.request`, so the rename was free.)
- [x] `buildArchivePostFilters`: the auth-dependent degrade is gone — by the
      time filters are built the request has already been redirected or 404'd.
      `excludePrivate: !isAuthenticated` stays as the unconditional floor that
      no path can route around.
- [x] `renderArchivePage`: when `queryOverrides` is present and the query needs
      auth the reader lacks → `c.notFound()`. Guarding on the presence of
      overrides is what distinguishes an owner-stored query from a reader's, so
      `page.tsx:577` needed no change and future callers inherit the guard.
- [x] `ArchivePage.tsx`: the chip renders for everyone; only its option list
      depends on auth.
- [x] Feed alignment: `buildArchiveFeedQuery` emits `visibility` in the `hidden`
      URL spelling, `buildArchiveFeedData` applies the same clause the page
      does, and `buildArchiveFeedLabel` passes it to `describeArchiveFilters` so
      two different feeds stop sharing one title.
- [x] Feed and `private`: the page omits `feedHref` (which drives both the
      button and the autodiscovery link), and the feed route 404s as the
      backstop — for the author too, since the bytes a feed produces are the
      ones any subscriber would get.

## Copy

**No new strings.** `archive-labels.ts` is deliberately one vocabulary shared by
three composers (see the 2026-08-17-1430 task); giving readers a second set of
words would undo that. "Hidden from Latest" is true for a reader too — those
posts really are not on `/latest`.

## Results

- `archive-params.test.ts` (+8): signed-out `?visibility=hidden` filters;
  `?visibility=private&format=note` → 302 to `?format=note`; 302 for the auth
  strip against 308 for a legacy-only rewrite; the redirect fires unchanged on a
  site holding no private posts at all; the author's own private filter renders;
  no feed link while private is active; the feed carries the selection;
  `/archive/feed?visibility=private` → 404.
- **`custom-archive-url.test.ts` (new).** `page.tsx:577` had no coverage, which
  is how the bug shipped. A stored public query renders (proving the routing
  works, so the next case is the guard rather than a dead path); a stored
  private query 404s signed-out, does not leak the public archive under that
  name, and renders for the author.
- `ArchivePage.test.tsx` (+2): the chip renders signed-out with public, hidden
  and featured and without private; private appears for the author.
- `check-tests` 3638 passed / 280 files, `check-lint` clean, `check-types`
  clean, `i18n-check` unchanged at 100% — confirming the no-new-strings claim.
  `check-format` flags only files this change never touched.

## Not in this change

- **Saved views** and the `viewRequiresAuth` floor they need. This change only
  makes the ground they stand on correct.
- **A lock marker in the dash's Custom URLs list.** Dropped at the author's
  request. Note the consequence: an existing custom URL carrying
  `visibility=private` becomes a silent 404 for visitors, with nothing in the
  dash saying so.
- **`noindex` on filtered archive views.** Moved to phase 2 below — its own
  commit, straight after this one.

---

# Phase 2 — Indexing: what a reader assembled is not a page

Separate commit, straight after phase 1. It changes indexing behaviour for URLs
that already exist, independent of visibility, so it earns its own message.

## Why

The archive page sits in no cache at all: it is not in
`isWorkerResponseCachePath` (feeds, sitemap, robots, icons only) and carries
`private, no-store`. Every render is the 6-way `Promise.all` at `archive.tsx:434`
plus `getPostAliases` — seven D1 queries per hit. The facet space has no ceiling
(`media` is a comma-joined subset of kinds, multiplied by year × collection ×
format × title × replies × sort), and the page emits neither `canonical` nor
`noindex`. So a crawler walking the facets is billed as Worker invocations, and
the duplicates are left for a search engine to arbitrate on its own.

Visibility adds to a problem it did not create.

## What gets which treatment

| URL                                         | Treatment                    |
| ------------------------------------------- | ---------------------------- |
| bare `/archive`                             | indexable, self-canonical    |
| `layout` only                               | `rel="canonical"` without it |
| any filter dimension, **or `sort=updated`** | `noindex, follow`            |
| `path_registry` archive paths (`/quotes`)   | indexable, self-canonical    |

`sort` belongs with the filters, not with presentation. The year axis follows it
(`archive.tsx:216` — `axisAfter/Before` vs `publishedAfter/Before`), so
`?year=2024&sort=updated` is a different _set_, not the same set reordered; and
under pagination a different order is a different first page regardless.
`buildArchiveFeedQuery` already says as much by carrying `sort` while dropping
`layout` and `page`. `layout` is the only true presentation param: same posts,
same order, different markup.

`page` stays indexable — pagination is genuinely distinct content, not a facet,
and the sharded post sitemaps make discovery independent of it either way.

`noindex` and `canonical` never appear on the same URL; the two signals
contradict each other. One per URL.

**Not robots.txt `Disallow`.** That blocks crawling, not indexing: the URL can
still be listed bare, and the crawler can no longer read the `noindex` or
`canonical` that would have settled it.

## Plan

- [x] `isReaderAssembledArchive()` in `archive.tsx` — filter dimensions **plus**
      `sort`, and false whenever the query came from `path_registry`. Same
      `queryOverrides` seam as the auth guard.
- [x] **`hasActiveArchiveFilter` left alone.** It answers a different question —
      whether to run the baseline count and render `42 of 1,240`. `sort` does
      not change that count, so folding it in would buy a wasted query and the
      label `1,240 of 1,240`. Two questions, two named predicates.
- [x] `BaseLayout`'s `noindex` prop widened to `boolean | "follow"`, since the
      hardcoded meta was `noindex, nofollow` and a facet needs its links walked.
      Resolution moved into `BaseLayout` alone, and a site-wide noindex now wins
      outright — a page policy may narrow further, never relax. (`render.tsx`
      used to resolve the same thing a second time and now passes through.)
- [x] `X-Robots-Tag: noindex, follow` alongside it, the shape `brand.tsx` and
      `theme-sample.tsx` already use.
- [x] `canonicalHref` on every non-facet archive URL, built from `c.req.path`
      plus `page` when past the first. Everything else that can appear on such a
      URL renders the same posts in the same order — `layout` is markup,
      `visibility=all` selects nothing, tracking params select nothing — so they
      consolidate onto the bare path.

## Results

`archive-indexing.test.ts` (new, 7 cases): the bare archive is indexable with a
self-canonical; `layout=grid`, `visibility=all` and `utm_source` all consolidate
onto `/archive`; `page=2` keeps its number; `format=note` is `noindex, follow`
in both the meta tag and the header with no canonical; `sort=updated` is a facet
too; a site-wide noindex still says `noindex, nofollow` on a facet; a stored
archive path stays indexable and self-canonical even though its query is a
filter.

`check-tests` 3647 passed / 281 files, `check-lint` and `check-types` clean.

## The hreflang set had to follow

Adding a canonical put it in contradiction with the alternates already being
emitted. `buildSurfaceAlternates` appends the request's own query string, so on
`/archive?utm_source=nl` the canonical said `/archive` while the
self-referential alternate said `/archive?utm_source=nl` — one page, two
identities. Every member of an hreflang set has to be a canonical URL, so the
set now mirrors the canonical: the same trimmed query where there is one, and
nothing at all on a facet, which has no canonical to build a set from.

The helper takes an optional `query` override; the five other surfaces that
call it pass nothing and are untouched.

## Not in this change

`og:url` still carries the request's full query, so it disagrees with the
canonical on the same URLs. It is set in `BaseLayout` for every surface and is
an unfurl hint rather than an indexing signal, so it is a separate decision from
this one.

## Consequence worth stating

Once reader-assembled facets stop being indexed, the way an author gets a
particular filtered view found is to save it as a custom URL. That gives
`path_registry` a second reason to exist and makes the saved-view feature more
valuable: "I want this findable" becomes a deliberate act instead of an accident
of what a crawler happened to walk.
