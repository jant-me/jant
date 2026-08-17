# Use Hosted Jant

Jant is open source and you can deploy it yourself. If you'd rather not, [jant.me](https://jant.me) hosts it for you: the same open-source code, with the ops handled on the hosted side.

→ [Sign up at jant.me/signup](https://jant.me/signup) (already have an account? [sign in](https://jant.me/signin))

## Pricing and limits

One plan:

| Item          | Included      |
| ------------- | ------------- |
| Price         | $10.46 / year |
| Sites         | 3             |
| Media storage | 10 GB         |

Billed annually. After you cancel, the site runs to the end of the current period, then enters a 90-day retention window where the data can still be recovered, and is permanently deleted after that.

You can refund within 14 days of your first payment, from the dashboard (Billing → Get a refund), once per plan. A refund ends the plan immediately: the site goes offline and enters the same 90-day retention window, so resubscribing within it brings the site back.

## What's included

- **Full Jant feature set**: Threads, Collections, GitHub Sync, API/MCP, Hugo export — the same as a self-hosted install.
- **Custom domain and HTTPS**: bind your own domain from the dashboard; certificates are issued and renewed automatically.
- **Database and media storage**: configured and operated by the hosted side.

## Getting started

1. Sign up at [jant.me/signup](https://jant.me/signup).
2. Create a site. Each new site gets a `*.jant.blog` subdomain that works immediately.
3. (Optional) Bind your own domain: dashboard → select the site → **Domains** → add a domain, then configure DNS at your registrar as instructed.

## Move out at any time

Two ways:

- **[Hugo export](export-and-import.md)**: export every post, media file, and setting into a standard Hugo site directory you can deploy to any Hugo host.
- **[GitHub Sync](github-sync.md)**: the site continuously syncs content into your own GitHub repo. The repo itself is a complete Hugo site you can run on its own at any time.

Hosted and self-hosted move to each other through the same import flow.

## How it compares to self-hosting

| Item             | Hosted             | Self-hosted                                                                   |
| ---------------- | ------------------ | ----------------------------------------------------------------------------- |
| Setup cost       | Sign up and go     | Follow the [Cloudflare](deployment.md) or [Docker](deployment-docker.md) docs |
| Upgrades and ops | Automatic          | You run them                                                                  |
| Where data lives | Hosted environment | Your own environment                                                          |
| Cost             | $10.46 / year      | Usually within Cloudflare's free tier                                         |

## Why $10.46

$10.46 is what Cloudflare charges to register and renew a `.com` domain for a year. A subscription you keep for years has to be judged on what it costs over those years, and $10.46 looks fair to me.

## Contact

For technical or account questions, email [support@jant.me](mailto:support@jant.me).

## What's next

- [Writing and organizing](writing-and-organizing.md): start publishing
- [GitHub Sync](github-sync.md): continuously sync content to your repo
- [Export and import](export-and-import.md): move out of or into the hosted service
