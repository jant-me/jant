# GitHub Sync

GitHub Sync backs up your posts as Markdown files in a GitHub repository and syncs edits made on GitHub back into Jant. Every post change produces one commit, giving your content full Git version history.

The repository also acts as an interface for AI agents. Jant has an [HTTP API](API.md) and an MCP server, but many coding agents work more naturally with Markdown files than with API calls — a synced repository is a copy of your content they can read, edit, and commit directly.

## How it works

Jant is the source of truth. The GitHub repository mirrors Jant's content with a limited write-back channel: you can edit the content fields of existing posts on GitHub, but creation and deletion happen only in Jant.

**Jant → GitHub**: when you create, edit, or delete a post, Jant pushes the change to your repository as a Markdown file with YAML front matter. Thread replies become individual files nested under the root post directory. Media is not copied into the repository — it stays at its URL.

**GitHub → Jant**: when you edit a Markdown file on GitHub and push, a webhook notifies Jant. Jant matches the file to an existing post by the `slug` field in front matter and updates its content. **The webhook only updates content fields on existing posts — adding or deleting `.md` files on GitHub does not create or delete posts in Jant.** This avoids accidental loss (clearing the repository will not take down the site).

Jant's own commits are tagged with `[jant-sync]`. Webhooks carrying that marker are ignored, so changes never bounce back and forth.

### What fields are synced

- Post body (Markdown below the front matter)
- Title, URL, source attribution, quote text, rating, and other front matter fields
- Thread replies (each as a separate file nested under the root post directory)

Settings, navigation, Collections, and themes are not affected by webhooks.

## Connecting

### Personal Access Token

The method for deployments without a configured GitHub App. You need a GitHub **fine-grained personal access token** with these permissions on the target repository:

| Permission   | Access     | Why                            |
| ------------ | ---------- | ------------------------------ |
| **Contents** | Read/Write | Read and write Markdown files  |
| **Webhooks** | Read/Write | Auto-register the push webhook |

Create the token at [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta). Scope it to a single repository and grant only the Contents and Webhooks permissions.

1. Create a repository on GitHub (public or private — both work).
2. Open **Settings > Site > GitHub Sync** in Jant.
3. Paste the token and enter the repository as `owner/repo`.
4. Click **Connect**.

Jant validates the token, saves the configuration, and creates the webhook on the repository. No manual webhook setup required.

### GitHub App

Available when the deployment has a GitHub App configured. You never touch a long-lived token — Jant issues short-lived credentials on demand.

1. Open **Settings > Site > GitHub Sync** in Jant.
2. Click **Install GitHub App**. You're redirected to GitHub to pick which repositories the App can access.
3. After installing, return to Jant, choose the repository to sync, and click **Connect**.

## Full sync

After the first connect, Jant pushes everything once automatically. You can re-run it anytime from **Settings > Site > GitHub Sync** by clicking **Sync Now**.

### Paths Jant manages in the repository

These paths are managed entirely by Jant and overwritten on every push:

- `content/**` — posts, collections, sections
- `themes/jant/**` — the packaged Jant theme (layouts and static assets)
- `data/jant.toml` — navigation, branding, collections directory
- `hugo.toml` — site configuration, including the `theme = "jant"` line
- `.gitignore`, `README.md` — Jant-generated scaffolding
- `.jant-sync` — ownership marker

Files inside these paths that Jant no longer generates are removed on the next push. For example, deleting a post in Jant deletes the corresponding bundle from GitHub on the next sync.

`wrangler.jsonc` is the exception: Jant writes it when the repository does not have one and never touches it again. Its Worker name is derived from the site's host and often has to be corrected to match the Worker that serves the domain — see [Deploying to Cloudflare Workers](export-and-import.md#deploying-to-cloudflare-workers).

Everything else in the repository is left alone. To customize the site:

- Add `layouts/<name>.html` or `static/<name>` at the repository root to override files of the same name in the theme — Hugo prefers root-level versions.
- The rest of `data/` (anything other than `data/jant.toml`) is free for your own files (`menu.toml`, `authors.toml`, etc.).
- Don't edit `themes/jant/**` directly — the next push overwrites it.

See [Export and import](export-and-import.md) for details.

## Incremental sync

Once connected, every create, edit, or delete in Jant pushes the change to GitHub automatically. Each mutation produces its own commit:

- **Create or update root post**: writes `content/{slug}/_index.md`
- **Create or update reply**: writes `content/{root-slug}/{reply-slug}/index.md`
- **Delete**: removes the matching bundle from the repository

Incremental syncs run in the background and never block the Jant UI.

## Editing on GitHub

You can edit any Jant-managed Markdown file directly on GitHub, or edit locally and push. When the push reaches GitHub, the webhook fires and Jant updates the matching post.

Matching is by slug: Jant reads the `slug` field from the YAML front matter and looks up the corresponding post. Files that don't match are skipped.

Fields that GitHub edits update:

