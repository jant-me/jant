# @jant/core

A self-hosted, single-author microblogging platform for Cloudflare Workers, Docker, and Node.js.

> Still in development

## What is Jant?

Jant is a place to publish notes, links, and quotes on your own site, without followers, likes, or algorithmic feeds.

## Recommended Starting Points

For a new site, start with `create-jant`:

```bash
npm create jant@latest my-site
cd my-site
npm run dev
```

For a traditional server deployment, use the official Docker image:

- [`owenyoung/jant`](https://hub.docker.com/r/owenyoung/jant)
- [Docker deployment guide](https://jant.me/docs/deployment-docker)

## Tech Stack

- **Runtime**: Cloudflare Workers or Node.js 24
- **Framework**: [Hono](https://hono.dev)
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2
- **Auth**: [better-auth](https://better-auth.com)
- **ORM**: [Drizzle](https://orm.drizzle.team)
- **CSS**: Tailwind CSS v4 + [BaseCoat](https://basecoat.dev)

## Documentation

- [Overview](https://jant.me/docs)
- [Getting Started](https://jant.me/docs/getting-started)
- [Writing and Organizing Posts](https://jant.me/docs/writing-and-organizing)
- [Deploy on Cloudflare](https://jant.me/docs/deployment)
- [Deploy with Docker](https://jant.me/docs/deployment-docker)
- [Configuration](https://jant.me/docs/configuration)
- [Export and Import](https://jant.me/docs/export-and-import)
- [Backups and Recovery](https://jant.me/docs/backups)
- [Theming](https://jant.me/docs/theming)
- [API Reference](https://jant.me/docs/api)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](https://github.com/jant-me/jant/blob/main/CONTRIBUTING.md) for guidelines.

## License

AGPL-3.0-or-later
