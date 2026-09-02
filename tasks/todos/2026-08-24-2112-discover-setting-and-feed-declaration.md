# Discover: site setting + feed declaration (jant-core side)

Core's half of the Jant Discover feature (the community pulse page it feeds).
Core owns the protocol — the site setting, the `<jant:discover>` element and the
ping — and `docs/discover.md` (published at `/docs/discover`) is where it is
specified for good; the cloud crawler and pulse page are planned in the
jant-cloud repo under `tasks/todos/` (`…-discover-pulse-service.md`, temporary
like any task file). Design history lives in Claude's project memory
(`discover-and-stats-direction`).

## Settled design

- **Feature name**: "Discover" (plain verb, quiet-tool register; no branded
  mascot name). Public page will live on the project site (`/discover`).
- **Site setting**: single enum `discover: latest | featured | off`,
  default `latest`. Stored so that "never explicitly set" is distinguishable
  from an explicit choice (nullable column / absent row), because:
  - demo mode → locked to `off` (same treatment as the noindex demo lock);
  - `noindex` enabled and `discover` **unset** → effective `off`
    (someone hiding from search engines must not be surfaced by default);
  - explicit choice always wins.
- **Feed declaration element**: every Atom feed the site emits carries, in the
  feed header:

  ```xml
  <feed xmlns="http://www.w3.org/2005/Atom" xmlns:jant="https://jant.me/ns">
    <jant:discover feed="https://site.example/latest/feed">latest</jant:discover>
  ```

  - value = effective mode (`latest` | `featured` | `none`);
  - `feed` attribute = absolute URL of the feed to poll
    (`/latest/feed` or `/featured/feed` via `toAbsoluteSiteUrl`); omitted for `none`;
  - emitted in **all** Atom feeds (main, latest, featured, archive, collection),
    so the crawler learns the truth from whichever URL it holds;
  - namespace URI is the fixed identifier `https://jant.me/ns` (permanent
    identifier, not environment-dependent — same policy as published-markdown
    links);
  - normal feed readers ignore the unknown namespace; no subscriber impact.
  - Why in-feed (not `/.well-known`, not HTML meta): sites under
    `sitePathPrefix` don't own the domain root; the crawler already lives on
    feeds. Precedent: podcast `<itunes:block>`.

