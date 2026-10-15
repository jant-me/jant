# Getting started

There are three ways to get a Jant site.

| Option                                            | Best for                                  | Cost                            |
| ------------------------------------------------- | ----------------------------------------- | ------------------------------- |
| **[Self-host on Cloudflare](deployment.md)**      | Long-running site with low maintenance    | Usually $0 within the free tier |
| **[Self-host with Docker](deployment-docker.md)** | You already have a server                 | Whatever your server costs      |
| **[Hosted Jant](hosted.md)**                      | You don't want to deal with configuration | $10.46/year                     |

All three run the same Jant. Your content can be [exported](export-and-import.md) or synced to your own repo via [GitHub Sync](github-sync.md) at any time.

## Not sure which to pick

- **[Self-host on Cloudflare](deployment.md)**: needs a Cloudflare account, no server of your own, about 15 minutes of one-time setup.
- **[Self-host with Docker](deployment-docker.md)**: needs Docker experience, and the server is yours to maintain.
- **[Hosted Jant](hosted.md)**: deployment, upgrades, and backups are handled for you.

## Let an AI assistant set it up

Send this line to an AI assistant that can run commands, such as Claude Code or Codex:

```text
Read https://jant.me/docs/install.md and help me set up a Jant site.
```

[The page it reads](install.md) tells the assistant to ask which of the three you want, follow that guide, and hand back the steps only you can do, such as signing in to Cloudflare and choosing the admin password.
