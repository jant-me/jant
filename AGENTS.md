# Jant - Development Guide

## What is Jant

Jant (short for Jantelagen) is a personal microblogging system — self-hosted, single-author, and stripped of all social mechanics. No followers, no likes, no algorithmic feed. It combines Tumblr-style multi-format posts — Note (your own words), Link (shared reference), Quote (cited text) — Threads-style threading for connected thoughts, and curated Collections to organize content by topic. Just a clean space for one person to think out loud.

It runs on Cloudflare Workers with minimal infrastructure. The UI follows an "Organic Minimalism" aesthetic: generous whitespace, single-column layout, smooth animations, mobile-first.

The project is in **pre-1.0 development**. Breaking changes are expected and welcome when they improve the design. Always follow best practices over minimal-change conservatism. Update all references in the same change and document what changed in the commit message.

## Workflow

- **Plan first**: for non-trivial tasks (3+ steps), write a short plan in a task file under `tasks/todos/` before changing files. Name it by issue ID when available (`JANT-123-fix-auth-redirect.md`), otherwise `YYYY-MM-DD-HHMM-<slug>.md`.
- **Check in before starting** when the plan introduces meaningful scope, trade-offs, or risk. If something goes sideways mid-task, stop and re-plan.
- **Track work in the task file**: mark items complete as you go, record results at the end, and delete the file before committing once nothing in it is left unchecked. A task file with open items is active work — keep it. Completed files with long-term reference value move to an archive location, not `tasks/todos/`.
- **Bug reports**: just fix them, at the root cause. No temporary patches, no context switching required from the user.
- **Verify before done**: never mark a task complete without proving it works — tests, logs, or looking at the running result. Scope it with "Verify proportionally" below.
- **Capture lessons**: after a correction, update `tasks/lessons.md` only when there is a reusable rule that prevents future mistakes. Write concrete rules, not task logs.

## Development Philosophy

These principles explain _why_ the codebase is structured the way it is. When you encounter a situation not covered by a specific rule, use these to guide your judgment.

- **Implementation cost is not a design constraint**: every line of this codebase is AI-written. What is scarce is the author's review attention and the code's future — not agent hours. Between the cheap way and the maintainable way, always choose the maintainable one. "That's a big change" is not an objection, and scope never shrinks to save effort.

- **Challenge before complying**: when the user proposes an approach that conflicts with best practices or this document, push back with the trade-offs and ask for confirmation before proceeding. Silently following a suboptimal instruction is worse than a brief discussion.

- **Separation of concerns**: routes handle HTTP, services own business logic and all DB access, UI renders data. Module dependency direction: `routes → services → db`, `routes → viewmodels → ui`. Detailed rules in `docs/internal/coding-standards.md`.

- **Type safety as communication**: TypeScript strict mode, no `any`, fully typed exports. When a service return type changes, the compiler should catch every consumer.

- **Hosted split**: `jant-core` owns the runtime, the copy, and site display metadata; `jant-cloud` owns billing state, cancel/delete/restore policy, and retained-window rules — core links to those flows but never invents its own hosted billing or deletion semantics. Core stays provider-neutral: show the configured provider label, or fall back to the provider host — never hardcoded product branding. Control-plane copies of core data (cached site name, primary host) are synced projections, never a second editable source of truth. Browser-facing redirects go through the public control-plane URL; server-to-server calls use explicit internal URLs and tokens.

- **Tokens and components over raw values**: CSS tokens (`styles/tokens.css`) and BaseCoat semantic classes (`.alert`, `.btn`, `.badge`, `.card`, `.input`, `.field`) encode design decisions in one place; never hardcode a color or spacing value. BaseCoat variants (`.btn-outline`, `.btn-ghost`, `.badge-outline`, …) are self-contained — never combine them with the base class. See `docs/internal/theming.md` and `references/basecoat/`.

- **Cohesion over small files**: organize code by responsibility. A well-structured 400-line file beats four fragmented 100-line files that constantly import each other.

- **Strict boundaries, free internals**: validate and convert at boundaries (HTTP entry, DB queries). Once data is inside a layer, trust the types.

