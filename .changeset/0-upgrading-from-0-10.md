---
"@jant/core": minor
"create-jant": minor
---

**Upgrading from 0.10.** This release makes the last changes before 1.0 to what 1.0 will keep. What to check, by who you are; the entries below give the details.

- **Everyone:** check your environment before upgrading, since a value the Settings pages would refuse now stops the site, such as `NOINDEX=1` in place of `true`. Replace `RATE_LIMIT_DISABLED=true` with `RATE_LIMIT_ENABLED=false`. An empty `CORS_ORIGINS=` now turns cross-origin access off. Keep CLI settings in `.env`, not `.env.node`. Run `jant migrate` once (`jant migrate --remote` on Cloudflare), or deploy with `jant deploy`, for two data backfills. One turns a Jant Discover choice of featured posts only off; turn Discover on again in Settings if you want to stay listed.
- **Cloudflare template sites:** replace the migrate and deploy steps in `.github/workflows/deploy.yml` with `npx jant deploy`, and fix the line in its "Check deploy prerequisites" step that reads `database_id`, which has skipped every deploy since March; copying the file from a new project does both. Add `keep_vars = true` to `wrangler.toml`, and check that variables you set in the Cloudflare dashboard are still there. `jant db export --remote` works on D1 again.
- **Node and Docker:** set `TRUST_PROXY=true` behind a reverse proxy, or every visitor shares one sign-in limit. With `docker run`, run `jant migrate` after each image update. A SQLite backup takes every `jant.sqlite*` file, and a restore deletes them all first; see the backup guide.
- **API and MCP clients:** pass `nextCursor` back as it is, since post and media IDs are no longer cursors. Update media with `PUT`, not `PATCH`. Read Markdown with `?content=markdown` in place of `/content`. Uploads answer `201` with the media object. `pinnedAt`, `featuredAt`, and `rating` take numbers only. Appearance settings go to `PUT /api/settings`. A `mediaId` already attached to another post answers `409`; upload the file again for a second post.
- **Custom CSS:** rename `--site-elevated-bg` to `--site-page-bg`, `--site-nav-hover-bg` to `--site-subtle-bg`, and `--search-mark-*` to `--site-search-mark-*`. `data-page` sits on `<body>`.
- **Exports and your own Hugo templates:** a Collection page's `summary_text` is `description`, and media entries no longer carry `provider`, `storage_key`, or `poster_key`. An export from this release doesn't import into 0.10 or earlier.
- **Addresses:** a post or Collection with several custom URLs lives at the oldest one. A custom URL starting with `_` or `.` no longer resolves; give the post a new one.

**Upgrade notes**

- No database migrations. `jant migrate` runs two data backfills.
