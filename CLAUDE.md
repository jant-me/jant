# Jant - Development Guide

## Development Principles

**🎯 Core Principle: Simplicity and Best Practices**

This is an open source project. Code quality and maintainability are paramount.

1. **Use best practices over custom solutions**
   - Prefer standard tools and patterns from the ecosystem
   - Don't reinvent the wheel - use established libraries correctly
   - When in doubt, follow official documentation and community standards

2. **Keep code simple and readable**
   - Simple code > clever code
   - Clear intent > maximum abstraction
   - If a solution seems overly complex, rethink the approach

3. **Avoid unnecessary abstraction**
   - Don't write custom scripts when standard tools work
   - Don't bypass library features - use them as intended
   - Question any solution that requires "working around" a tool

4. **Use Vite for everything**
   - **Development**: `vite dev` (NOT `wrangler dev`)
   - **Build**: `vite build` (NOT custom build scripts)
   - **Preview**: `vite preview`
   - Vite is the single source of truth for dev, build, and preview workflows
   - @cloudflare/vite-plugin handles Cloudflare Workers integration seamlessly

## Important Rules

- **Always use latest versions** when installing dependencies. DO NOT use outdated versions from training data. Check npm for current versions or use `pnpm add <package>@latest`.
- **Stop dev processes after debugging**: When starting dev server or other background processes for testing/debugging, always stop them when done so the user can restart them manually.
- **Use debug port for testing**: When debugging, use `mise run dev-debug` which runs on port 19019, leaving port 9019 free for the user.

## Quick Reference

```bash
# Development (uses Vite)
mise run dev          # Start Vite dev server (http://localhost:9019)
mise run dev-debug    # Start Vite dev server on port 19019 (for Claude debugging)
mise run typecheck    # Run TypeScript checks
mise run lint         # Run ESLint

# Build & Deploy
mise run build        # Build with Vite
mise run deploy       # Build + deploy to Cloudflare Workers
mise run preview      # Preview production build with Vite

# Database
mise run db-generate  # Generate Drizzle migrations
mise run db-migrate   # Apply migrations (local D1)

# i18n
mise run i18n         # Extract + compile translations
mise run i18n-extract # Extract messages from source
mise run i18n-compile # Compile PO files to JS
mise run translate    # Auto-translate using AI (needs OPENAI_API_KEY)
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
│   │   ├── services/       # Business logic
│   │   ├── routes/         # Route handlers
│   │   ├── theme/          # UI components
│   │   ├── lib/            # Utilities
│   │   └── i18n/           # Translations
│   ├── static/             # Static assets (styles.css, datastar.js)
│   ├── vite.config.ts      # Vite build config
│   ├── .swcrc              # SWC config (JSX + Lingui macro)
│   ├── wrangler.toml       # Cloudflare config
│   └── drizzle.config.ts   # Drizzle config
├── docs/internal/          # Internal documentation
└── references/             # Third-party repos (gitignored)
```

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Build**: Vite + SWC + @cloudflare/vite-plugin
- **CSS**: Tailwind CSS v4 (@tailwindcss/postcss) + BaseCoat
- **Database**: D1 + Drizzle ORM
- **Auth**: better-auth
- **i18n**: @lingui/core + @lingui/swc-plugin (macros)
- **Interactions**: Datastar

### Build Process

**All workflows use Vite - no custom scripts, no wrangler build commands.**

**Development (`pnpm dev` / `vite dev`):**
1. Vite dev server starts on port 9019
2. @cloudflare/vite-plugin integrates with Cloudflare Workers runtime
3. CSS processed in real-time with Tailwind CSS v4 + PostCSS
4. Hot Module Replacement (HMR) for instant updates
5. Reads `.dev.vars` for environment variables

**Production Build (`pnpm build` / `vite build`):**
1. Vite builds both Worker code and CSS:
   - Worker code → `dist/jant/` (server-side runtime)
   - CSS + static assets → `dist/client/` (client assets served by Workers)
2. **CSS with hash**: Tailwind CSS processed → `styles-[hash].css`
3. **Asset manifest**: Custom Vite plugin generates `src/lib/assets.gen.ts` with hashed paths
4. **SSR**: BaseLayout imports `ASSETS` from `assets.gen.ts` for dynamic injection
5. Static files from `static/` copied to `dist/client/assets/`

**Deployment (`pnpm deploy`):**
1. Run `vite build` to generate production bundle
2. Use `wrangler deploy` to upload to Cloudflare (reads `dist/jant/wrangler.json`)

**Key Point:** Never run `wrangler dev` or manual build commands. Vite handles everything.

## Key Conventions

1. **Services**: All DB operations go through service layer
2. **Types**: Use types from `types.ts`, Zod for validation
3. **Time**: Unix timestamps (seconds), use `lib/time.ts`
4. **IDs**: Sqids for URLs (`/p/jR3k`), integers in DB
5. **Soft delete**: Posts use `deleted_at` field
6. **i18n**: ALL user-facing strings MUST use `t()` function with `@context` comment

