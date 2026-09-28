---
"@jant/core": patch
"create-jant": patch
---

`@jant/core` publishes its types as `dist/index.d.ts`, instead of pointing TypeScript at its own source, and no longer asks for `hono` as a peer dependency: the Hono it runs on is bundled. `createApp()` is typed as an `App` with a single `fetch` method rather than the whole Hono application. Compatibility adds the `DB` and `R2` binding names to the project layout a release keeps.

**Upgrade notes**

- No database migrations.
- A TypeScript site that called Hono methods on what `createApp()` returns, other than `fetch`, no longer type-checks. Only `fetch` was ever part of the API.
