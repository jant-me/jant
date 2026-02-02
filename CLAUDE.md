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

4. **Reuse and compose**
   - Extract reusable components when patterns repeat (3+ times)
   - Compose from small, focused components
   - Keep components single-purpose and well-documented

5. **Use Vite for everything**
   - **Development**: `vite dev` (NOT `wrangler dev`)
   - **Build**: `vite build` (NOT custom build scripts)
   - **Preview**: `vite preview`
   - Vite is the single source of truth for dev, build, and preview workflows
   - @cloudflare/vite-plugin handles Cloudflare Workers integration seamlessly

## Important Rules

- **Node.js version: 24 (LTS)** - Always use Node 24 in CI workflows, package.json engines, and documentation. Do NOT use older versions like 20 or 22. The current LTS is 24.
- **Always use latest versions** when installing dependencies. DO NOT use outdated versions from training data. Check npm for current versions or use `pnpm add <package>@latest`.
- **Use mise.toml for all commands** - Wrap all development commands in mise tasks. Never require users to `cd` into directories - use the `dir` parameter instead. This keeps the workflow simple and discoverable.
- **All GitHub workflows need manual trigger** - Always add `workflow_dispatch:` to all GitHub Actions workflows so they can be triggered manually from the Actions tab.
- **Stop dev processes after debugging**: When starting dev server or other background processes for testing/debugging, always stop them when done so the user can restart them manually.
- **Use debug port for testing**: When debugging, use `mise run dev-debug` which runs on port 19019, leaving port 9019 free for the user.
- **Do NOT publish packages**: After making changes, do NOT run publish commands. The user will handle publishing manually using `mise run version` and `mise run release-local`.

## Quick Reference

```bash
# Development
mise run dev          # Start Vite dev server (http://localhost:9019)
mise run dev-debug    # Start Vite dev server on port 19019 (for Claude debugging)
mise run typecheck    # Run TypeScript checks (strict mode)
mise run lint         # Run ESLint
mise run format       # Format code with Prettier

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

# Release (Changesets)
mise run changeset    # Create a changeset for your changes
mise run cs:status    # Check pending changesets
mise run version      # Apply changesets (bump versions)
mise run release      # Publish packages to npm
mise run release:dry  # Dry run publish

# First-time Publish (manual, before Trusted Publishing)
mise run publish:core   # Publish @jant/core to npm
mise run publish:create # Publish create-jant to npm
```

## Project Structure

```
jant/
├── packages/core/           # Main application (@jant/core)
│   ├── src/
│   │   ├── index.ts        # Entry point, exports createApp
│   │   ├── app.tsx         # Hono app factory
│   │   ├── types.ts        # TypeScript types (single source of truth)
│   │   ├── db/             # Drizzle schema & migrations
│   │   ├── services/       # Business logic (service layer)
│   │   ├── routes/         # Route handlers (xxxRoutes naming)
│   │   │   ├── api/        # API endpoints
│   │   │   ├── dash/       # Dashboard routes (protected)
│   │   │   ├── pages/      # Public pages
│   │   │   └── feed/       # RSS/Sitemap
│   │   ├── theme/          # UI layer
│   │   │   ├── components/ # Reusable components (see below)
│   │   │   └── layouts/    # Layout components
│   │   ├── lib/            # Utilities (100% JSDoc documented)
│   │   │   ├── markdown.ts # Markdown rendering
│   │   │   ├── sqid.ts     # ID encoding/decoding
│   │   │   ├── time.ts     # Time utilities
│   │   │   ├── url.ts      # URL utilities
│   │   │   └── schemas.ts  # Zod validation schemas
│   │   ├── i18n/           # Internationalization
│   │   │   ├── README.md   # Detailed i18n documentation
│   │   │   ├── context.tsx # Custom SSR-compatible i18n hooks
│   │   │   └── locales/    # Translation catalogs
│   │   └── middleware/     # Hono middleware
│   ├── static/             # Static assets (copied to dist/client/assets/)
│   ├── vite.config.ts      # Vite build config
│   ├── .swcrc              # SWC config (JSX + Lingui macro)
│   ├── eslint.config.js    # ESLint config
│   ├── .prettierrc         # Prettier config
│   ├── wrangler.toml       # Cloudflare config
│   └── drizzle.config.ts   # Drizzle config
├── docs/                   # Documentation
│   ├── API.md              # API documentation
│   └── internal/           # Internal documentation
└── references/             # Third-party repos (gitignored)
```

### Reusable Components

Located in `src/theme/components/`:

**CRUD Components:**
- `CrudPageHeader` - Page header with title + action button
- `EmptyState` - Empty state display with optional CTA
- `ListItemRow` - Consistent list item layout
- `ActionButtons` - Edit/View/Delete button group
- `DangerZone` - Destructive action section with confirmation

