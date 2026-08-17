# Jant Site

A personal website/blog powered by [Jant](https://github.com/jant-me/jant).

Examples below use `npm`, but the same scripts work with `pnpm run` or `yarn`.

## Option A: One-Click Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jant-me/jant-starter)

Deploy to Cloudflare instantly, without local setup.

In this flow, Cloudflare creates the new GitHub repo, D1 database, and R2 bucket for you from the form.

### Deploy form fields

| Field                      | What to do                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Git account**            | Select your GitHub account. Cloudflare creates a new repo for you.                                                        |
| **D1 database**            | Keep **Create new**. The default name is fine.                                                                            |
| **Database location hint** | Pick a nearby region if you want. Leaving it alone is fine too.                                                           |
| **R2 bucket**              | Keep **Create new**. The default name is fine.                                                                            |
| **AUTH_SECRET**            | Keep the generated value, or replace it with your own 32+ character secret.                                               |
| **SITE_ORIGIN**            | Optional. Set this when you want a fixed public origin such as `https://my-blog.example.com`.                             |
| **SITE_PATH_PREFIX**       | Optional. Set this only when you mount the site under a subpath such as `/blog`. Leave it empty for a normal root deploy. |

### After deploy

1. Open the site URL shown in Cloudflare, usually `https://<project>.<account>.workers.dev`
2. Go through the setup flow and create your admin account
3. If you set `SITE_ORIGIN` to a custom domain, add that domain in Cloudflare under **Workers & Pages**
4. If you leave `SITE_ORIGIN` empty, Jant uses the current request host automatically

### Develop locally

Cloudflare creates a GitHub repo for you during one-click deploy. To keep working locally:

```bash
git clone git@github.com:<your-username>/<your-repo>.git
cd <your-repo>
npm install
npm run dev
```

Open `http://localhost:3000`. Changes pushed to `main` will auto-deploy.

Need another local port? Run:

```bash
PORT=3030 npm run dev
```

## Option B: Manual Deploy from Your Machine

If you would rather create or keep a local site repo and deploy it yourself, use the steps below.

### 1. Log In to Wrangler

```bash
npx wrangler login
```

### 2. Create the D1 Database

```bash
npx wrangler d1 create <your-project>-db
```

Copy the `database_id` from the output into `wrangler.toml`.

### 3. Create the R2 Bucket

```bash
npx wrangler r2 bucket create <your-project>-media
```

Make sure `wrangler.toml` uses the same bucket name.

### 4. Set the Production Auth Secret

```bash
openssl rand -base64 32
npx wrangler secret put AUTH_SECRET
```

This is separate from the local secret in `.dev.vars`.

### 5. Deploy

```bash
npm run deploy
```

After deploy, Cloudflare gives you a `*.workers.dev` URL.

## Local Development

Start the local dev server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Common Commands

| Command                                                                          | Description                           |
| -------------------------------------------------------------------------------- | ------------------------------------- |
| `npm run dev`                                                                    | Start local development               |
| `npm run deploy`                                                                 | Apply remote migrations and deploy    |
| `npm run reset-password`                                                         | Generate a password reset token       |
| `npx jant site export https://your-site.example --output ./jant-site-export.zip` | Export the site as a portable archive |

## Upgrade

Check the [release notes](https://github.com/jant-me/jant/releases) for breaking changes, then:

```bash
npm install @jant/core@latest
npm run dev      # verify locally; applies new migrations to your local D1
npm run deploy   # deploy to Cloudflare; applies remote migrations
```

If you used one-click deploy, you can skip the local steps: commit the updated `package.json` and lockfile and push to `main`. Cloudflare rebuilds and applies remote migrations automatically.

## Configuration

The most common values live in two files:

- `.dev.vars` for local secrets
- `wrangler.toml` for non-sensitive Cloudflare configuration

Useful examples:

```toml
[vars]
SITE_ORIGIN = "https://yourdomain.com"
# SITE_PATH_PREFIX = "/blog"
# R2_PUBLIC_URL = "https://media.yourdomain.com"
# IMAGE_TRANSFORM_URL = "https://media.yourdomain.com/cdn-cgi/image"
```

## Documentation

Start here:

- [Introduction](https://jant.me/docs)
- [Deploy on Cloudflare](https://jant.me/docs/deployment)
- [Configuration](https://jant.me/docs/configuration)

For writing and customization:

- [Writing and Organizing Posts](https://jant.me/docs/writing-and-organizing)
- [Theming](https://jant.me/docs/theming)

For operations:

- [Export and Import](https://jant.me/docs/export-and-import)
- [Backups and Recovery](https://jant.me/docs/backups)

Reference:

- [API Reference](https://jant.me/docs/api)
- [GitHub Repository](https://github.com/jant-me/jant)

## AI Coding Tools

This site template includes project guidance in `AGENTS.md` plus task-focused skills in `.agents/skills/`.

For concrete content automation examples, see `examples/agent-content-automation/README.md`.

Available skills:

- `building-jant-site`
- `jant-http-api`
- `jant-site-ops`

If your coding tool expects Claude-style project files, `CLAUDE.md` and `.claude/skills/` are generated too.
