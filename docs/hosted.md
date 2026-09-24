# Use Hosted Jant

[jant.me](https://jant.me) hosts Jant for you. Hosted and self-hosted run the same open-source code, and there are no hosted-only features. Jant takes care of the servers, database, media storage, upgrades, and HTTPS certificates.

## Pricing

There is one plan, billed annually:

| Item          | Included                        |
| ------------- | ------------------------------- |
| Price         | $10.46 / year                   |
| Blogs         | 3                               |
| Media storage | 10 GB, shared by all your blogs |

## Getting started

1. Sign up at [jant.me/signup](https://jant.me/signup).
2. Create a blog in the dashboard and complete payment. The blog is then reachable at the `*.jant.blog` subdomain it was given.
3. (Optional) Bind your own domain: open the blog in the dashboard, add the domain under **Custom domain**, add the DNS record it shows at your DNS provider, then click **I've added it — verify**. Certificates are issued and renewed automatically. Each blog can have one custom domain.

## Cancellation, refunds, and deletion

Cancel your subscription under **Billing → Manage in Stripe**. The blog stays online until the end of the current billing period, then goes offline, and its data is kept for 90 days:

- Renew the plan within those 90 days and the blog comes back online.
- You can still export the blog's content from its page during that time.
- After 90 days the data is permanently deleted. Reminder emails go out 30, 7, and 1 day before deletion.

Within 14 days of your first payment, you can get a full refund yourself under **Billing → Get a refund**, once per account. A refund ends the plan immediately: the blog goes offline, and its data is kept for the same 90 days.

**Delete blog** on the blog's page deletes it permanently right away, with no 90-day retention.

## Migrating

Jant is open-source blog software. You can run Jant yourself at any time by following the [Cloudflare](deployment.md) or [Docker](deployment-docker.md) guide, and move your hosted blog there; moving from self-hosted to hosted works the same way. It takes two steps: `site export` exports the blog as a standard Hugo site directory, including posts, media, and site settings, and `site import` imports that into the new site. See [Export and import](export-and-import.md).

The exported directory can also be deployed to any host that runs Hugo. To keep a copy at all times, turn on [GitHub Sync](github-sync.md): content syncs continuously to your own GitHub repo, and the repo itself is a complete Hugo site.

## How it compares to self-hosting

| Item             | Hosted                           | Self-hosted                                                                    |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------ |
| Setup            | Sign up, create a blog           | Follow the [Cloudflare](deployment.md) or [Docker](deployment-docker.md) guide |
| Upgrades and ops | Handled by Jant                  | Your own                                                                       |
| Where data lives | Database and storage run by Jant | Your own database and storage                                                  |
| Cost             | $10.46 / year                    | Usually within Cloudflare's free tier; with Docker, what your server costs     |
| Jant Discover    | On by default                    | Off by default                                                                 |

Either way, you can turn Jant Discover on or off under **Settings → General → Site visibility**.

## Why $10.46

$10.46 is what Cloudflare charges to register or renew a `.com` domain for a year. A subscription usually runs for years, so it should be judged on what it costs over those years, and I think this price is fair.

## Contact

For technical or account questions, email [support@jant.me](mailto:support@jant.me).

## What's next

- [Writing and organizing](writing-and-organizing.md): start publishing
- [GitHub Sync](github-sync.md): continuously sync content to your repo
- [Export and import](export-and-import.md): move out of or into the hosted service