**Badge Components:**
- `TypeBadge` - Post type badge (Note/Article/Link/Quote/Image/Page)
- `VisibilityBadge` - Visibility badge (Featured/Quiet/Unlisted/Draft)

**Form Components:**
- `PostForm` - Post creation/editing form
- `PageForm` - Page creation/editing form

**Display Components:**
- `PostList` - Post list with filtering
- `ThreadView` - Thread/reply chain display
- `Pagination` - Cursor/page-based pagination

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono (v4)
- **Build**: Vite + SWC + @cloudflare/vite-plugin
- **CSS**: Tailwind CSS v4 (@tailwindcss/postcss) + BaseCoat
- **Database**: D1 + Drizzle ORM
- **Auth**: better-auth
- **i18n**: @lingui/core + @lingui/swc-plugin (macros)
- **Interactions**: Datastar
- **Code Quality**: ESLint + Prettier + husky + lint-staged
- **Validation**: Zod

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

## Architecture Conventions

### 1. Type System

**Single Source of Truth: `types.ts`**
- All type definitions live in `types.ts`
- Use `const` assertions for enums: `POST_TYPES = [...] as const`
- Export derived types: `type PostType = (typeof POST_TYPES)[number]`

**Validation: `lib/schemas.ts`**
- Zod schemas import constants from `types.ts`
- Used only for runtime validation (forms, API requests)
- Example: `PostTypeSchema = z.enum(POST_TYPES)`

### 2. Route Naming

**Convention: Use `xxxRoutes` suffix consistently**
```typescript
// ✅ Correct
export const postsRoutes = new Hono<Env>();
export const homeRoutes = new Hono<Env>();
export const dashIndexRoutes = new Hono<Env>();

// ❌ Incorrect (inconsistent)
export const postRoute = new Hono<Env>();
export const homeroute = new Hono<Env>();
```

### 3. Service Layer

- All database operations go through services
- Services are stateless and accept database connection
- Located in `src/services/`
- Export both service functions and types

### 4. Component Reuse

**When to extract a component:**
- Pattern repeats 3+ times across files
- Component has single, clear responsibility
- Benefits code consistency and maintenance

**Component guidelines:**
- Use TypeScript interfaces for props
- Add JSDoc comments for complex components
- Export both component and prop types
- Keep components focused and composable

### 5. Utility Functions

- Located in `src/lib/`
- **100% JSDoc documentation coverage**
- Include `@param`, `@returns`, and `@example` tags
- Pure functions when possible
- Thorough TypeScript typing

## Code Quality Standards

### TypeScript
- Strict mode enabled
- No `any` types (use proper types or `unknown`)
- All exports are typed
- 100% type coverage

### ESLint
- Zero errors policy
- Warnings are acceptable for console.log, non-null assertions (with comments)
- Configuration in `eslint.config.js`

### Prettier
- Auto-format on save
- Pre-commit hook formatting
- Configuration in `.prettierrc`

### Pre-commit Hooks
- **husky**: Git hooks management
- **lint-staged**: Format staged files
- Runs: ESLint --fix + Prettier --write

## Internationalization (i18n)

**Quick Start:**

```tsx
import { useLingui } from "@/i18n";

function MyComponent() {
  const { t } = useLingui();

  return <h1>{t({ message: "Dashboard", comment: "@context: Page title" })}</h1>;
}
```

**Key Rules:**
1. ALL user-facing strings must use `t()` function
2. Always include `comment` with `@context:` prefix
3. Wrap app in `<I18nProvider c={c}>` (BaseLayout does this automatically when `c` prop provided)
4. Use `useLingui()` hook inside components

**Detailed documentation:** See `src/i18n/README.md`

**Workflow:**
1. Add translations with `t()` function
2. Run `pnpm i18n:extract` to extract messages
3. Run `mise run translate` for AI translation (optional)
4. Run `pnpm i18n:compile` to compile catalogs

## Datastar Usage

Datastar is used for client-side interactivity with SSE-powered real-time updates.

### 1. Signals (Reactive State)

Define signals on a parent element. Use `_` prefix for local signals (not sent to server).

```tsx
<div data-signals="{_loading: false, _error: null, count: 0}">
  <span data-text="$count"></span>
  <button data-on-click="$count++">Add</button>
</div>
```

### 2. Conditional Display

```tsx
<span data-show="!$_loading">Ready</span>
<span data-show="$_loading">Loading...</span>
```

### 3. Dynamic Classes

```tsx
<button data-class-opacity-50="$_loading">Submit</button>
```

### 4. SSE Responses (Server → Client)

