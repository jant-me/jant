# create-jant

Scaffold a new [Jant](https://github.com/nicepkg/jant) project.

## Usage

```bash
# Using npm
npm create jant my-site

# Using pnpm
pnpm create jant my-site

# Using yarn
yarn create jant my-site

# Interactive mode (prompts for project name)
npm create jant
```

## What's Included

The scaffolded project includes:

- **Hono** - Fast, lightweight web framework
- **Cloudflare Workers** - Serverless edge runtime
- **D1** - SQLite database at the edge
- **R2** - Object storage for media
- **Drizzle ORM** - Type-safe database access
- **Tailwind CSS v4** - Utility-first CSS framework
- **BaseCoat** - UI component library
- **Lingui** - Internationalization (i18n)
- **better-auth** - Authentication
- **Vite** - Fast build tool with HMR

## Getting Started

After creating your project:

```bash
cd my-site
pnpm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your AUTH_SECRET (32+ characters)
pnpm dev
```

Visit http://localhost:9019 to see your site.

## Project Structure

```
my-site/
├── src/
│   ├── index.ts          # Entry point
│   ├── app.tsx           # Hono app factory
│   ├── types.ts          # TypeScript types
│   ├── db/               # Database schema & migrations
│   ├── services/         # Business logic
│   ├── routes/           # Route handlers
│   ├── theme/            # UI components & layouts
│   ├── lib/              # Utilities
│   ├── i18n/             # Internationalization
│   └── middleware/       # Hono middleware
├── static/               # Static assets
├── vite.config.ts        # Vite configuration
├── wrangler.toml         # Cloudflare Workers config
└── drizzle.config.ts     # Drizzle ORM config
```

## Scripts

```bash
pnpm dev           # Start dev server (http://localhost:9019)
pnpm build         # Build for production
pnpm deploy        # Build + deploy to Cloudflare Workers
pnpm typecheck     # Run TypeScript checks
pnpm lint          # Run ESLint
pnpm format        # Format code with Prettier
pnpm db:generate   # Generate Drizzle migrations
pnpm db:migrate:local   # Apply migrations (local)
pnpm db:migrate:remote  # Apply migrations (production)
pnpm i18n:build    # Extract + compile translations
```

## License

MIT