- **Data flows down**: DB → Service → ViewModel → Component. Never in the other direction.

- **Fail fast**: missing required config should crash at startup with a clear error, not silently degrade at runtime.

- **External links are intentional**: links that open in a new tab need `rel="noopener noreferrer"`. No `nofollow` on normal editorial links; reserve it for ads, sponsored placements, or future user-generated content.

- **Keyboard-first interactions**: every dialog, panel, and overlay supports `Escape` to close, `Enter` to confirm, `Tab` for focus navigation. `<dialog>` native cancel events may not fire when inner elements (TipTap/ProseMirror) intercept `Escape` at keydown — handle keyboard events on the component directly, not only via native dialog events.

- **Dismiss transient UI predictably**: menus, popovers, and dropdowns close on outside click/tap and `Escape`, and opening one closes peers of the same kind. Wire dismissal explicitly (never rely on browser defaults like `<details>`) and cover it with a test.

- **Preserve interaction affordances**: custom-styled controls still need `cursor: pointer`, visible hover/focus states, sensible disabled states, and correct initial focus when opening dialogs or overlays.

### Hard Constraints

Non-negotiable regardless of context:

- **No DB in routes**: routes must never contain direct DB calls, raw SQL, or import DB drivers. All data access goes through `src/services/`.
- **No business logic in routes**: a route handler only parses/validates the request, calls service methods, and formats the response. If two routes need the same sequence of service calls, extract it into a service method. Cross-cutting concerns like storage file cleanup are passed to services via optional dependency parameters (e.g. `storage?: StorageDriver | null`), never handled in routes.
- **Migrations are append-only and schema-first**: never edit or replace an existing migration in `src/db/migrations/` — applied migrations are tracked by filename, and rewriting one desyncs the history from real databases. To undo `0016`, create `0017` with the reverse DDL. For normal schema changes, update `src/db/schema.ts` first, then run `drizzle-kit generate` via `mise run db-schema-generate`. Manual migrations are allowed only for what Drizzle cannot express (FTS virtual tables, triggers); keep them in `src/db/migrations/` with the same `0000_name.sql` numbering and update the journal/snapshot metadata in the same change. Historical data fixes are a separate track: append-only numbered SQL in `src/db/backfills/`, idempotent, run via `jant migrate` — never ad-hoc files like `0004z_*` in `src/db/migrations/`.
- **Dual-dialect schema: SQLite AND Postgres must stay in sync**: Jant runs on both SQLite/D1 (`src/db/schema.ts`) and Postgres (`src/db/pg/schema.ts`). When adding or modifying columns, **always update both schema files** and both migration directories (`src/db/migrations/`, `src/db/migrations/pg/`; generate with `mise run db-schema-generate` / `db-schema-generate-pg`). If auto-generation produces "no changes", write the Postgres migration manually and update its `meta/_journal.json`. Forgetting the Postgres schema causes silent data loss — Drizzle ignores columns it doesn't know about.
- **Seed/import SQL must declare columns and validate against current schema**: committed SQL snapshots and export scripts must use `INSERT INTO table (col, ...) VALUES (...)`, never bare `INSERT INTO table VALUES (...)`. After schema changes, validate seed/import SQL against a fresh local D1 with the current migrations before treating it as safe.
- **Relative imports only**: no `@/` path aliases anywhere in the codebase.
- **Client bundles are budgeted**: `client.js` is for readers, `client-auth.js` is a shell, and the editor, settings, and management code load on demand (`src/client/lazy-entries.ts`). Heavy packages stay behind `import()` at the point of use, and server-rendered markup never calls a lazily defined element directly. The client build fails over budget; which entry a component belongs in is in `docs/internal/lit-guide.md`.
- **Stylesheets are budgeted the same way**: `client.css` is render-blocking on every public page, so it carries reader styles only. Component CSS that renders exclusively for a signed-in author — the composer, the editor chrome, the command palette, the settings pages, the draft preview bar — lives in `styles/ui-author.css` and ships as `client-author.css`, which `BaseLayout` links only when the page is authenticated. A selector belongs there when every one of its comma-separated parts names an author-only class; the TipTap classes that also appear in published post HTML stay in `styles/ui.css`. `src/__tests__/stylesheet-audience.test.ts` enforces the split and the build fails if `client.css` goes over budget.
- **Data attributes with care**: `data-page`, `data-post`, `data-format`, etc. are consumed by themes and external scripts. Design them thoughtfully and update all references when changing.
- **No raw strings in `dangerouslySetInnerHTML`**: every string passed to it must be either (a) HTML from a trusted renderer (TipTap, `getHtmlExcerpt`), or (b) plain text passed through `escapeHtml()` first — even single-author content can contain `<`, `>`, `&`. For highlighted output, escape first, then replace control-character sentinels: `escapeHtml(text).replace(/\x02/g, "<mark>").replace(/\x03/g, "</mark>")`, where `char(2)`/`char(3)` (STX/ETX) are the FTS5 snippet markers in SQL. Never inject `<mark>` into unescaped text.

