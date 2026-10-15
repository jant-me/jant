# Deploy on Cloudflare

Cloudflare is the recommended deployment platform for Jant. Pick one of two paths:

- **One-click deploy**: click the Deploy button. About 5 minutes end-to-end. Cloudflare creates every resource under your account automatically.
- **Local development first, then deploy**: run it locally first, then ship with Wrangler. Best when you want to tweak the theme or do offline debugging up front.

After the deploy itself, you still need to bind a custom domain and configure R2 public access — otherwise media loads through the Worker as a proxy and burns your free quota.

> To deploy on your own server instead, see [Deploy with Docker](deployment-docker.md).

> To have an AI assistant do the setup, send it this line: `Read https://jant.me/docs/install.md and help me set up a Jant site.` See [Install with an AI assistant](install.md).

## Placeholder conventions

Every `<...>` in this guide is a placeholder you replace with your own value.

| Placeholder      | What it means                                                         |
| ---------------- | --------------------------------------------------------------------- |
| `<github-user>`  | Your GitHub username                                                  |
| `<repo>`         | The repo name created by one-click deploy                             |
| `<project>`      | Worker project name (one-click deploy defaults to `my-site`)          |
| `<account>`      | Your Cloudflare subdomain prefix, assigned by Cloudflare after deploy |
| `<your-domain>`  | Your custom domain                                                    |
| `<media-domain>` | Your R2 media subdomain, e.g. `media.<your-domain>`                   |
| `<database-id>`  | The D1 database ID printed by `wrangler d1 create`                    |

## Prerequisites

