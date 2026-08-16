# FAQ

## Is Jant open source?

Yes. The full source is on [GitHub](https://github.com/jant-me/jant). Hosted and self-hosted run the same code — there are no "hosted-only" features.

## Self-hosted or hosted — which should I choose?

| Your situation                                             | Pick                                        |
| ---------------------------------------------------------- | ------------------------------------------- |
| Want near-zero cost and can follow a 15-minute setup guide | [Cloudflare self-hosting](deployment.md)    |
| Already run your own server with Docker experience         | [Docker self-hosting](deployment-docker.md) |
| Don't want to handle any deployment details                | [Hosted Jant](hosted.md)                    |

All three paths run the same code. Going from hosted to self-hosted (or back) is done through [Export and import](export-and-import.md).

## How do I set up a custom domain?

- **Hosted**: Dashboard → select your site → **Domains** → Add, then follow the DNS prompts. Certificates are provisioned and renewed automatically.
- **Cloudflare self-hosting**: Workers & Pages → your Worker → Settings → Domains & Routes → Add. See "Bind a custom domain" in [Deploy to Cloudflare](deployment.md#1-bind-a-custom-domain).
- **Docker self-hosting**: point your reverse proxy at it.

## Are comments supported?

Not built-in. May come later. For now you can embed third-party systems like giscus or Disqus through [code injection](code-injection.md).

## Does Jant have standalone pages (like an About page)?

There's no separate "page" type. Set a Note titled `About` to **Hidden from Latest** (off the homepage, direct link still works) and it becomes a standalone page. Jant builds the slug from the title, so the address defaults to `/about`; to use a different one, expand **Custom link** in the **Publish settings** panel next to the Publish button. See [Writing and organizing § Make a standalone page](writing-and-organizing.md#make-a-standalone-page-about).

## How do I publish a post with a past date?

Next to the **Publish** button in the composer there's a **Publish settings** panel — set **Published on** to an earlier date and the post drops into the timeline at that point. Handy for backfilling older posts brought over from elsewhere. You can only pick today or earlier; Jant doesn't schedule posts. See [Writing and organizing § Publish settings](writing-and-organizing.md#publish-settings).

## How do I give a post a custom URL?

In the same **Publish settings** panel, expand **Custom link** and enter the slug you want before publishing. If the post is already published and you want to change its URL, use **Settings → Advanced → Custom URLs** instead — it 301-redirects the old address so you don't leave a dead link. See [Writing and organizing § Custom URLs](writing-and-organizing.md#custom-urls).

## Can I customize the theme/appearance?

Three layers of control: built-in color themes, built-in type styles, and Custom CSS. Custom CSS overrides CSS variables directly — no theme fork, no restart. For the full variable list, see [Theming](theming.md).

## How do I upgrade to a new version?

- **Hosted**: automatic, nothing to do.
- **Cloudflare**: `npm install @jant/core@latest && npm run deploy`. Migrations run automatically as part of deploy.
- **Docker**: `docker compose pull && docker compose up -d`. The command runs database migrations first, then starts the app.

Take a full backup before upgrading. See [Backups and recovery](backups.md).

## Is the Cloudflare free tier really enough?

For a typical personal blog, usually yes. Workers free tier gives you 100,000 requests per day, and R2 free tier gives you 10 GB of storage and one million Class A operations per month. One trap: if you don't configure `R2_PUBLIC_URL`, every image load goes through the Worker, which burns through the free tier much faster. See "Post-deploy checklist" in [Deploy to Cloudflare](deployment.md#before-going-live).

## Can I take my content with me?

Yes, two ways:

- [`site export`](export-and-import.md#site-export-site-export) — one-shot export to a standard Hugo site directory (ZIP or directory) that you can preview with `hugo serve`.
- [GitHub sync](github-sync.md) — content stays continuously synced as Markdown to your own Git repository. The repo itself is a complete Hugo site.

## Cloudflare or Docker — which should I choose?

Both run the same code. Cloudflare suits personal sites that want near-zero ops on the free tier. Docker suits people who already have a server and Docker experience, or who want Postgres or local storage. If both options feel new, pick Cloudflare. See [Deploy to Cloudflare](deployment.md) and [Docker self-hosting](deployment-docker.md).

## Is there a media upload size limit?

Non-images default to 1024 MB; tune it with `UPLOAD_MAX_FILE_SIZE_MB`. See [Configuration § Upload size limits](configuration.md#upload-size-limits-optional).

## Can deleted posts be recovered?

No. Deletion is permanent — the post row, its paths, and its attachment media are cleaned up together (inline media embedded in the body is left alone). Deleting a Thread root also deletes the Thread's Collection memberships; deleting only a reply leaves the shared memberships intact. The UI asks for explicit confirmation before deleting.

## Is multi-language supported?

Yes, in two independent ways.

**One language, set once.** **Settings → Language → Content language** is the language you write in. It fills `<html lang>` and the `<language>` field in your feeds, which is what search engines, screen readers, and feed readers consume.

**Several languages at once.** Turn on multilingual content and each language gets its own home page, archive, and feed under a URL prefix, with a switcher in the header and posts linkable as versions of one another. See [Multilingual content](multilingual.md).

The dashboard's own language is separate — **Settings → Language → Dashboard language**, which only you see. It ships in English, Simplified Chinese, and Traditional Chinese; other values fall back to English.

## Is multi-author supported?

No. Multi-author needs roles, review, attribution, notifications — a full set of mechanics that would push the product toward a CMS. If you need those, look at WordPress or Ghost.

## Why does `/feed` default to Featured instead of Latest?

Jant treats "publish to the site" and "broadcast to subscribers" as two separate things. The default `/feed` points at Featured so you can write small everyday notes without spamming subscribers. To switch back to traditional behavior, change **Settings → General → Feeds → Main RSS feed** to Latest. The three feeds (`/featured/feed`, `/latest/feed`, `/archive/feed`) each cover a different slice. See [Writing and organizing § Why the default feed is Featured](writing-and-organizing.md#why-the-default-feed-is-featured).

## Why doesn't a newly published post appear in RSS right away?

Jant gives new posts and replies a five-minute correction window before they
can enter its Atom feeds. The content appears on your website immediately;
only feed delivery waits. This gives you time to fix a mistake or unpublish the
content before a feed reader can fetch it.

Feed caching and each reader's polling schedule can make the content appear
later. Change `RSS_PUBLISH_DELAY_SECONDS` in **Settings → Advanced → Config
Editor** to any whole number from `0` to `7200`; `0` disables the delay. See
[Configuration § Feed defaults](configuration.md#feed-defaults-optional).

## Can I host under a subpath (e.g., `example.com/blog`)?

Yes. Set `SITE_PATH_PREFIX=/blog`. On Cloudflare you also need to point Workers Routes for `yourdomain.com/blog*` at the Worker. See [Deployment § Deploying under a subpath](deployment.md#deploying-under-a-subpath).

## Feedback channels?

- [GitHub Issues](https://github.com/jant-me/jant/issues) — bugs and feature requests
- Email `support#jant.me` (replace `#` with `@`) — hosted account questions

## Can AI agents publish posts?

Yes. Two entry points, pick by use case:

- **HTTP JSON API**: the default — `POST /api/posts` with a Bearer token. Used by external scripts, scheduled jobs, and third-party integrations.
- **MCP interface** (`/api/mcp`): when the caller is itself an MCP client.

Projects scaffolded with `create-jant` ship `AGENTS.md`, `.claude/skills/`, and `examples/agent-content-automation/` with copy-pasteable curl examples. See [Automation and API](automation-and-api.md).

With [GitHub sync](github-sync.md) enabled, agents can also read and write Markdown directly through the Git repo — for many coding agents this feels more natural than the API.

## Can I migrate between hosted and self-hosted?

Yes, both directions are supported. The recommended flow is `site export` → `site import`: export the source to a ZIP, then import into the target with an empty account. Everything goes over the HTTP API and works on both hosted and self-hosted; slugs and URLs are preserved as-is. See [Export and import](export-and-import.md).

`site snapshot` is not the right tool for this case. It needs direct access to the database and object storage, which hosted doesn't expose. Use it only when both ends are self-hosted and you need to preserve internal IDs and storage keys as well.

## SQLite or Postgres — which should I choose (Docker deployment)?

For single-machine deployments, SQLite is fine — performance is plenty, and the backup is just one file. If you already have Postgres infrastructure, switching to Postgres makes sense. The choice is controlled by the scheme of `DATABASE_URL` (`file:` or `postgres:`). See [Configuration § Node and Docker](configuration.md#node-and-docker).

## I deleted a file on GitHub, why isn't it deleted in Jant?

That's intentional. File deletions on GitHub are ignored by the sync layer to prevent accidental data loss. Posts can only be deleted from the Jant UI; the next sync will then remove the corresponding bundle from the repo. See [GitHub sync § Editing on GitHub](github-sync.md#editing-on-github).

## Can I create a new post by adding a `.md` file on GitHub?

No. The GitHub → Jant direction only supports updating existing posts, matched by `slug` in front matter. New posts and deletions go through the Jant UI.

## What happens if I change `AUTH_SECRET`?

Every active session is invalidated immediately and everyone has to sign in again. **Don't rotate this casually** in production unless you suspect a leak. Generate a new value with `openssl rand -base64 32`.

## Pre-1.0 — will there be a lot of breaking changes?

Possibly, but only when warranted. Every breaking change is documented in the commit and changelog. Skim the changelog before upgrading and keep a recent backup.

## How do I move my old blog into Jant (WordPress, Tumblr, etc.)?

There's no fixed importer — every platform exports differently. The easiest path is to hand your site's `/skill.md` URL (for example, `https://example.com/skill.md`) to an AI assistant. This site-bound Jant guide includes a dedicated import workflow covering the data model, source-format mapping, resumable writes, and verification. Give the assistant your export file and a site API token, and let it run the migration. See [Export and import](export-and-import.md#coming-from-another-blog-or-cms).

## Can I migrate back to WordPress / Ghost?

There's no built-in path, but `site export` produces standard Markdown + YAML front matter, so an AI can write a one-off conversion script to WordPress WXR or Ghost JSON.

## Why the name Jant?

From _Jantelagen_ (the Law of Jante), a Nordic cultural concept of "don't think you're anything special." For the design rationale, see [Introduction](overview.md#a-quieter-way-to-write-in-public).

## Why is hosted priced at $10.46/year?

I've always liked `.com` pricing: $10.46/year.

That's what Cloudflare charges to register and renew a `.com`. It sits just above free, and just formal enough — low enough not to add friction at the start, but not so trivial that you don't take it seriously.

## What's next

- [Introduction](overview.md) — what Jant is for
- [Getting started](getting-started.md) — pick a deployment path
- [Writing and organizing](writing-and-organizing.md) — once the site is up