## Working with the Codebase

### Tooling

- **Use mise tasks** for all commands (`mise tasks` to list). Never run `wrangler dev`; use `mise run dev` / `mise run build`.
- **Deployment shorthand**: when the user says "部署", interpret it as "commit the current work and push the current branch". Site rollout happens automatically after push unless the user says otherwise.
- **Debug**: `mise run dev-debug` prepares local auth helpers automatically and uses the first free debug port starting at `19020`. For browser testing, use the printed `http://localhost:19xxx/__dev/login?token=...&redirect=/settings` URL with `DEV_API_TOKEN` from `packages/core/.dev.vars`, then continue on `http://localhost:19xxx/settings`. `jant.localtest.me` is still accepted locally, but some browsers upgrade it to HTTPS and break local HTTP dev ports. HTTP agents can call the same local login URL directly and reuse the returned `Set-Cookie`. Stop background processes when done.
- **Verify before changing**: never assume CLI flags; confirm with `--help` or docs.
- **Latest packages**: when adding dependencies, check the latest stable version and compatibility first, then let the package manager lock the resolved version.
- **Generated template is read-only**: never edit `packages/create-jant/template/` — it is auto-generated and will be overwritten.
- **GitHub Actions**: new manually runnable workflows should include `workflow_dispatch:`.
- **Verify proportionally**: choose verification by the risk and surface area of the change.
  - Run `mise run check-tests` and `mise run check-lint` for behavior changes: routes, services, DB/schema/migrations, validation, auth, build tooling, shared infrastructure, interactive client logic, or anything with meaningful regression risk.
  - For isolated visual or content-only changes (CSS tweaks, spacing, copy, docs), a focused sanity check is usually enough if no logic, markup structure, or event handling changed. For copy and docs, run `mise run check-copy` — style is verifiable, not a matter of taste.
  - Near the boundary, run the narrower relevant verification first, then escalate if the impact is broader than expected.
  - Always state what you verified, and explicitly note when you skipped automated checks.

### Conventions

