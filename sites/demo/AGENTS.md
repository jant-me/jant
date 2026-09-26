This is a standalone Jant site created with `create-jant`.

`CLAUDE.md` is a thin compatibility shim that points here. Site skills live in `.agents/skills/`.

## Project Shape

- `index.js` is the server entrypoint. In most projects it should stay a thin `createApp()` wrapper from `@jant/core`.
- `wrangler.toml` is the main deployment and binding config.
- `.dev.vars` holds local secrets such as `AUTH_SECRET`.
- `README.md` documents the normal site workflow for humans.

Most customization happens through:

- site settings from the Settings page
- custom CSS and theme variables
- HTTP API calls for content (posts, media, collections, settings, search)
- the built-in MCP endpoint at `/api/mcp` for remote agent tooling
- `jant` CLI commands for local-only ops: export, import, migrate, deploy, snapshot, reset-password
- examples in `examples/agent-content-automation/`

Do not edit `node_modules/@jant/core`. If you need reusable product changes, make them in the Jant monorepo instead.

## Commands

```bash
npm run dev
npm run deploy
npm run reset-password

npx jant migrate --local
npx jant site export --url https://your-site.example --output ./jant-site-export.zip
npx jant site import --url https://your-site.example --path ./jant-site-export.zip --dry-run
npx jant db export --output ./jant-export.sql
```

Content automation (posts, media, collections, settings, search) goes through the HTTP API or `/api/mcp`. See `.agents/skills/jant-http-api/SKILL.md` and `examples/agent-content-automation/`.

Use `npm run deploy` for normal Cloudflare deploys. It applies remote migrations and prepares assets before calling Wrangler.

## Skills

Load the matching skill before making substantive changes:

- `building-jant-site`: project structure, settings, theming, local development, and deployment flow
- `jant-http-api`: automating posts, uploads, collections, settings, and search over HTTP
- `jant-site-ops`: export/import, snapshot recovery, deploy, reset-password, and database operations

## Rules

- Keep `index.js` minimal unless the site truly needs custom server behavior.
- Prefer settings, custom CSS, and documented extension points before changing runtime code.
- Use the HTTP API (`/api/posts`, `/api/upload`, `/api/collections`, `/api/settings`, `/api/search`) for scripted content automation. The CLI no longer covers content — those commands were removed because they were thin HTTP wrappers.
- Use `/api/mcp` when an MCP client is available and you need the site to expose posts, collections, settings, or search as tools.
- Start from `examples/agent-content-automation/README.md` if the task is content automation rather than app development.
- Use `bodyMarkdown` in API scripts instead of raw TipTap JSON unless you already have trusted editor output.
- Quote posts use `quoteText`, `sourceName`, and `sourceUrl`. Do not send `title` or `url` for quote payloads.
- `PUT /api/settings` accepts strings only, even for booleans and numbers.
- `GET /api/posts` includes thread replies. Filter them yourself if you only want roots.
- `latest_hidden` posts stay public by direct URL; they are only excluded from Latest surfaces.
- Run from the site root where `@jant/core` is installed.