- **Settings UI** (settings/general): rename the current "Search" section to
  **"Site visibility"** and house both concerns as parallel checkboxes
  (pattern borrowed from Pika's settings, adapted to Jant copy register):
  - existing: "Allow search engines to index my site"
  - new: "Show my site and posts in Jant Discover" — checked by default;
    when checked, an indented sub-choice appears: **Latest (default) / Featured
    only**, each with a one-line description (Latest: draws from your latest
    public posts; Featured: only from featured posts).
  - **Keep tunable numbers out of the translated strings.** Discover shows one
    post per blog at a time, on a rotation, never sooner than a day after
    publishing — but the rotation interval, the candidate window and the
    per-blog throughput are cloud-side constants that will be tuned during the
    dark launch (current values: MIN_DWELL 6h, candidate band 24h–48h,
    fallback/eviction age 14d, cap 50). Baking those into `.po` strings means
    re-translating every locale on each tuning pass. UI copy states only the
    stable promises — one at a time, at least a day's delay, and the per-post
    escape (Hidden from Latest) — and links to `/docs/discover` for the rest.
  - The copy must not promise that _every_ post appears: a blog publishing more
    than the throughput cap has the excess age out unshown, by design.
  - Unchecked ⇒ `off`. DB keeps the single enum; re-checking after an
    explicit `off` returns to `latest`.
  - Section intro line + docs link via `getJantDocsUrl()` → `/docs/discover`
    (URL passed down from the server with initial state, as usual).
  - Section stays last on the page (page reads inward → outward:
    Site → Time → Feeds → Home → Site visibility).

## Tasks

Both phases have landed. C1 was storage, effective mode, the feed
declaration, sibling links and alias ordering; C2 was the settings UI, the
ping, and `docs/discover.md`.

- [x] Storage: `DISCOVER` in `CONFIG_FIELDS` (`types/config.ts`) plus a
      `Bindings` entry. **Settings are a key-value table (`site_setting`), not
      columns** — `noindex` needs no schema of its own and neither does this,
      so neither `db-schema-generate` nor `db-schema-generate-pg` is involved.
      Unset stays tellable apart from explicit through an absent row, read with
      `Object.hasOwn` the way `siteDescriptionExplicit` already is.
      The field carries **no `editor`**: Config Editor requires every editable
      field to resolve to a concrete valid value, and this one's default is
      "unset". Give it a `configEditorLink` in C2 instead, once the
      settings/general control it would point at exists.
- [x] Effective-mode derivation helper: `resolveDiscoverMode` in
      `lib/discover.ts`, called from `resolveConfig` onto `appConfig.discover`.
      Beyond the demo lock and the noindex rule it also resolves `none` when
      `RSS_FEEDS_ENABLED=false` — every feed path 404s in that state, so there
      would be nothing for a crawler to poll.
- [x] Feed renderer: `<jant:discover>` in every Atom feed header, with the
      `jant` namespace declared only when the element is present.
      `buildFeedDiscoveryFields(c)` in `lib/feed-policy.ts` is the single place
      the fields are computed; all four `FeedData` assembly sites
      (`routes/feed/feed.ts`, `archive.tsx`, `collection.tsx`,
      `smart-collection.tsx`) spread it. The `feed` attribute names _this
      view's_ feed, so a language view points at its own.
- [x] **Sibling-language feed links.** Each language view already has its own
      feed, filtered to that language and correctly labelled with `xml:lang`
      (`getViewLang` returns the primary language at the root, so nothing is
      mixed). What a consumer holding one feed cannot do today is find the
      others. Emit, in every Atom feed header, one
      `<link rel="alternate" hreflang="{tag}" href="{that language's feed}"/>`
      per active language — plain Atom (`hreflang` is a defined `atom:link`
      attribute, and multiple alternates with distinct `hreflang` are allowed),
      no custom namespace, and the same idea `buildSurfaceAlternates` already
      applies to HTML surfaces. Skip `x-default`; it has no meaning for a feed.
      Single-language sites emit nothing extra.
      This is what lets a directory enumerate a bilingual blog's languages from
      any one of its feeds.
      Built on `buildSurfaceAlternates`, which gained an `xDefault` option so
      feeds can opt out of the entry it appends for HTML surfaces. The links
      carry `type="application/atom+xml"`: Atom forbids two `rel="alternate"`
      links sharing a type/hreflang pair, and the site's own HTML alternate
      has neither.
- [x] Settings UI: "Site visibility" section rename + Discover checkbox with
      conditional Latest/Featured sub-choice (`GeneralContent.tsx`,
      `jant-settings-general.ts`, settings-bridge, route schema).
      **The group saves on its own button rather than on change**, unlike the
      indexing checkbox beside it. Two reasons, and the second is the one that
      matters: the checkbox and the mode are a single decision, and a site
      happy with the default has to be able to _confirm_ it — that
      confirmation is what tells the directory the site exists, and there is
      no way to express it by toggling something already on. Without this the
      ping rule below would be unreachable for exactly the sites it exists
      for. A Save button is already the page's idiom for multi-field groups.
      The control is locked off, with a reason shown, for a demo site and for
      a site with `RSS_FEEDS_ENABLED=false`.
- [x] i18n: 11 new strings, zh-Hans and zh-Hant written natively; all three
      locales back at 100% coverage. Glossary entries added: zh-Hans 发现,
      zh-Hant 探索, both with a note against the other reading.
- [x] **Discover ping** (self-hosted enrollment without a submission form):
      when the setting transitions to an enabled mode, POST the site's feed URL
      once to the configured Discover endpoint. Rules: - fires ONLY on that transition — never periodically, never per post,
      never while the setting is off. Publishing must stay a local act; - the transition is: **an explicit save lands the setting in an enabled
      mode from unset or off**. The setting defaults to enabled (pre-checked
      box, stored value unset), so a strict off→on rule would never fire for
      a site that simply confirms the default — leaving it undiscoverable
      except via the cloud's manual submission form. latest ⇄ featured while
      already enabled does not re-ping (the receiver no-ops for listed sites
      anyway). Mirrored in the cloud plan's enrollment section; - `DISCOVER_PING_URL` env var, defaulting to Jant's endpoint, empty
      disables it. A self-hoster can point it at another directory; - payload is the feed URL and nothing else — no identity, no telemetry; - fire-and-forget: failures are logged, never block saving the setting,
      and are not retried. The cloud keeps two backstops: its periodic
      consent re-check covers sites it already knows, and its manual
      submission form covers a lost ping from a site it has never seen —
      the re-check cannot find a site the cloud never heard of; - the settings UI must say plainly that turning this on tells the
      directory the site's address.
      Not WebSub / not XML-RPC `weblogUpdates.ping`: Discover holds entries for
      24h by design, so push buys no latency, and the feed declaration is
      already the interop surface any third-party directory can read.
      `lib/discover-ping.ts`, on the guarded-`waitUntil` shape
      `github-sync-trigger.ts` already uses. The transition is decided in the
      settings service (`updateDiscoverSetting` returns `shouldAnnounce`), and
      the route re-derives the effective mode before announcing, so a site
      that cannot actually be polled never advertises an address that 404s.
      **`getDiscoverPingUrl` is presence-aware**, not `getEnvString`: the two
      states are spelled differently — an absent binding means Jant's
      directory, an empty one means announce nowhere — and `getEnvString`
      collapses both to undefined, which would turn the documented way of
      switching the ping off into switching it on.
- [x] Verify `paths.getPostAliases` returns a stable, oldest-first ordering:
      the Atom `<id>` is the permalink built from `aliasPath ?? /slug`
      (`toPostView`), so Discover keys entries on `aliases[0]`. If that order
      can change, a post's feed identity flips and the crawler sees delete +
      republish. Fix the ordering in core if it isn't guaranteed, and cover it
      with a test — this is a feed-stability property worth holding regardless
      of Discover.
      It was not guaranteed: the query had no `ORDER BY` at all, so a second
      custom URL could take over a post's permalink, its Atom `<id>`, and its
      sitemap `<loc>`. Now ordered by `createdAt`, then `id`.

  **`<id>` is still not stable across a slug rename**, and that is
  accepted rather than fixed. `updatePostSlug` rewrites the `kind:'slug'`
  row in place and creates no alias, so an ordinary post — one with no
  custom URL — gets a new permalink and therefore a new `<id>`. A crawler
  reads that as a withdrawal plus a new post: the old id leaves the feed
  while older entries remain, its permalink 404s, and the new id arrives
  carrying the original `published`, so it lands outside the candidate
  band and can only return as the blog's fallback representative. Bounded,
  and cheaper than either alternative — a `<jant:id>` per entry, or moving
  Atom `<id>` to a `tag:` URI, which would make every existing subscriber
  re-see every post once. `docs/discover.md` must say so, and so must the
  cloud plan.

- [x] Docs: `docs/discover.md` (published as `/docs/discover`) — the single
      place where the behaviour is described in full, so the UI copy can stay
      free of tunable numbers: - what Discover is, the three modes, and the ping (what it sends, when it
      fires, how to disable or redirect it); - how a post gets picked: only posts at least a day old are candidates,
      one post per blog is shown at a time and rotates, a blog that publishes
      heavily will have some posts never appear, and a quiet blog keeps its
      most recent post as its standing entry. Say plainly that the exact
      intervals may change — this page describes behaviour, not a contract; - the two escape routes, since they answer the pressure-free-publishing
      concern: during the delay nothing has been shown yet, and afterwards
      ticking **Hidden from Latest** (or going private / back to draft) drops
      the post out of `/latest/feed`, which removes it from Discover on the
      next poll — no deletion required; - the `<jant:discover>` element, specified well enough for a third-party
      directory to honour it.
      Written without any tunable number in it, which turned out to be
      possible throughout: "about a day", "a few hours", "a couple of weeks".
      A tuning pass therefore needs no doc change at all. Translated as
      `docs/zh-Hans/discover.md`; both SUMMARY files updated.
- [x] Tests for C1: `lib/__tests__/discover.test.ts` (effective-mode
      derivation), `lib/__tests__/feed.test.ts` (element per mode incl.
      `none`, absolute `feed` URL with `sitePathPrefix`, sibling links),
      `routes/pages/__tests__/language-routing.test.ts` (per-language
      declaration and sibling links through the real app),
      `services/__tests__/path.test.ts` (alias ordering — checked to fail
      without the fix).
- [x] **Publish the site's own name in the feed.** Found while building the
      cloud crawler: no feed carries it. Every feed title is composed
      (`"<site> - Latest posts"`, `"<site> - City Walks"`), which is right for
      a reader's sidebar and useless as a name, so a directory has nothing to
      label a blog with. Hosted blogs work around it through the control
      plane's own projection; self-hosted blogs stay unnamed until this lands.
      Done as a feed-level `<author><name>` — plain Atom, idiomatic for a
      single-author blog, useful to every feed reader, and no new namespace.
      The cloud can now name a self-hosted blog instead of falling back to its
      host.
- [ ] **Consider ETag / Last-Modified on feed responses.** The crawler sends
      conditional-GET headers and core never answers with validators, so every
      poll transfers the whole feed. Cheap to add next to
      `RSS_FEED_CACHE_CONTROL`, and it makes every feed reader cheaper too, not
      just Discover.
- [x] Tests for C2: `lib/__tests__/discover-ping.test.ts` (what is sent, the
      empty-binding case, failures swallowed and logged, no `executionCtx`),
      `lib/__tests__/discover.test.ts` (the presence-aware URL),
      `services/__tests__/settings.test.ts` (the announce rule in all five
      cases), `client/components/__tests__/jant-settings-general.test.ts`
      (section rename, conditional sub-choice, confirming the default, the two
      locked states). The save round-trip was exercised against a running
      site through the documented `__dev/login` helper.

  One thing left alone: an invalid body on this endpoint answers 500, not 400.
  That is `parseValidated`'s existing behaviour — the neighbouring
  `/settings/general/search` does the same — so fixing it belongs to a
  change that covers every settings endpoint, not to this one.

- [ ] Verify: `mise run check-tests`, `mise run check-lint`,
      `mise run check-copy`.

## Explicitly out of scope (core)

- Any crawler/pulse-page logic (cloud side).
- Reader accounts, following, mute, reactions, counts of any kind.
- Hosted onboarding disclosure copy (cloud side, where hosted signup lives).
