# Theme Export Model

Internal reference for how `site export` and GitHub Sync shape the
filesystem layout of an exported Jant site.

Audience: contributors working on `packages/core/src/services/export.ts`
or `packages/core/src/services/github-sync.ts`.

## Layout

Every Jant export is a Hugo site with a packaged theme at `themes/jant/`:

```
hugo.toml
content/
  _index.md
  archive/_index.md
  collections/_index.md
  featured/_index.md
  {root-slug}/
    _index.md                # thread root (branch bundle)
    {reply-slug}/
      index.md               # reply (leaf bundle, build.render = "never")
  {collection-slug}/_index.md
data/
  jant.toml                  # nav, branding, display preferences, ordered collections directory
themes/
  jant/
    theme.toml
    layouts/
      _default/
        baseof.html
        single.html
        list.html
        alias.html            # /{reply-slug}/ → /{root-slug}/#{reply-slug}
      index.html              # /
      post/list.html          # thread (branch bundle list layout)
      featured/list.html
      archive/list.html
      collections/list.html
      collection/single.html
      partials/
        head.html
        header.html
        footer.html
        pagination.html
        post-card.html
        reply.html
    static/
      tokens.css
      main.css
      theme.css                # color theme
      custom.css               # user's Custom CSS from Settings
      favicon.ico
      apple-touch-icon.png
README.md
.gitignore
```

Root `layouts/` and root `static/` are not emitted by the export
service. They are user territory: Hugo's override rule picks any file
under root `layouts/<name>.html` over
`themes/jant/layouts/<name>.html`, so users get per-layout overrides
without forking the theme. The CLI may populate `static/media/` when
`--pull-media` is on, but that is a CLI-level concern — the core
export service produces nothing at the repo root outside the
`JANT_MANAGED_GLOBS` list.

## hugo.toml

Three pieces are load-bearing for the theme model:

- `theme = "jant"` — tells Hugo to load `themes/jant/`.
- `paginate = pageSize` — drives home, archive, and featured pagination.
- `[permalinks] post = "/:slug/"` — keeps thread roots at root-level
  URLs independent of their on-disk location.

Post state and Thread-level collection state live in flat YAML front matter.
Collection membership is emitted only on the Thread root; reply bundles keep
their own post/media state but do not repeat membership. No custom taxonomies
are emitted — instead, the home, featured,
and archive layouts use `where` + `.Paginate` over `.Site.RegularPages`
to filter at render time. This means pinned-vs-public, featured, and
unlisted distinctions are encoded as front-matter fields (`pinned_at`,
`featured_at`, `visibility`), not as taxonomy membership. Featured remains a
per-Post selection; root bundles additionally carry the derived
`featured_post_ids` and `featured_sort_at` projection used to de-duplicate and
order Featured Threads. Thread activity is encoded on the root bundle as
`last_activity_at`; reply bundles do not carry a per-reply quiet marker.

## Front matter shape

Root post at `content/{slug}/_index.md`:

```yaml
id: pst_...
title: Hello
date: 2025-01-15T12:00:00Z
last_activity_at: 2025-01-16T08:00:00Z
slug: hello
type: post
draft: false
aliases:
  - /old-slug/
  - /reply-abc/ # reply slugs go here so /{reply-slug}/ aliases work
format: note
status: published
visibility: public
featured_at: 2025-01-20T00:00:00Z
featured_post_ids:
  - pst_...
featured_sort_at: 2025-01-15T12:00:00Z
pinned_at: null
collections:
  - slug: favorites
    collected_at: 2025-01-16T00:00:00Z
    position: 3
    pinned_at: null
resources:
  - src: hero.webp
    params:
      kind: image
      alt: ""
      width: 1200
      height: 800
```

Reply at `content/{root-slug}/{reply-slug}/index.md`:

```yaml
id: pst_...
title: ""
date: 2025-01-15T13:00:00Z
slug: reply-abc
type: post
build:
  render: never
  list: local
format: note
status: published
visibility: public
```

No `aliases` on replies. The reply's URL is redirected by the root's
`aliases:` list + the custom `_default/alias.html` template. Replies also omit
`collections`; older exports that contain reply-level entries are unioned into
the Thread root during import.

## URL scheme

| URL                   | Rendered by                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `/`                   | `index.html` — pinned prefix + paginated `visibility=public` tail                                         |
| `/page/N/`            | Hugo's native paginator on home (N ≥ 2)                                                                   |
| `/archive/`           | `archive/list.html` — every published post chronologically                                                |
| `/archive/page/N/`    | Hugo's native paginator on archive (N ≥ 2)                                                                |
| `/featured/`          | `featured/list.html` — one curated entry per Thread, ordered by the newest Featured Post publication time |
| `/{root-slug}/`       | `post/list.html` — thread root + inline replies                                                           |
| `/{reply-slug}/`      | `_default/alias.html` — redirects to `/{root-slug}/#{reply-slug}`                                         |
| `/{collection-slug}/` | `_default/list.html` — complete Threads in the collection                                                 |
| `/collections/`       | `collections/list.html` — reads `hugo.Data.jant.directory`                                                |

