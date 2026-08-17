# Paste an address where a picker asks for a page

Let the author paste a URL or a path anywhere a picker is really asking "which
post?", instead of forcing them to remember a title.

## Rule

A picker whose output is an internal entity id accepts an address and
**resolves** it. A box whose output is a text query never does — pasting a URL
into full-text search stays a full-text search, because looking for the post
where you linked something is a real thing to do.

- Link a translation → resolve (highest value: candidates are pre-filtered, so
  a title search that finds nothing cannot say why)
- Navigation → add page → resolve, and upgrade: an internal address becomes a
  `page`/`collection` item that follows its target, not a frozen link string
- Command palette → already has `/path` mode; teach it a pasted full URL
- Public `/search` → untouched

## Plan

- [x] `lib/url.ts`: `toInternalPath()` + `looksLikeAddress()`; refactor
      `navigation.ts#getComparableInternalPath` onto it
- [x] `lib/view-language.ts`: `languageUrlPrefixes()` — every prefix a path can
      arrive under, so `/en/about` resolves like `/about`
- [x] `services/path.ts`: `resolveTarget()` — resolve following stored redirects
- [x] `services/post.ts`: `resolveTranslationCandidate()` — the eligibility
      rules, stated as reasons
- [x] `services/navigation.ts`: `resolveNavTarget()`
- [x] Routes: `GET /api/posts/:id/translations/resolve`, `GET /api/nav-items/resolve`
- [x] `jant-post-picker`: search returns `{ items, note }` so a resolution can
      explain itself
- [x] `jant-post-menu`: address branch in the translation picker
- [x] `jant-nav-manager`: address branch, collection targets, external → prefill
      the link form
- [x] `jant-command-palette`: same-origin full URL → path mode
- [x] New nav labels + zh-Hans/zh-Hant copy
- [x] Tests: url, view-language, path, post, navigation, both routes, three
      client components
- [x] Docs: `multilingual.md` (en + zh-Hans), `API.md`
- [x] `check-lint`, vitest, `i18n-build`

## Results

Done. All three pickers resolve a pasted address; public search is untouched.

**Shape.** One pure helper (`toInternalPath`) turns an address into the path
the router resolves against — accepting any host the site answers on (the
configured origin _and_ the request origin, for hosted custom domains), the
site path prefix, and language prefixes. A full URL must sit inside the
deployment; a typed path need not, because `/about` on a site served from
`/blog` is what someone typing it means. Eligibility stayed in the services;
the two resolve endpoints answer "which entity, and may it be used here" in one
round trip, so a pasted address can never smuggle in an id the rules refuse.

**Every "no" is specific**: draft, private, untitled, no language, same
language, language already in the group, would merge two groups, already in
navigation, off-site, nothing there. That was the point — the author is looking
at a page they can see in another tab, so "nothing matched" is the wrong answer.

Three duplicated copies of "URL → internal path" (server nav service, client
nav manager, new code) are now one; the client copy was also missing site-prefix
handling, so prefixed deployments deduped suggested links wrong.

### Verified

- `mise run check-lint` — clean.
- Full vitest suite — 271 files, 3574 tests, all passing. (`mise run
check-tests` also runs `check-types`, which fails on six **pre-existing**
  `c.req.param("slug")` errors in `routes/pages/collection.tsx`; confirmed by
  stashing this work and re-running. Not touched here — that file belongs to
  in-flight work.)
- `i18n-build` — catalogs stable, zh-Hans/zh-Hant filled by hand, 100% coverage.
- Browser pass against `mise run dev-debug`, on a zh-Hans + en site: nav picker
  resolved a page, a collection, an already-added item, an untitled post, a
  missing address, and an off-site URL (which handed the URL to the link form,
  focus on the label); the added item landed as a **page** item, not a link.
  Translation picker resolved `/en/coffee-notes` to a linkable row and said
  "That post is a draft" for a draft. Palette turned a pasted
  `http://localhost:19020/colophon?page=2` into "Go to /colophon?page=2" and
  navigated there. Test posts, nav item, and the dev server were cleaned up.
