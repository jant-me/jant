# Automation and API

If you want scripts, scheduled jobs, or agents to operate your own Jant site, this is the entry point. By the end you should know how to issue a token, which endpoints to call, and how to debug failures.

Jant provides two channels:

- **HTTP JSON API**: general-purpose, works with curl.
- **MCP interface** (`/api/mcp`): for agents that already speak the tool-calling protocol.

For full field definitions and request bodies, see the [API Reference](API.md).

If you scaffolded the site with `create-jant`, the project also ships with:

- `AGENTS.md`
- `.agents/skills/`
- `.claude/skills/`
- `examples/agent-content-automation/README.md`

So an agent working inside the generated project gets more than an API token — it sees the project conventions and ready-to-run examples directly.

## Which path first

- Scripts, scheduled jobs, external integrations: use the **HTTP API**.
- The caller is itself an MCP client: use **MCP**.
- An AI assistant working with one site: hand it that site's `/skill.md` URL (for example, `https://example.com/skill.md`) — a site-bound guide to reading, publishing, organizing, and migrating content through HTTP or MCP. For migrations, follow its dedicated import workflow and see [Export and import](export-and-import.md#coming-from-another-blog-or-cms).

Default to HTTP. MCP only beats it when the caller already speaks the tool-calling protocol.

## Local CLI

Operations that touch the local environment or the database stay on the CLI: `migrate`, `deploy`, `reset-password`, `site snapshot`, `site export`, `site import`, `db export`, and so on. These commands read and write the database or site deployment directly — no HTTP, no API token. See [Export and import](export-and-import.md).

Content automation (publishing posts, uploading media, updating settings) goes through HTTP or MCP.

## HTTP API

### Issuing a token

1. Sign in to the site and open **Settings → API Tokens**.
2. Click **New Token** and give it a recognizable name — that's how you identify it later when revoking.
3. Copy the string that starts with `jnt_`. **It's shown only once** — if you lose it, issue a new one.

To revoke, delete the row on the same page; revocation takes effect immediately. Today every token is site-scoped with full read/write — no scopes, no expiry. Both may show up later; this page will be updated when they do.

For local development, `DEV_API_TOKEN` from `packages/core/.dev.vars` works the same way.

### Authentication

Send the header:

```
Authorization: Bearer jnt_...
```

A few public read endpoints don't need a token by default: `GET /api/collections`, `GET /api/collections/:id`, `GET /api/nav-items`, `GET /api/search`, `GET /api/public/posts`, `GET /api/public/posts/:slug`, `GET /api/public/archive`. When `PUBLIC_API_ENABLED=false`, `/api/public/*` returns `404` to every caller; Collection, navigation, and search JSON reads require a browser session or Bearer token. Public HTML pages, including `/search`, remain available.

### Common endpoints

| Endpoint              | Methods                     | Purpose                                                                                                                             |
| --------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/api/posts`          | GET / POST / PUT / DELETE   | List, read, create, update, delete posts                                                                                            |
| `/api/public/posts`   | GET                         | Public read of published posts (no token)                                                                                           |
| `/api/public/archive` | GET                         | Public archive feed — includes `latest_hidden`, supports year/collection/language/media/title/replies/visibility filters (no token) |
| `/api/upload`         | POST / GET / PATCH / DELETE | One-shot multipart upload, single file per call — preferred for scripts                                                             |
| `/api/uploads`        | POST → PUT → POST           | Multipart upload session — for large files or unstable networks                                                                     |
| `/api/attachments`    | GET                         | Fetch raw attachment content by id                                                                                                  |
| `/api/collections`    | GET / POST / PUT / DELETE   | Collections (GET needs no token)                                                                                                    |
| `/api/settings`       | GET / PUT                   | Site settings                                                                                                                       |
| `/api/search`         | GET                         | Full-text search (public, IP-rate-limited)                                                                                          |
| `/api/mcp`            | POST                        | MCP JSON-RPC (`initialize` / `tools/list`, etc.)                                                                                    |

`/api/upload` and `/api/uploads` differ by a single `s` but mean different things — the first is a one-shot single-file multipart upload, the second is a three-step init/part/complete session. Default to `/api/upload`; reach for `/api/uploads` only when files are large or the connection is unreliable.

### Minimal example: post a note

```bash
curl -X POST "$JANT_URL/api/posts" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "note",
    "body": "Hello from curl."
  }'