- `body` (the Markdown content below the front matter)
- `title`
- `link_url` (link posts)
- `source_name`, `source_url` (attribution for link and quote posts)
- `quote_text` (quote posts)
- `rating`

### Conflict handling

Webhook processing is last-write-wins: when a webhook arrives, Jant updates the post with the file's content directly, with no merge against Jant's current state. If you edit the same post in the Jant UI and on GitHub at the same time, whichever write lands last wins. A subsequent push from Jant will also overwrite any intermediate state on GitHub that hasn't flowed back. Avoid editing the same post in both places at once.

**Don't change the `slug` field**: slug is the matching key. If you change it, the file is treated as "an unmatched new file" and skipped — your edit won't reach Jant. To change a URL, do it in the Jant UI.

## Background processing

Sync runs in the background, so the UI never waits on GitHub — your save returns immediately and the push completes after the response.

While a push is in flight, the settings page shows **Syncing…**, switching to **Last synced** when it finishes. If a push fails, the error appears on the status card directly — no need to dig through logs.

Rapid edits coalesce: when a new change arrives before the previous push has finished, it's recorded as a "pending edit". Once the current push lands, another runs to push the latest state. Nothing is lost, and there are no concurrent pushes.

Implementation note: built on Cloudflare Workers' `executionCtx.waitUntil`, with no queue binding or separate consumer worker required.

## Disconnecting

Open **Settings > Site > GitHub Sync** and click **Disconnect**. Jant removes the webhook from GitHub and clears the sync configuration. The repository and its content are not deleted.

## File format

Posts are stored as Hugo-compatible Markdown with flat YAML front matter — the same format used by [Site Export](export-and-import.md).

Root posts live at `content/{slug}/_index.md`:

```markdown
---
title: "Hello World"
date: 2025-01-15T12:00:00Z
slug: hello-world
type: post
format: note
status: published
visibility: public
---

Post body goes here.
```

Thread replies are nested leaf bundles at `content/{root-slug}/{reply-slug}/index.md`:

```markdown
---
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
---

Reply content goes here.
```

## Limits

- One repository per site.
- Media attachments and text attachments are not stored in the repository — media is referenced by URL inside the Markdown, and text attachments don't participate in GitHub Sync.
- GitHub rate-limits authenticated users at 5,000 requests per hour. A full sync of 1,000 posts uses about 1,000 requests; an incremental sync uses 1–2 each.

## Self-hosting: configure a GitHub App

This section is for administrators configuring a GitHub App on their own Jant deployment. End users connecting through a GitHub App only need the [Connecting](#connecting) steps above.

Set the following environment variables on the Jant deployment to enable the GitHub App connect flow:

| Variable                    | Required | What it is                                                                                                                                                                                                                    |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_APP_ID`             | Yes      | Numeric App ID from the GitHub App settings page                                                                                                                                                                              |
| `GITHUB_APP_PRIVATE_KEY`    | Yes      | PKCS#8 PEM private key generated in the GitHub App settings. `\n` escapes are expanded automatically, so you can store it on a single line                                                                                    |
| `GITHUB_APP_SLUG`           | Yes      | App slug (the last segment of `github.com/apps/<slug>`). Used to build install URLs                                                                                                                                           |
| `GITHUB_APP_WEBHOOK_SECRET` | No       | Shared secret for GitHub App webhooks. Used by two endpoints: the per-repo push webhook (takes precedence over the per-site secret) and the App-level webhook at `/api/github-sync/app-webhook` (handles installation events) |

### Create the GitHub App

Go to **Settings > Developer settings > GitHub Apps > New GitHub App** (on either a user or organization).

> **Setup URL vs Callback URL**: GitHub Apps have two confusingly similar fields. The install flow uses **Setup URL** — once the user finishes installing, GitHub sends the browser there with `installation_id` and `state`. **Callback URL** is for OAuth user-to-server identification ("Sign in with GitHub"), which Jant does not use. Always set **Setup URL**, leave Callback URL blank.

1. **Homepage URL**: your Jant site
2. **Setup URL (optional)**: `https://<your-jant-site>/settings/github-sync/app/callback`
3. **Redirect on update**: checked
4. **Callback URL**: leave blank
5. **Webhook**: check **Active**, set the URL to `https://<your-jant-site>/api/github-sync/app-webhook`, and put the same value as `GITHUB_APP_WEBHOOK_SECRET` into **Secret**. This keeps Jant's installation state in sync when the App is uninstalled, suspended, or has repositories removed. Per-repo push webhooks are still registered automatically at the site host
6. **Repository permissions**: `Contents: Read & write`, `Metadata: Read-only`, `Webhooks: Read & write`
7. **Subscribe to events**: `Push`, `Installation`, `Installation repositories`
8. **Where can this GitHub App be installed**: "Only on this account"
9. Generate a private key (PKCS#8 PEM) and copy the App ID

## What's next

- [Theming](theming.md) — adjust the look of your site
- [Export and import](export-and-import.md) — Hugo export and site migration
- [Backups and recovery](backups.md) — full backup strategy
- [Configuration](configuration.md) — related environment variables
