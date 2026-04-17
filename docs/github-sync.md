# GitHub Sync

GitHub Sync backs up your posts to a GitHub repository as Markdown files and optionally pulls edits back. Every post change creates a commit, giving you a full Git history of your content.

You keep writing in Jant as usual. GitHub is the backup and version-control layer.

A GitHub repository also serves as a file-based interface for AI tools. Jant provides an [API](API.md) and an [MCP server](https://github.com/jant-me/jant/blob/main/docs/internal/coding-standards.md) for programmatic access, but many AI agents and coding assistants work most naturally with plain files. A synced repository gives them a directory of Markdown files they can read, edit, and commit — no API client required.

## How It Works

**Jant to GitHub** — When you create, edit, or delete a post, Jant pushes the change to your repository as a Markdown file with YAML front matter. Thread replies are embedded in the root post file. Media stays where it is (referenced by URL, not copied into the repo).

**GitHub to Jant** — When you edit a Markdown file on GitHub and push, a webhook notifies Jant. Jant parses the file, matches it to an existing post by slug, and updates the content. Deleting a file on GitHub soft-deletes the matching post.

Jant marks its own commits with `[jant-sync]` in the commit message. Incoming webhooks with that marker are skipped, so changes never bounce back and forth.

### What Syncs

- Post body (Markdown)
- Title, URL, quote text, and other front matter fields
- Thread replies (merged into the root post file)

### What Does Not Sync from GitHub

- New posts cannot be created by adding files on GitHub. Only existing posts are updated.
- Media attachments are not modified. They remain at their original URLs.
- Settings, navigation, collections, and themes are not affected by incoming webhooks.

## Two Ways to Connect

Jant supports two authentication methods for GitHub Sync:

1. **Personal Access Token (PAT)** — always available. You create a token and paste it into Jant. Best for self-hosters.
2. **GitHub App** — available when the deployment has a GitHub App configured. Users install the App on their repo with a single click and Jant never touches a long-lived token. Best for hosted platforms.

When a GitHub App is configured, the setup page shows both options and recommends the App.

## Option A — Personal Access Token

You need a GitHub **fine-grained Personal Access Token** with these permissions on the target repository:

| Permission   | Access     | Why                          |
| ------------ | ---------- | ---------------------------- |
| **Contents** | Read/Write | Push and read Markdown files |
| **Webhooks** | Read/Write | Auto-create the push webhook |

Create the token at [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta). Scope it to a single repository for least privilege.

### Setup

1. Create a repository on GitHub (public or private, either works).
2. Open **Settings > Data > GitHub Sync** in your Jant dashboard.
3. Paste your token and enter the repository as `owner/repo`.
4. Click **Connect**.

Jant validates the token, saves the configuration, and creates a webhook on the repository. No manual webhook setup required.

## Option B — GitHub App (recommended for hosted)

When these environment variables are set on the Jant deployment, the GitHub App connect flow is enabled:

| Variable                    | Required | What it is                                                                                                                                  |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_APP_ID`             | Yes      | Numeric App ID from the GitHub App settings page.                                                                                           |
| `GITHUB_APP_PRIVATE_KEY`    | Yes      | PKCS#8 PEM private key generated in the GitHub App settings. `\n` escapes are expanded automatically, so you can store it on a single line. |
| `GITHUB_APP_SLUG`           | Yes      | App slug (the last segment of `github.com/apps/<slug>`). Used to build install URLs.                                                        |
| `GITHUB_APP_WEBHOOK_SECRET` | No       | Shared secret for GitHub App webhooks. Used by two endpoints: the per-repo push webhook (takes precedence over the per-site secret) and the App-level webhook at `/api/github-sync/app-webhook`, which reacts to installation and installation-repository events. |

### Creating the GitHub App

Go to **Settings > Developer settings > GitHub Apps > New GitHub App** (on your user or org). Two configurations are documented — pick the one that matches your deployment.

> **Setup URL vs Callback URL.** GitHub Apps expose two confusingly similar fields. The install flow uses **Setup URL** — that's where GitHub sends the browser after the user finishes installing, with `installation_id` and `state`. **Callback URL** is for OAuth user-to-server identification ("Sign in with GitHub"), which Jant does not use. Always set **Setup URL**, leave Callback URL blank.

#### Self-hosted (single site, one host)

1. **Homepage URL**: your Jant site.
2. **Setup URL (optional)**: `https://<your-jant-site>/settings/github-sync/app/callback`.
3. **Redirect on update**: ✅ checked.
4. **Callback URL**: leave blank.
5. **Webhook**: check **Active** and set the URL to `https://<your-jant-site>/api/github-sync/app-webhook`. Paste the same value used for `GITHUB_APP_WEBHOOK_SECRET` into **Secret**. This keeps Jant's installation state in sync when the App is uninstalled, suspended, or repositories are removed. Per-repo push webhooks are still registered automatically at the site host.
6. **Repository permissions**: `Contents: Read & write`, `Metadata: Read-only`, `Webhooks: Read & write`.
7. **Subscribe to events**: `Push`, `Installation`, `Installation repositories`.
8. **Where can this GitHub App be installed**: "Only on this account".
9. Generate a private key (PKCS#8 PEM) and copy the App ID.

#### Hosted / multi-site (one control plane, many site hosts)

A GitHub App only supports one Setup URL, but hosted sites live on different hosts. The control plane (`jant-cloud`) ships a dispatcher at `/api/github/install-callback` that verifies the signed install state and 302s the browser to the originating site.

1. **Homepage URL**: your control plane URL.
2. **Setup URL (optional)**: `https://<your-control-plane>/api/github/install-callback`.
3. **Redirect on update**: ✅ checked.
4. **Callback URL**: leave blank.
5. **Webhook**: check **Active** and set the URL to `https://<your-control-plane>/api/github-app-webhook`. The control plane forwards the delivery to every affected site's `/api/github-sync/app-webhook`. Paste the same value used for `GITHUB_APP_WEBHOOK_SECRET` into **Secret**. Each site still registers its own repo-level push webhook at its own host.
6. **Repository permissions**: same as self-hosted — `Contents: Read & write`, `Metadata: Read-only`, `Webhooks: Read & write`.
7. **Subscribe to events**: `Push`, `Installation`, `Installation repositories`.
8. **Where can this GitHub App be installed**: "Any account".
9. Generate a private key (PKCS#8 PEM) and copy the App ID.

In this mode the install `state` is signed with `HOSTED_CONTROL_PLANE_SSO_SECRET` — the same secret hosted deployments already share between core and control plane. Both services must see the same value; no extra env var is needed.

### User Setup

1. Open **Settings > Data > GitHub Sync** in the Jant dashboard.
2. Click **Install GitHub App**. You will be redirected to GitHub to pick which repositories the App can access.
3. After installing, GitHub redirects you back. Pick the repository you want to sync and click **Connect**.

Jant uses the installation to issue short-lived tokens on demand — no token is ever stored long-term.

## Push a Full Sync

After connecting, click **Push Full Sync** to populate the repository with all your posts. This creates a single commit containing every post as a Markdown file under `content/posts/`.

You can re-run a full sync at any time. It replaces the repository content in one atomic commit. Git treats unchanged files as no-ops, so your blame history is preserved for files that did not change.

## Incremental Sync

Once connected, every post create, edit, or delete in Jant automatically pushes the change to GitHub. Each mutation produces its own commit.

- **Create or update**: writes `content/posts/{slug}.md`
- **Delete**: removes the file from the repository
- **Thread reply changes**: re-sync the root post file (replies are embedded)

Incremental syncs run in the background and do not block the Jant UI.

## Editing on GitHub

You can edit any `content/posts/*.md` file directly on GitHub (or locally and push). When the push reaches GitHub, the webhook fires and Jant updates the matching post.

Matching works by slug: Jant reads the `slug` field from the YAML front matter and looks up the corresponding post. If no match is found, the file is skipped.

Only the following fields are updated from GitHub edits:

- `body` (the Markdown content below the front matter)
- `title`
- `extra.link_url` (for link posts)
- `extra.quote_text` (for quote posts)

Deleting a file on GitHub soft-deletes the post in Jant.

## Disconnect

Open **Settings > Data > GitHub Sync** and click **Disconnect**. Jant removes the webhook from GitHub and clears the sync configuration. The repository and its content are not deleted.

## File Format

Posts are stored as Zola-compatible Markdown with YAML front matter, the same format used by [Site Export](export-and-import.md).

```markdown
---
title: "Hello World"
date: 2025-01-15T12:00:00Z
slug: "hello-world"
extra:
  format: note
  status: published
  visibility: public
---

Post content here.
```

Thread replies appear as HTML comment markers within the same file:

```markdown
<!-- jant:reply date="2025-01-15T13:00:00Z" slug="reply-abc" format="note" status="published" visibility="public" -->

Reply content here.
```

## Background Processing

Sync operations run in the background so editing and publishing never wait on GitHub. When a post changes, the sync is scheduled inline through the Worker's `waitUntil` lifecycle — the HTTP response returns immediately and the push completes right after. No queue binding or separate consumer worker is needed.

While a push is in flight the settings page shows a live "Syncing…" indicator; it switches back to "Last synced" when the push finishes. If a push fails, the error message appears on the status card so you know what went wrong without digging through logs.

Rapid edits coalesce: if a second change arrives during an in-flight push, it's recorded as a pending edit and picked up immediately after the current push lands, so nothing is lost without causing concurrent pushes.

## Limitations

- **One repository per site.** Multi-repo sync is not supported.
- **No post creation from GitHub.** Adding a new `.md` file on GitHub does not create a post in Jant. Only existing posts can be updated or deleted.
- **Text attachments are not synced.** Media and text attachment content are referenced by URL only.
- **Rate limits.** GitHub allows 5,000 API requests per hour for authenticated users. A full sync of 1,000 posts uses roughly 1,000 requests (one blob per file). Incremental syncs use 1-2 requests each.

## Related Reading

- [Export and Import](export-and-import.md)
- [Backups and Recovery](backups.md)
- [Configuration](configuration.md)
- [API Reference](API.md)