```

For more formats (`link`, `quote`) and advanced fields (`collections`, `publishedAt`, `slug`, `pinned`, `featured`), see `examples/agent-content-automation/`.

### Upload an image

```bash
curl -X POST "$JANT_URL/api/upload" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -F "file=@./path/to/photo.webp" \
  -F "alt=Cover image"
```

### Update settings

```bash
curl -X PUT "$JANT_URL/api/settings" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @./examples/agent-content-automation/site-settings.json
```

### Error responses

Every failure under `/api` returns JSON with a fixed shape:

```json
{
  "error": "human readable message",
  "code": "ERROR_CODE",
  "details": "..."
}
```

`details` is present only on 400 validation failures and carries the field-level information. Common status codes:

| Status | `code`                         | Meaning and handling                                                                 |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------ |
| 400    | `VALIDATION_ERROR`             | Request body failed validation; fix per `details`                                    |
| 401    | `UNAUTHORIZED`                 | Missing or invalid token; reissue and update env vars                                |
| 403    | `FORBIDDEN`                    | Token is valid but lacks access to the resource                                      |
| 404    | `NOT_FOUND`                    | Resource doesn't exist                                                               |
| 409    | `CONFLICT` and friends         | State conflict (slug collision, hosted media quota, etc.)                            |
| 429    | `RATE_LIMIT`                   | Rate-limited; see below                                                              |
| 500    | `EXTERNAL_SERVICE_ERROR`, etc. | Server error; retry, and if it keeps failing, send the request details for debugging |

### Rate limiting

Today only `/api/search` enforces a per-IP per-minute limit (controlled by the deployment's `appConfig.rateLimit.searchPerMinute`; for the default see [Configuration](configuration.md)). Other endpoints have no hard rate limit, but a single Cloudflare Workers instance has limited concurrency — for bulk writes, keep calls sequential and add a small gap between writes when needed. If more rate limits are introduced later, they'll return `429` with `Retry-After`, and this section will be updated.

## MCP interface

For agents that already support MCP. The transport is HTTP JSON-RPC:

- **Path**: `/api/mcp`
- **Authentication**: scripts and agents send `Authorization: Bearer jnt_...`; same-origin browser extensions can reuse the session cookie.
- **Protocol header**: `MCP-Protocol-Version: 2025-06-18`. This page is updated when the version changes.
- **Methods**: `initialize`, `ping`, `tools/list`, `tools/call`.

Tools are grouped by resource: `posts`, `media`, `attachments`, `collections`, `settings`, `search`. Get the exact tool names and parameters from `tools/list`; they map one-to-one with the HTTP endpoints.

Minimal initialization request:

```bash
curl -X POST "$JANT_URL/api/mcp" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
```

When to use MCP: the caller already has an MCP client; you want Jant exposed as a set of tools rather than handwritten fetch calls.

When not to use MCP: simple shell scripts; one-off bulk content imports; anything that doesn't need tool discovery or the tool-calling protocol.

## Recommended starting point: get these three calls working first

If the goal is just "let an agent reliably publish posts, upload images, and change settings," getting these three HTTP calls working is enough:

1. `POST /api/posts`
2. `POST /api/upload`
3. `PUT /api/settings`

Once those are stable, layer on MCP, multi-tool orchestration, or more complex content workflows.

## What's next

- [API Reference](API.md) — full fields, request bodies, error formats
- [FAQ](faq.md)
- `examples/agent-content-automation/README.md` in the generated project — runnable end-to-end examples