- `packages/core`: library + dev environment (Vite HMR). `sites/demo`: demo site + user template source (via `@create-jant` annotations).
- **Types**: public exports in `src/types.ts`; definitions in `src/types/`.
- **Schemas**: shared domain schemas in `src/lib/schemas.ts`; route-specific schemas colocated with routes.
- **Routes**: `xxxRoutes` suffix (`postsRoutes`, `settingsRoutes`).
- **DB table names**: always singular or domain-specific (`post`, `collection`, `nav_item`, `api_token`, `path_registry`), never plural.
- **Time**: Unix timestamps (seconds) via `lib/time.ts`.
- **URL query params**: on public shareable URLs, names must be single lowercase words — fold presence flags into values (`media=any|none|<kinds>`, `title=any|none`, `replies=any|none`), never `hasX=1/0` booleans; `visibility=hidden` is the URL alias for `latest_hidden`. Compound camelCase names are allowed only on machine surfaces (APIs, dash, auth). Param renames on shareable URLs require accept-old/emit-new parsing kept indefinitely. Details in `docs/internal/coding-standards.md`.
- **IDs**: TypeID (text) everywhere — DB, API, auth tables, jobs, storage-backed entities. Store canonical TypeID strings directly; never convert them back to UUIDs in application code. Use the shared prefixes from `src/lib/ids.ts` (`pst`, `med`, `col`, `pth`, `cdi`, `nav`, `api`, `usr`, `ses`, `acc`, `vrf`). **Post URLs**: slug-based (`/{slug}`). Slugs are auto-generated from title (via `lib/slug.ts`) or as random alphanumeric IDs (via `lib/nanoid.ts`). Path overrides are managed through the `path_registry` table. **Collection URLs**: single collections share the root-URL namespace with posts (`/{slug}` — uniqueness enforced by `path_registry`). Only `/collections` itself (the directory), aggregate selections (`/collections/{a+b}`), and management routes (`/collections/new`, `/collections/{slug}/edit`) live under `/collections`. `SLUG_ID_LENGTH` env var controls random slug length (default: 5).
- **Deletion**: posts and media hard-delete their rows (the old `post.deleted_at` soft-delete was removed). For media **storage objects**, `media.delete`/`deleteByIds` free the original key immediately (so the original URL 404s at once). When the storage driver supports server-side copy (S3-compatible, including R2 via its S3 API), the bytes are first moved to a `trash/` key recorded in `storage_purge` and physically purged only after a 30-day recycle window by the upload cleanup sweep — so accidental deletes stay recoverable. Drivers without server-side copy (R2 Workers binding, local) delete immediately with no recycle.
- **Documentation links**: never write a docs URL by hand. `docs/` is published on the Jant site (`docs/multilingual.md` → `/docs/multilingual`, lowercase, no extension), and the host differs per environment, so link through `getJantDocsUrl()` in `lib/jant-docs.ts`. Client components cannot resolve it themselves — Vite's `define` does not reach dev-server modules — so the server passes the URL down with the rest of the component's initial state. Published markdown (READMEs, `wrangler.toml` comments) writes `https://jant.me/docs/...` directly; only GitHub-hosted files that are not docs (LICENSE, CONTRIBUTING, `.env.example`) still link to the repo.
- **Library functions**: include JSDoc with `@param`, `@returns`, `@example`.

### i18n

All user-facing strings use Lingui message descriptors with a `@context:` comment for translators. In components, import `msg` from `@lingui/core/macro`, get `i18n` from the local context hook, and translate with `i18n._(...)`:

```tsx
import { msg } from "@lingui/core/macro";
import { useLingui } from "../../i18n/context.js";

const { i18n } = useLingui();
return (
  <h1>
    {i18n._(
      msg({
        message: "Settings",
        comment: "@context: Page title",
      }),
    )}
  </h1>
);
```

When interpolating runtime values, keep them in `values`:

```tsx
i18n._(
  msg({
    message: "Found {count} results",
    comment: "@context: Search results count",
  }),
  { count },
);
```

Rules that recur:

- Never bake runtime values into the `message` string — placeholders plus `values`, or extraction and translations silently break.
- Normalize blank labels before passing them into `values`, and never use truthiness fallbacks for numbers or booleans — `0` and `false` are valid data.
- Import `useLingui` from the local i18n context as shown above, never from `@lingui/react/macro`; no raw `t({ ... })` calls.

### Tech Stack

Cloudflare Workers, Hono v4, Vite + SWC, Tailwind v4 + BaseCoat, D1 + Drizzle ORM, better-auth, @lingui/core, Datastar v1.0.0-RC.7 (vendored — version matters, APIs vary between releases), Lit (Web Components), Zod, ESLint + Prettier

## UX Copy Guidelines

These rules govern **UI strings** — buttons, errors, empty states, settings descriptions — in every locale; the Chinese section adds locale-specific rules. For **prose** (anything under `docs/`, `README.md`, multi-sentence `msgstr` values) see `docs/internal/writing-style.md`. Run `mise run check-copy` after touching either.

**Style anchor**: write like iA Writer or Bear — a quiet tool, not a companion. Declarative sentences, short lines, no praise, no mascot energy. If a line would fit in a marketing email or an onboarding tour, rewrite it.