- **Cloudflare account**: sign up or sign in at [dash.cloudflare.com](https://dash.cloudflare.com/).
- **GitHub account**: one-click deploy hosts the code on GitHub. Sign up or sign in at [github.com](https://github.com/).
- **Enable R2**: open the [R2 dashboard](https://dash.cloudflare.com/?to=/:account/r2) and click **Enable R2** to accept the terms. Do this first — skipping it makes the deploy fail with `uses R2 which is only available with an R2 subscription`. R2 stores uploaded images and videos. Free tier: 10 GB storage and 1 million reads per month.
- **Custom domain** (recommended): hosted under the same Cloudflare account. If you haven't added one yet, transfer DNS to Cloudflare first.
- **Local development path also needs**: [Node.js](https://nodejs.org/) 24+ and `git`.

## One-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jant-me/jant-starter)

Click the Deploy button and Cloudflare creates the GitHub repo, D1 database, and R2 bucket from the form, then ships the first deploy.

### Filling in the form

| Field                      | What to do                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Git account**            | Pick your GitHub account. First-time users click **New GitHub Connection** to authorize, then Cloudflare creates the repo.                                          |
| **Project name**           | Defaults to `my-site`. This value is both the site subdomain `<project>.<account>.workers.dev` and the GitHub repo name. Change it now to something like `my-blog`. |
| **D1 database**            | Keep **Create new** with the default name.                                                                                                                          |
| **Database location hint** | Pick the region where most of your readers are. Every page waits on this database; see [Enable D1 read replication](#3-enable-d1-read-replication).                 |
| **R2 bucket**              | Keep **Create new** with the default name.                                                                                                                          |
| **AUTH_SECRET**            | Keep the auto-generated value, or replace it with your own 32+ byte random string. This signs sessions. Don't change it after going live.                           |

Once the deploy finishes, Cloudflare shows a URL like `https://<project>.<account>.workers.dev`. **Don't create the admin account yet** — finish the next steps and bind the custom domain first, otherwise the session breaks when you switch domains.

### Clone locally (recommended)

The repo already exists in your GitHub account. Cloning it locally lets you:

- Edit `wrangler.toml` to set environment variables (the next section uses this)
- Tweak the theme, add pages, upgrade dependencies
- Push to `main` to trigger a redeploy automatically

```bash
git clone git@github.com:<github-user>/<repo>.git
cd <repo>
npm install
```

You can skip cloning — every option in the next section is also reachable from the Cloudflare dashboard.

## Before going live

Finish these four steps before creating your admin account.

### 1. Bind a custom domain

1. Open [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) and select your Worker.
2. Go to **Settings** → **Domains & Routes** → **Add**.
3. Enter `<your-domain>`.

When the domain is on the same Cloudflare account, DNS is written automatically and the certificate usually issues within 1–2 minutes.

### 2. Configure R2 public access

Without this, every image and video request goes through the Worker — slower and consumes Worker quota. Once `R2_PUBLIC_URL` is set, media is served directly from the public R2 domain.

**Bind a public subdomain to your R2 bucket**

1. Open the [R2 dashboard](https://dash.cloudflare.com/?to=/:account/r2) and click into your bucket.
2. **Settings** → **Public access** → **Custom Domains** → **Connect Domain**.
3. Enter a subdomain under your domain, e.g. `media.<your-domain>`.
4. Cloudflare writes the CNAME and issues the certificate automatically. Once the status flips from `Initializing` to `Active`, **copy the Public URL in full** (it looks like `https://<media-domain>` — no trailing slash).

Don't use the temporary r2.dev public URL — it has rate limits and isn't suitable for production.

If the status sits on `Initializing` for a long time, the subdomain is usually already taken by another DNS record. Delete the conflicting record on the Cloudflare DNS page and it recovers automatically.

**Wire the URL into the Worker**, either way works:

- **Dashboard**: [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) → select Worker → **Settings** → **Variables and Secrets** → **Add**. Name `R2_PUBLIC_URL`, value `https://<media-domain>`. Saving triggers a redeploy. Later deploys keep the variable because the project's `wrangler.toml` sets `keep_vars = true`; without that line, each deploy deletes the variables it doesn't list.
- **Code**: add this under `[vars]` in `wrangler.toml`:

  ```toml
  [vars]
  R2_PUBLIC_URL = "https://<media-domain>"
  ```

  Push to `main`, or run `npm run deploy`.

To verify, open any uploaded image and check the page source. The `<img src>` should be `https://<media-domain>/...`, not `<project>.<account>.workers.dev/...`.

### 3. Enable D1 read replication

A Jant page makes about a dozen D1 queries one after another, so each round trip between the Worker and the database is paid about twelve times. Without read replication, every query goes to the database's one location, and readers far from it wait on every page. Two Jant sites on the same version, both with the database in Western North America, measured from Tokyo:

| Read replication | One query | Home page |
| ---------------- | --------- | --------- |
| Off              | ~125 ms   | ~1.0 s    |
| On               | ~20 ms    | ~0.4 s    |

With read replication on, D1 keeps a read-only copy of the database in each of its regions and sends reads to the nearest one. Replicas cost nothing extra; D1 still bills by rows read and written.

To turn it on:

1. Open [D1](https://dash.cloudflare.com/?to=/:account/workers/d1) and select the database.
2. **Settings** → **Enable Read Replication**.

Through the API, set `read_replication.mode` to `"auto"`, as Cloudflare's [read replication guide](https://developers.cloudflare.com/d1/best-practices/read-replication/) shows. `wrangler.toml` doesn't change: Jant already reads through the D1 Sessions API, which replication needs.

Writes still go to the primary, and requests you make while signed in start there, so a replica that is behind can't sign you out. Your pages load slower than your readers' do.

To check a site, time `/healthz`, which answers without the database, against `/readyz`, which makes one D1 query. Curl reuses one connection for all five requests:

```bash
curl -s -o /dev/null -w '%{url_effective}  %{time_total}s\n' 'https://<your-domain>/{healthz,healthz,readyz,readyz,readyz}'
```

The first line includes connection setup. The fastest `readyz` minus the second `healthz` is what one query costs a reader where you are: about 125 ms and 20 ms for the two sites above.

### 4. Enable automatic image resizing (optional)

With [Image Transformations](https://developers.cloudflare.com/images/transform-images/) on, Jant requests image sizes that match the visitor's screen width and pixel density, so phones don't load 4000px originals.

The first 5,000 transformations per month are free; about $0.50 per 1,000 after that. Each original needs 3–5 derived sizes on demand, so personal sites rarely hit the paid tier.

> Image transformations are a domain (zone) level feature. Configure the R2 custom domain from step 2 first.

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), select the domain you bound.
2. Left menu → **Images** → **Transformations**.
3. Toggle the corresponding domain to **On** (the first time, you'll see a terms confirmation).

Add `IMAGE_TRANSFORM_URL` to the Worker the same way you added `R2_PUBLIC_URL`. The value is:

```
https://<media-domain>/cdn-cgi/image
```

## Initialize the admin account

Open `https://<your-domain>` and follow the prompts to create the admin account and set the site name.

For more configurable options, see [Configuration](configuration.md).

## Local development first, then deploy

If you'd rather build out the site locally before going live, follow this path.

```bash
npm create jant@latest jant-site
cd jant-site
```

`pnpm` and `yarn` work too:

```bash
pnpm create jant@latest jant-site
yarn create jant@latest jant-site
```

`create-jant` installs dependencies, initializes git, generates a local `.dev.vars` (with a local `AUTH_SECRET`), and creates a Wrangler project already wired to D1 and R2.

### Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and follow the prompts to finish setup (admin account, site name, language).

Change the port:

```bash
PORT=8787 npm run dev
```

### Deploy to Cloudflare

Enable R2 first, as [Prerequisites](#prerequisites) says. Then:

```bash
npm run deploy
```

`npm run deploy` calls `jant deploy`. On a new project, whose `wrangler.toml` still has `database_id = "local"`, it first sets up Cloudflare:

1. Signs in to Wrangler if you aren't signed in. The browser opens for authorization.
2. Asks which account to use if your sign-in reaches more than one, and saves its `account_id` in `wrangler.toml`.
3. Creates the D1 database `<project>-db` and the R2 bucket `<project>-media`, or reuses them if they exist, and writes the database ID into `wrangler.toml`.
4. Generates a production `AUTH_SECRET` and gives it to the Worker as a secret, unless the Worker already has one. It is separate from the local secret in `.dev.vars`. Once the site is live, **don't change it** — that invalidates every active session.

Then, on every deploy, it applies D1 migrations and data backfills, and uploads the Worker code and static assets.

On success, the terminal prints a URL like `https://<project>.<account>.workers.dev`. Commit `wrangler.toml`, which now holds the database ID. Then go back to [Before going live](#before-going-live) to finish the custom domain and R2 public access, and create the admin account.

If the first deploy fails, `database_id` goes back to `"local"`, and the next `npm run deploy` reuses what the failed run created.

To choose the database's region, create it yourself before the first deploy, with `--location` set to your readers' region: `wnam`, `enam`, `weur`, `eeur`, `apac`, or `oc`. Without it, D1 picks a region near you.

```bash
npx wrangler d1 create <project>-db --location weur
```

Keep `database_id = "local"` in `wrangler.toml`: the first deploy finds the database by its name.

## Advanced configuration

### Automatic deploys via GitHub Actions

Projects created by `create-jant` already include `.github/workflows/deploy.yml`, which runs `jant deploy` as `npm run deploy` does. Run `npm run deploy` once on your computer first and commit `wrangler.toml`: while `database_id` is still `"local"`, the workflow skips the deploy. Then add two repository secrets in GitHub and every push to `main` will deploy automatically:

- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`

How to get them:

- **`CF_ACCOUNT_ID`**: [Cloudflare dashboard](https://dash.cloudflare.com/) → any Worker or Pages project → right sidebar **Account ID**.
- **`CF_API_TOKEN`**: [API Tokens page](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → pick the **Edit Cloudflare Workers** template (it includes Worker deploy, D1 read/write, and R2 read/write permissions). Pick the account and zone (if you use a custom domain), then **copy the token immediately** — it isn't shown again after you close the page.

Add to GitHub: repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

### Deploying under a subpath

To mount Jant under a subpath like `<your-domain>/blog` and leave the root for other services, two steps:

1. Tell Jant the subpath prefix:

   ```toml
   [vars]
   SITE_PATH_PREFIX = "/blog"
   ```

   At deploy time Jant prepares prefixed static assets under `/blog/_assets/*`.

2. In the [Cloudflare dashboard](https://dash.cloudflare.com/) → select your domain → **Workers Routes** → **Add route**, enter `<your-domain>/blog*` and pick your Jant Worker.

`SITE_PATH_PREFIX` and `SITE_ORIGIN` are independent. `SITE_ORIGIN` only accepts an origin (scheme + host + port); one with a path stops the site at startup — the subpath has to come from `SITE_PATH_PREFIX`. Details in [Configuration § Public URL and subpath](configuration.md#public-url-and-subpath).

## Upgrade

Check the [release notes](https://github.com/jant-me/jant/releases) for breaking changes, then update `@jant/core` and deploy. [Compatibility](compatibility.md) lists what a release can change and which versions upgrade in place.

```bash
npm install @jant/core@latest
npm run dev      # verify locally; applies new migrations to your local D1
npm run deploy   # deploy to Cloudflare; applies remote migrations
```

If your repo auto-deploys on push (via one-click deploy or the GitHub Actions workflow above), you can skip the local commands: commit the updated `package.json` and lockfile and push to `main`. Remote migrations run as part of the deploy.

Read the release notes before upgrades that replace or remove database tables.
`jant deploy` applies migrations before it uploads the new Worker, so a
destructive schema cutover may require a short write maintenance window. Stop
or drain the old deployment's writers until the migration, new Worker upload,
and post-deploy checks have completed. Migration validation can detect bad data
or a count mismatch; it cannot make concurrent writes safe during a table
replacement.

## Common errors

- `uses R2 which is only available with an R2 subscription`: R2 isn't enabled. Open the [R2 dashboard](https://dash.cloudflare.com/?to=/:account/r2) and accept the terms.
- `Authentication error [code: 10000]`: not logged in or the token expired. Run `npx wrangler login` again.
- `database_id "..." is invalid`: the `database_id` in `wrangler.toml` doesn't name a database in this Cloudflare account. Set it back to `"local"` and run `npm run deploy`, which finds the database by `database_name` or creates it.
- `A worker with this name already exists`: change the `name` at the top of `wrangler.toml`.
- Custom domain SSL stays pending for a long time: the subdomain is taken by another DNS record. Delete the conflicting record on the DNS page and it recovers automatically.

## What's next

- [Configuration](configuration.md) — environment variables and site behavior
- [Writing and organizing](writing-and-organizing.md) — start publishing once the site is live
- [Backups and recovery](backups.md) — export D1 and R2 on a schedule, in case of accidental deletion or account reclamation
