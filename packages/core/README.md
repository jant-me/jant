# @jant/core

A modern, open-source microblogging platform built on Cloudflare Workers.

## What is Jant?

Jant is a single-author microblog for people who want to share thoughts without the noise of social media. No followers, no likes, no algorithms—just your words.

## Features

- **Multiple content types** - Notes, articles, links, quotes, images, and pages
- **Thread support** - Chain posts together for longer thoughts
- **Collections** - Curate posts into themed collections
- **Full-text search** - Find anything with FTS5-powered search
- **i18n ready** - Built-in internationalization support
- **Beautiful themes** - Clean, responsive design with dark mode
- **Fast & cheap** - Runs on Cloudflare's edge network

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: [Hono](https://hono.dev)
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2
- **Auth**: [better-auth](https://better-auth.com)
- **ORM**: [Drizzle](https://orm.drizzle.team)
- **CSS**: Tailwind CSS v4 + [BaseCoat](https://basecoat.dev)

## Quick Start

The easiest way to create a new Jant site:

```bash
pnpm create jant my-blog
cd my-blog
pnpm dev
```

## Manual Setup

If you want to set up manually:

```bash
# Install
pnpm add @jant/core

# See documentation for configuration
```

## Documentation

- [Getting Started](https://github.com/jant-me/jant/blob/main/docs/getting-started.md)
- [Deployment](https://github.com/jant-me/jant/blob/main/docs/deployment.md)
- [Configuration](https://github.com/jant-me/jant/blob/main/docs/configuration.md)
- [Theming](https://github.com/jant-me/jant/blob/main/docs/theming.md)
- [API Reference](https://github.com/jant-me/jant/blob/main/docs/API.md)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](https://github.com/jant-me/jant/blob/main/CONTRIBUTING.md) for guidelines.

## License

MIT