**Match the existing corpus**: before writing or changing any string, read the neighboring strings — the surrounding component and the same area of `src/i18n/locales/*/en.po` — and match their register, terminology, and casing. The existing copy is the style guide of record.

Banned in any locale: exclamation points; cheerleading ("Awesome", "You're all set", "Oops"); tour-guide framing ("Let's …", "your journey"); marketing adverbs ("seamlessly", "effortlessly", "instantly"); filler ("please", "simply", "just"); "successfully"; emoji; vague failure ("Something went wrong" with no cause or next step).

Patterns, each with the shape to copy:

- **Empty states**: pair the absence with a next action or reason. `"Nothing published yet. Write your first post to get started."` — never a bare `"No posts."`
- **Buttons**: verb-first, action-specific. `"Publish"`, `"Delete Media"` — never `"Submit"`, `"OK"`, `"Confirm"`.
- **Errors**: what went wrong + what to do, without blaming the user. `"Wrong email or password. Check your credentials and try again."` — never `"Invalid input"`.
- **Success**: brief acknowledgment. `"Post published."`, `"Settings updated."` — never `"Operation completed successfully."`
- **Destructive actions**: name what will be lost, irreversible-sounding if it is. `"Delete this post permanently? This can't be undone."` — never `"Are you sure?"`
- **Settings descriptions**: what the setting does, not what it is. `"Hide this post from search engines and RSS feeds"` — never `"Visibility: Private"`.

### 中文文案（zh-Hans / zh-Hant）

Chinese copy is written, not translated. Say it the way a native product would; never mirror English sentence structure word-for-word.

- **人称**：统一用「你」，禁止「您」。能省则省 — 优先无主语句式（「已发布」，不是「你的文章已发布」），只有指代不清时才写「你」。
- **标点**：中文句子一律用全角标点（，。？「」（）），不允许半角逗号、句号夹在中文里。纯英文、数字、代码、URL 片段保持半角。
- **语气**：不用感叹号，不用语气词卖萌（哦、啦、哟、呢）。「请稍后再试」这类惯用语可以用，但一条信息里最多一个「请」。
- **反翻译腔**：先想中文里本来怎么说，再落笔。「{count} 个设置已显示」是翻译腔，「已显示 {count} 个设置」才像话。「进行…操作」「对…进行」一律改写成直接的动词。
- **术语表**（**以 `src/i18n/locales/glossary.zh-Hans.yml` / `glossary.zh-Hant.yml` 为准**，新增术语先改术语表）：Post→帖子（zh-Hant：貼文）、Note→笔记、Link→链接、Quote→引用、Collection→合集（zh-Hant：選集）、Thread→帖子串（zh-Hant：貼文串）、Draft→草稿；「账户」不写「帐户」。注意区分产品名词和普通名词：`帖子` 指 Jant 的 Post，泛指别人写的文章仍用 `文章`（「我分享一些好文章」是对的）。
- **zh-Hant 不是简繁转换**：用词按台湾惯用（設定、選集），不要机械转换 zh-Hans。

## Reference

If you notice code contradicting this document, think about which side is correct, then update whichever is wrong.

### Docs Index

- **Coding standards** (module deps, error handling, testing): `docs/internal/coding-standards.md`
- **Writing style** (long-form docs prose, genre discipline, 中文对照): `docs/internal/writing-style.md`
- **Lit/Datastar conventions**: `docs/internal/lit-guide.md`
- **Testing guide**: `docs/internal/testing-guide.md`
- **Agent automation testing**: `docs/internal/agent-automation-testing.md`
- **Datastar patterns and API**: `docs/datastar.md`, `references/datastar/`
- **BaseCoat components**: `references/basecoat/`
- **Configuration**: `docs/configuration.md`
- **Theming (user-facing)**: `docs/theming.md`
- **Theming (internal design guide)**: `docs/internal/theming.md`
- **Releasing**: `docs/RELEASING.md`
- **Developer onboarding**: `README.md`, `mise tasks`
