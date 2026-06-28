# Use Hosted Jant

If you'd rather not deal with deployment, upgrades, and backups, the official hosted service at [jant.me](https://jant.me) runs Jant for you. It runs the same open-source code as a self-hosted install.

→ [Sign up at jant.me/signup](https://jant.me/signup) (already have an account? [sign in](https://jant.me/signin))

30-day free trial — no credit card required.

## Pricing and limits

Hosted Jant has simple pricing — just one plan:

| Item          | Included      |
| ------------- | ------------- |
| Price         | $10.46 / year |
| Sites         | 3             |
| Media storage | 10 GB         |

Need more storage? Email [support@jant.me](mailto:support@jant.me) and we'll work something out.

Add a payment method before the trial ends and billing continues automatically at $10.46 / year; if you don't, your sites go offline, into the same 90-day retention window as a cancellation.

Billed annually. After you cancel, the site keeps running until the end of the current paid period. Then it enters a 90-day retention window during which data can still be recovered. After 90 days, the site is permanently deleted.

Your data can be carried out at any time via [Hugo export](export-and-import.md) or [GitHub Sync](github-sync.md) into your own environment.

## What's included

- **Full Jant feature set**: Threads, Collections, GitHub Sync, API/MCP, Hugo export — every feature works the same as on a self-hosted install.
- **Automatic HTTPS**: certificates are issued and renewed automatically for the default subdomain and any custom domain you bind.
- **Custom domain**: bind your own domain from the dashboard.
- **Database and media storage**: configured and operated by the hosted side. From your view it's just a site in the dashboard.

## Getting started

1. Sign up at [jant.me/signup](https://jant.me/signup).
2. Create a site. Each new site gets a `*.jant.blog` subdomain that works immediately.
3. (Optional) Bind your own domain: dashboard → select the site → **Domains** → add a domain, then configure DNS at your registrar as instructed. Certificates are issued and renewed automatically.

## Take your content with you

Hosted and self-hosted run the same open-source code:

- **[Hugo export](export-and-import.md)**: export every post, media file, and setting at once into a standard Hugo site directory you can run on any Hugo host.
- **[GitHub Sync](github-sync.md)**: have the site continuously sync content into your own GitHub repo. The repo itself is a complete Hugo site, so you always hold a current, independently runnable copy.

You can switch from hosted to self-hosted at any time, or back the other direction, through the same import flow.

## How it compares to self-hosting

| Item             | Hosted             | Self-hosted                                                                   |
| ---------------- | ------------------ | ----------------------------------------------------------------------------- |
| Setup cost       | Sign up and go     | Follow the [Cloudflare](deployment.md) or [Docker](deployment-docker.md) docs |
| Upgrades and ops | Automatic          | You run them                                                                  |
| Where data lives | Hosted environment | Your own environment                                                          |
| Cost             | $10.46 / year      | Usually within Cloudflare's free tier                                         |

## Why $10.46

It's what Cloudflare charges to register and renew a `.com` domain. Slightly above free, but still official. Low enough that starting doesn't feel like a commitment, high enough that it isn't free either.

## Contact

For technical or account questions, email [support@jant.me](mailto:support@jant.me).

## What's next

- [Writing and organizing](writing-and-organizing.md): start publishing
- [GitHub Sync](github-sync.md): continuously sync content to your repo
- [Export and import](export-and-import.md): move out of or into the hosted service
