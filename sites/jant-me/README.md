# Jant Site

A personal website/blog powered by [Jant](https://github.com/jant-me/jant).

## Option A: One-Click Deploy

Deploy to Cloudflare instantly — no local setup required:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jant-me/jant-starter)

### Deploy form fields

| Field                      | What to do                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Git account**            | Select your GitHub account. A new repo will be created for you.                                                                                                                                                            |
| **D1 database**            | Keep "Create new". The default name is fine.                                                                                                                                                                               |
| **Database location hint** | Pick a region close to you (optional, Cloudflare auto-selects).                                                                                                                                                            |
| **R2 bucket**              | Keep "Create new". The default name is fine. Used for media uploads.                                                                                                                                                       |
| **AUTH_SECRET**            | Used for login session encryption. Keep the pre-filled value or generate your own with `openssl rand -base64 32`.                                                                                                          |
| **SITE_URL**               | Change this to your production URL (e.g. `https://my-blog.example.com`). If you don't have a custom domain yet, leave it empty — you can set it later in the Cloudflare dashboard after you know your `*.workers.dev` URL. |

### After deploy

1. Visit your site at the URL shown in the Cloudflare dashboard (e.g. `https://<project>.<account>.workers.dev`)
2. Go to `/dash` to set up your admin account
3. If you set `SITE_URL` to a custom domain, add it in: Cloudflare dashboard → Workers & Pages → your worker → Settings → Domains & Routes → Add Custom Domain
4. If you left `SITE_URL` empty, set it to your `*.workers.dev` URL: Cloudflare dashboard → Workers & Pages → your worker → Settings → Variables and Secrets

### Develop locally

```bash
# Clone the repo that was created for you
git clone git@github.com:<your-username>/<your-repo>.git
cd <your-repo>
pnpm install
pnpm dev
```

Visit http://localhost:9019. Changes pushed to `main` will auto-deploy.

Other docs see [Docs](https://github.com/jant-me/jant)
