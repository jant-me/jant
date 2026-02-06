# Jant

> **Work in Progress**: This project is still under active development and not yet ready for use. See the latest build at [demo.jant.me](https://demo.jant.me).

A personal microblogging system as smooth as <https://threads.com>.

> **Jant** = Jantelagen (Law of Jante)
> Low-key, de-socialized personal expression.

## What is Jant?

Jant is a single-author microblog for people who want to share thoughts without the noise of social media. No followers, no likes, no retweets—just your words.

**Features**:

- Multiple content types: notes, articles, links, quotes, images
- Thread support for longer thoughts
- Collections for curated topics
- Beautiful, themeable design
- Deploys to Cloudflare Workers in minutes

## Quick Start

```bash
# Create a new Jant site
pnpm create jant my-blog

# Start development
cd my-blog
pnpm dev

# Deploy to Cloudflare
pnpm deploy
```

## Documentation

- [Getting Started](docs/getting-started.md)
- [Deployment](docs/deployment.md)
- [Configuration](docs/configuration.md)
- [Theming](docs/theming.md)
- [API Reference](docs/API.md)

## Development

Requires [mise](https://mise.jdx.dev/) — it manages Node.js and pnpm automatically.

```bash
# Install mise (macOS/Linux)
curl https://mise.run | sh

# Clone and setup
git clone https://github.com/jant-me/jant.git
cd jant
mise install   # installs Node.js and pnpm
pnpm install   # installs dependencies

# Start development server (http://localhost:9019)
mise run dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for code style, PR process, and release workflow.

## Philosophy

Jant is built on the idea that not everything needs to be optimized for engagement. Write for yourself. Share if you want. No metrics, no pressure.

## License

AGPL-3.0