The home template handles the pinned prepend in-layout: it iterates
`where .Site.RegularPages "Params.pinned_at" "ne" nil` first, then
paginates `where (where .Site.RegularPages "Params.visibility" "eq"
"public") "Params.pinned_at" "eq" nil`. Hugo's `where` + `.Paginate`
composition makes this a one-template solution — no manual boundary
stitching between page 1 and page 2+.

## pageSize vs archivePageSize

Both come from the Jant site config (`SITE_CONFIG` via
`packages/core/bin/commands/site/export.js`).

- `pageSize` is Hugo's `paginate` value in `hugo.toml`. It controls
  `/page/N/`, `/archive/page/N/`, and `/featured/page/N/` page size.
- `archivePageSize` is threaded through `SiteConfig` for Node-side
  rendering on the live site and is not used by the exported Hugo
  templates directly.

Keeping both in `SiteConfig` avoids a drift where the Node-rendered
archive and the exported Hugo archive disagree on page size.

## Managed paths (hard list)

GitHub Sync keeps a single source of truth for which paths Jant owns:

```ts
// packages/core/src/services/github-sync.ts
export const JANT_MANAGED_GLOBS = [
  "content/**",
  "data/jant.toml",
  "themes/jant/**",
  "hugo.toml",
  ".gitignore",
  "README.md",
  ".jant-sync",
] as const;
```

Everything inside these globs is overwritten on every full sync, and any
managed-path file that Jant no longer generates is nulled out in the
push tree so deletions in the app (e.g. deleting a post) propagate to
GitHub. Everything outside is user territory and preserved via Git's
`base_tree` on the push commit. There are no tiers (no "init-only"
files, no "seed-on-first-push" exceptions) — the rule is binary.

Note the narrow `data/jant.toml` entry: only that single file is
managed. The rest of `data/` is open for the user's own Hugo data files
(`menu.toml`, `authors.toml`, etc.) and is never deleted by sync.

Corollary: a user who wants to edit Jant output must fork into root
(`layouts/{name}.html` shadowing `themes/jant/layouts/{name}.html`) or
override via `static/custom.css`. Editing anything under `themes/jant/**`
is pointless because the next push will revert it.

## .jant-sync marker

`.jant-sync` at the repo root identifies the repo as managed by a Jant
site and carries the schema version plus the site ID:

```json
{
  "schema_version": 3,
  "site_id": "sit_...",
  "site_host": "blog.example.com",
  "created_at": 1713225600,
  "managed_globs": [
    "content/**",
    "data/jant.toml",
    "themes/jant/**",
    "hugo.toml",
    ".gitignore",
    "README.md",
    ".jant-sync"
  ]
}
```

`managed_globs` is duplicated into the marker so future schema bumps
can diff the old set against the new set and decide what to clean up.
On older markers this field may be absent; the classifier still accepts
them as `"owned"` so existing connections don't break, and the next
full push rewrites the marker with the current schema.

The export service does **not** emit `.jant-sync`. Only `github-sync.ts`
writes it — it is the one component that knows the site ID.

## Deletion detection on push

`pushFullSync` reads the remote HEAD tree recursively, then for every
blob whose path matches `JANT_MANAGED_GLOBS` but is not in the current
push's written-path set, it appends a `{ sha: null }` entry to the tree
payload. This is what makes in-app deletions (deleting a post,
renaming a slug, removing a collection) propagate to GitHub —
`base_tree` alone would silently preserve orphaned files.

The check is symmetric: the same list (`JANT_MANAGED_GLOBS`) that
decides what Jant writes also decides what Jant is allowed to delete.
Files outside the managed globs are never touched regardless of what
the user has done on either side.

If GitHub's tree API reports `truncated: true` (more than 100k entries
or >7 MB of tree data), the push aborts with an error rather than
risking a partial deletion against an incomplete view of the repo.

## Customization paths for users

Documented in `docs/export-and-import.md` for site owners. The
implementation contract:

- Anything under root `layouts/<name>.html` replaces the matching theme
  layout. Partial overrides work — users can override
  `layouts/_default/single.html` without touching anything else.
- Anything under root `static/<name>` is served at `/<name>` exactly
  like Hugo's regular static output; root `static/` wins against
  `themes/jant/static/` when filenames collide.
- Users editing `themes/jant/**` will lose their changes on the next
  push. The recommended path is always root-level override.
- `hugo.toml` is managed: user edits will be overwritten. Site-wide
  config belongs in Jant's **Settings**, which is the source the export
  reads from.

## Testing

- `packages/core/src/__tests__/export-service.test.ts` asserts every
  theme path lives under `themes/jant/` and root `layouts/` is empty.
- `packages/core/src/__tests__/export-hugo-build.test.ts` spawns a real
  `hugo --minify` against the generated export and asserts that the
  expected URLs (home, archive, featured, collections, each thread,
  each reply alias) all render.
- The canonical fixture at `sites/demo-source/canonical/site-export/`
  must be regenerated any time the export layout changes — run
  `mise run demo-source-export-canonical-site-export` and commit the
  diff.
