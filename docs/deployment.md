# Deploy on Cloudflare

Cloudflare is the recommended deployment platform for Jant. Pick one of two paths:

- **One-click deploy**: click the Deploy button. About 5 minutes end-to-end. Cloudflare creates every resource under your account automatically.
- **Local development first, then deploy**: run it locally first, then ship with Wrangler. Best when you want to tweak the theme or do offline debugging up front.

After the deploy itself, you still need to bind a custom domain and configure R2 public access — otherwise media loads through the Worker as a proxy and burns your free quota.

> To deploy on your own server instead, see [Deploy with Docker](deployment-docker.md).

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
- **Local development path also needs**: [Node.js](https://nodejs.org/) 24+, `git`, `openssl`.

## One-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jant-me/jant-starter)

Click the Deploy button and Cloudflare creates the GitHub repo, D1 database, and R2 bucket from the form, then ships the first deploy.

### Filling in the form

| Field                      | What to do                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Git account**            | Pick your GitHub account. First-time users click **New GitHub Connection** to authorize, then Cloudflare creates the repo.                                          |
| **Project name**           | Defaults to `my-site`. This value is both the site subdomain `<project>.<account>.workers.dev` and the GitHub repo name. Change it now to something like `my-blog`. |
| **D1 database**            | Keep **Create new** with the default name.                                                                                                                          |
| **Database location hint** | Pick a region near you, or leave the default.                                                                                                                       |
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

Finish these three steps before creating your admin account.

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

- **Dashboard**: [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) → select Worker → **Settings** → **Variables and Secrets** → **Add**. Name `R2_PUBLIC_URL`, value `https://<media-domain>`. Saving triggers a redeploy.
- **Code**: add this under `[vars]` in `wrangler.toml`:

  ```toml
  [vars]
  R2_PUBLIC_URL = "https://<media-domain>"
  ```

  Push to `main`, or run `npm run deploy`.

To verify, open any uploaded image and check the page source. The `<img src>` should be `https://<media-domain>/...`, not `<project>.<account>.workers.dev/...`.

### 3. Enable automatic image resizing (optional)

With [Image Transformations](https://developers.cloudflare.com/images/transform-images/) on, Jant requests image sizes that match the visitor's screen width and pixel density, so phones don't load 4000px originals.

The first 5,000 transformations per month are free; about $0.50 per 1,000 after that. Each original needs 3–5 derived sizes on demand, so personal sites rarely hit the paid tier.

> Image transformations are a domain (zone) level feature. Configure the R2 custom domain from the previous step first.

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

In order:

1. **Log into Wrangler**

   ```bash
   npx wrangler login
   ```

   The browser opens for authorization. Back in the terminal you'll see `Successfully logged in`.

2. **Create the D1 database**

   ```bash
   npx wrangler d1 create <project>-db
   ```

   Copy the output `database_id` into the `[[d1_databases]]` section of `wrangler.toml`:

   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "<project>-db"
   database_id = "<database-id>"
   ```

   `database_name` must match the name you passed to `d1 create`.

3. **Create the R2 bucket**

   ```bash
   npx wrangler r2 bucket create <project>-media
   ```

   The `bucket_name` under `[[r2_buckets]]` in `wrangler.toml` must match:

   ```toml
   [[r2_buckets]]
   binding = "R2"
   bucket_name = "<project>-media"
   ```

4. **Set the production `AUTH_SECRET`**

   The secret in `.dev.vars` is for local use only. Set the production secret interactively:

   ```bash
   openssl rand -base64 32 | npx wrangler secret put AUTH_SECRET
   ```

   Once the site is live, **don't change this value** — it invalidates every active session.

5. **Deploy**

   ```bash
   npm run deploy
   ```

   `npm run deploy` calls `jant deploy`, which:
   1. Applies D1 migrations and data backfills.
   2. Uploads the Worker code and static assets.

   On success, the terminal prints a URL like `https://<project>.<account>.workers.dev`. Go back to [Before going live](#before-going-live) to finish the custom domain and R2 public access, then create the admin account.

## Advanced configuration

### Automatic deploys via GitHub Actions

Projects created by `create-jant` already include `.github/workflows/deploy.yml`. Add two repository secrets in GitHub and every push to `main` will deploy automatically:

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

`SITE_PATH_PREFIX` and `SITE_ORIGIN` are independent. `SITE_ORIGIN` only accepts an origin (scheme + host + port); the path part is ignored — the subpath has to come from `SITE_PATH_PREFIX`. Details in [Configuration § Public URL and subpath](configuration.md#public-url-and-subpath).

## Upgrade

Check the [release notes](https://github.com/jant-me/jant/releases) for breaking changes, then update `@jant/core` and deploy:

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
- `database_id "..." is invalid`: the `database_id` placeholder in `wrangler.toml` wasn't replaced with the real ID from `wrangler d1 create`.
- `A worker with this name already exists`: change the `name` at the top of `wrangler.toml`.
- Custom domain SSL stays pending for a long time: the subdomain is taken by another DNS record. Delete the conflicting record on the DNS page and it recovers automatically.

## What's next

- [Configuration](configuration.md) — environment variables and site behavior
- [Writing and organizing](writing-and-organizing.md) — start publishing once the site is live
- [Backups and recovery](backups.md) — export D1 and R2 on a schedule, in case of accidental deletion or account reclamation