## i18n Rules (IMPORTANT)

**Every user-facing string must use the `t()` function from `useLingui()` hook.** No hardcoded strings in UI.

### React-like API (useLingui hook)

We provide a React-like API that works with Hono JSX SSR:

```tsx
import { I18nProvider, useLingui, Trans } from "@/i18n";

// 1. Wrap your app in I18nProvider (in route handler)
route.get("/", async (c) => {
  return c.html(
    <I18nProvider c={c}>
      <MyApp />
    </I18nProvider>
  );
});

// 2. Use useLingui() hook inside components
function MyApp() {
  const { t } = useLingui();

  return (
    <div>
      {/* Simple translation */}
      <h1>{t({ message: "Dashboard", comment: "@context: Page title" })}</h1>

      {/* With variables */}
      <p>{t({ message: "Hello {name}", comment: "@context: Greeting" }, { name: "Alice" })}</p>

      {/* With embedded components - use Trans */}
      <Trans comment="@context: Help text">
        Read the <a href="/docs">documentation</a>
      </Trans>
    </div>
  );
}
```

See `src/i18n/README.md` for detailed documentation.

### Translation Guidelines

```tsx
import { I18nProvider, useLingui } from "@/i18n";

// ✅ Correct - wrap app in I18nProvider
c.html(
  <I18nProvider c={c}>
    <MyComponent />
  </I18nProvider>
)

// ✅ Correct - use useLingui() hook in components
function MyComponent() {
  const { t } = useLingui();
  return <h1>{t({ message: "Settings", comment: "@context: Page title" })}</h1>;
}

// ✅ Correct - with variables
const { t } = useLingui();
const greeting = t({ message: "Hello {name}", comment: "@context: Greeting" }, { name });

// ✅ Correct - with embedded components
<Trans comment="@context: Help link">
  Visit <a href="/docs">our website</a>
</Trans>

// ❌ Wrong - hardcoded string
<h1>Settings</h1>

// ❌ Wrong - no I18nProvider wrapper
c.html(<MyComponent />)  // useLingui() will throw error

// ❌ Wrong - useLingui() called outside components
route.get("/", async (c) => {
  const { t } = useLingui();  // Error: called outside I18nProvider
  ...
});
```

### Workflow

1. **Wrap your app** in `<I18nProvider c={c}>` in route handlers
2. **Use `useLingui()` hook** inside components to get the `t()` function
3. **Always include `comment`** with `@context:` prefix explaining where/how the string is used
4. **Variables as second parameter**: `t({ message: "Hello {name}", comment: "..." }, { name })`
5. **Run `pnpm i18n:extract`** after adding new strings to update PO files
6. **Run `mise run translate`** to auto-translate with AI (requires OPENAI_API_KEY)
7. **Run `pnpm i18n:compile`** to compile PO files to TypeScript catalogs (hash-keyed)
8. **Do NOT translate**: URLs, code, technical identifiers, HTML attributes (except alt text)

### Build Architecture

We use **Vite + SWC + Lingui SWC Plugin**:
- `@lingui/swc-plugin` transforms `msg()` macros at build time into hash-based message descriptors
- Wrangler calls `vite build` which uses SWC to transform TypeScript + JSX + Lingui macros
- Compiled catalogs use hash keys (e.g., `"7p5kLi": "Dashboard"`) for optimal bundle size
- Per-request i18n instances avoid race conditions in Cloudflare Workers' concurrent environment

## Current Status

- [x] Project setup (pnpm workspace, mise, tsconfig)
- [x] Core package structure
- [x] Database schema (Drizzle) + migrations (including FTS5)
- [x] Basic types and utilities
- [x] Services layer (settings, posts, redirects, media, collections, search)
- [x] Authentication (better-auth)
- [x] Dashboard (posts, pages, media, collections, redirects, settings)
- [x] i18n (lingui + custom t() function)
- [x] Frontend pages (home, post, archive, search, custom pages)
- [x] Thread/reply chain display
- [x] Full-text search (FTS5)
- [x] Feed (RSS, Atom, Sitemap)

## Local Development

Vite dev server listens on all network interfaces (`host: true`) and allows custom domains via `allowedHosts`.

**Access methods:**
- **Localhost**: http://localhost:9019
- **Local domain** (via Caddy): https://local.jant.me
- **Network IP**: http://[your-ip]:9019

**Configuration in `.dev.vars`:**
```
AUTH_SECRET=your-secret-at-least-32-chars
```

**Custom domain setup:**
The project is configured to work with Caddy reverse proxy pointing `local.jant.me` to port 9019.
If you use a different local domain, update `server.allowedHosts` in `vite.config.ts`.

When you run `pnpm dev`, Vite will show:
```
➜  Local:   http://localhost:9019/
➜  Network: http://10.x.x.x:9019/
```