Use the `sse()` helper from `lib/sse.ts` for real-time updates:

```typescript
import { sse } from "../../lib/sse.js";

app.post("/api/action", (c) => {
  return sse(c, async (stream) => {
    // Update signals
    await stream.patchSignals({ _loading: false });

    // Update DOM
    await stream.patchElements('<div id="result">Done!</div>');

    // Prepend to list
    await stream.patchElements('<li>New item</li>', {
      mode: 'prepend',
      selector: '#items'
    });
  });
});
```

### 5. Custom SSE Handling (File Uploads)

For file uploads, manually parse SSE since Datastar doesn't handle FormData:

```javascript
const response = await fetch('/api/upload', {
  method: 'POST',
  body: formData,
  headers: { 'Accept': 'text/event-stream' }
});

// Parse SSE events manually and update Datastar store
const store = Datastar.store();
// ... parse and apply events
```

### 6. Expression Rules

Use **expressions**, not statements in `data-on-*`:

```tsx
// ❌ Wrong
data-on-click="if (x) doSomething()"

// ✅ Correct
data-on-click="x && doSomething()"
```

### 7. Signal Scoping

Define signals on a **parent element** that contains all elements needing access.

### 8. Common Pitfalls

**Signal not found error**: `Cannot read properties of undefined (reading 'value')`

This happens when Datastar can't find the signal. Causes:
- Signal defined on wrong element (child instead of parent)
- Signal name mismatch (case-sensitive)
- Element with `data-signals` not processed yet when child elements try to access

**For complex interactions (file uploads, etc.)**, use plain JavaScript with DOM manipulation instead of Datastar signals. Datastar is best for simple reactive state, not complex async flows:

## Key Conventions

1. **Services**: All DB operations go through service layer
2. **Types**: Single source of truth in `types.ts`, Zod for validation
3. **Time**: Unix timestamps (seconds), use `lib/time.ts` utilities
4. **IDs**: Sqids for URLs (`/p/jR3k`), integers in DB
5. **Soft delete**: Posts use `deleted_at` field
6. **Routes**: Use `xxxRoutes` naming convention consistently
7. **Components**: Extract when pattern repeats 3+ times

## Current Status

### Core Features ✅
- [x] Project setup (pnpm workspace, mise, tsconfig)
- [x] Database schema (Drizzle) + migrations (including FTS5)
- [x] Services layer (settings, posts, redirects, media, collections, search)
- [x] Authentication (better-auth)
- [x] Dashboard (posts, pages, media, collections, redirects, settings)
- [x] Frontend pages (home, post, archive, search, custom pages)
- [x] Thread/reply chain display
- [x] Full-text search (FTS5)
- [x] Feed (RSS, Atom, Sitemap)

### Code Quality ✅
- [x] TypeScript strict mode (0 errors)
- [x] ESLint configuration (0 errors, minimal warnings)
- [x] Prettier auto-formatting
- [x] Pre-commit hooks (husky + lint-staged)
- [x] 100% JSDoc coverage for utility functions

### Architecture ✅
- [x] Type system unified (single source of truth)
- [x] Route naming standardized (xxxRoutes convention)
- [x] Component library established (7 reusable components)
- [x] i18n custom SSR-compatible implementation
- [x] Service layer pattern throughout

### Component Library ✅
- [x] CRUD components (EmptyState, ListItemRow, ActionButtons, CrudPageHeader, DangerZone)
- [x] Badge components (TypeBadge, VisibilityBadge)
- [x] Form components (PostForm, PageForm)
- [x] Display components (PostList, ThreadView, Pagination)

### Release System ✅
- [x] Changesets for version management
- [x] GitHub CI (lint, typecheck, build)
- [x] Automated npm publishing via GitHub Actions
- [x] SemVer versioning
- [x] Auto-generated changelogs with PR links

## Releasing

This project uses [Changesets](https://github.com/changesets/changesets) for version management. See [docs/RELEASING.md](docs/RELEASING.md) for full documentation.

**Quick workflow:**
1. Make changes in a branch
2. Run `mise run changeset` to create a changeset
3. Open PR and merge to main
4. Merge the auto-created "Release" PR to publish

**Packages:**
| Package | Description |
|---------|-------------|
| `@jant/core` | Core framework |
| `create-jant` | CLI scaffolding tool |

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

## Code Quality Metrics

Current state (as of latest refactor):
- **TypeScript**: 0 errors, 100% type coverage
- **ESLint**: 0 errors, 0 warnings
- **Build**: Clean builds in <1s
- **Test coverage**: Services layer functional
- **Documentation**: 100% JSDoc coverage for utilities
- **Component reuse**: 7 shared components eliminating ~35% code duplication
