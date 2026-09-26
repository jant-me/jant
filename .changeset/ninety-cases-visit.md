---
"@jant/core": minor
"create-jant": minor
---

Settles what 1.0 will freeze: one name per CLI command, `--url` for the site everywhere, a compatibility page and a CLI reference, the feed namespace documented for consumers, and checks that refuse exports and snapshots from a newer Jant. The legacy multipart upload relay goes, and `@jant/core` exports only `createApp`.

**Upgrade notes**

Command line. Each old form below stops with the command to run instead.

- `jant export` is now `jant db export`, `jant import-site` is `jant site import`, and `jant search-reindex` is `jant search reindex`.
- `jant site export` and `jant site import` take the site as `--url <url>` instead of a first argument.
- `jant site export --directory <dir>` is now `--output <dir>`. An `--output` path that doesn't end in `.zip` is a directory.
- `jant telegram register-webhooks --base-url` is now `--url`, and falls back to `SITE_ORIGIN`.
- `jant deploy --site-path-prefix` is now `--path-prefix`.
- `jant migrate-text-attachments` is removed. A site created before 2026-04-16 that has text attachments and never ran it: run it on 0.7.x before upgrading.

API and package

- `/api/upload/multipart` is removed. Upload through the sessions at `/api/uploads`, or `/api/upload` for one request.
- `@jant/core` exports only `createApp`, and the `@jant/core/node` subpath is gone. Run the Node server with `jant start`.

New projects

- `create-jant` no longer copies agent skills into `.agents/skills/` and `.claude/skills/`, where they went stale on every upgrade. `AGENTS.md` points agents at the site's `/skill.md`, `npx jant --help`, and the docs instead. Existing projects can delete both folders.
- The template's `npm run export` script ran the SQL dump under a name that read as the site export. It is removed; run `npx jant db export`.

**New**

- [Compatibility](https://jant.me/docs/compatibility): what 1.0 freezes, how a deprecation works, and which installs upgrade in place (0.3.39 and later).
- [Command line](https://jant.me/docs/cli): every public command and option. `jant --help` groups them by task.
- [Reading a Jant feed](https://jant.me/docs/feed-reading): every `jant:` element and attribute a feed carries, for anyone writing a reader.
- The configuration docs cover `CORS_ORIGINS`, `RATE_LIMIT_SEARCH_PER_MIN`, `RATE_LIMIT_DISABLED`, `DEFAULT_THEME`, `DEFAULT_FONT_THEME`, and `INTERNAL_ADMIN_TOKEN`.
- `jant site import` refuses an export in a newer format, and `jant site snapshot import` a snapshot from a newer schema, before writing anything. A snapshot's `meta.json` now records the Jant version and schema that wrote it.

**Performance**

- The stylesheet every public page waits for drops about 120 lines of footnote styles for markup Jant stopped writing.
