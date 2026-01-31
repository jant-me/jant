# Jant - Development Guide

## Important Rules

- **Always use latest versions** when installing dependencies. Do NOT use outdated versions from training data. Check npm for current versions or use `pnpm add <package>@latest`.

## Quick Reference

```bash
# Development
mise run dev          # Start dev server (https://local.jant.me)
mise run typecheck    # Run TypeScript checks
mise run lint         # Run ESLint

# Database
mise run db-generate  # Generate Drizzle migrations
mise run db-migrate   # Apply migrations (local D1)

# i18n
mise run i18n         # Extract + compile translations
mise run i18n-extract # Extract messages from source
mise run i18n-compile # Compile PO files to JS
mise run translate    # Auto-translate using AI (needs OPENAI_API_KEY)

# Deploy
mise run deploy       # Deploy to Cloudflare Workers
```

## Project Structure

```
jant/
├── packages/core/           # Main application (@jant/core)
│   ├── src/
│   │   ├── index.ts        # Entry point, exports createApp
│   │   ├── app.ts          # Hono app factory
│   │   ├── types.ts        # TypeScript types
│   │   ├── db/             # Drizzle schema & migrations
│   │   ├── services/       # Business logic (TODO)
│   │   ├── routes/         # Route handlers (TODO)
│   │   ├── theme/          # UI components (TODO)
│   │   ├── lib/            # Utilities
│   │   └── i18n/           # Translations
│   ├── wrangler.toml       # Cloudflare config
│   └── drizzle.config.ts   # Drizzle config
├── docs/internal/          # Internal documentation
└── references/             # Third-party repos (gitignored)
```

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Database**: D1 + Drizzle ORM
- **Auth**: better-auth
- **UI**: BaseCoat (Tailwind-based)
- **i18n**: @lingui/core
- **Interactions**: Datastar

## Key Conventions

1. **Services**: All DB operations go through service layer
2. **Types**: Use types from `types.ts`, Zod for validation
3. **Time**: Unix timestamps (seconds), use `lib/time.ts`
4. **IDs**: Sqids for URLs (`/p/jR3k`), integers in DB
5. **Soft delete**: Posts use `deleted_at` field

## Current Status

- [x] Project setup (pnpm workspace, mise, tsconfig)
- [x] Core package structure
- [x] Database schema (Drizzle) + migrations
- [x] Basic types and utilities
- [x] Services layer (settings, posts, redirects)
- [x] Authentication (better-auth)
  - /setup - First-time setup with admin account creation
  - /signin - Login page
  - /signout - Logout
  - /api/auth/* - better-auth API endpoints
- [x] Basic dashboard placeholder (/dash)
- [x] i18n (lingui + custom t() function)
  - Locales: en, zh-Hans, zh-Hant
  - Auto-translate with OpenAI
- [ ] Full dashboard UI (posts CRUD)
- [ ] UI components (BaseCoat)

## Local Development

Dev server runs on port 9019: https://local.jant.me

Configuration in `.dev.vars`:
```
AUTH_SECRET=your-secret-at-least-32-chars
```
