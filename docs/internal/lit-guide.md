# Lit Guide (Long-Term Conventions)

This document defines the ongoing Lit coding conventions for Jant.
It is separate from `docs/internal/lit-migration.md`, which tracked one-time migration work.

## When Lit Is Appropriate

- Use Datastar by default for server-driven state, simple toggles, and SSE flows.
- Use Lit for high-frequency client state, complex data staging, and third-party library wrappers.

## Required Patterns

### 1) Static Properties Pattern (No Decorators)

Use `static properties = { ... }` plus `declare` fields. Do not use decorators (`@property`, `@state`).

Why:

- SWC decorator support/config introduces avoidable friction and compatibility risks.
- Static properties are a first-class Lit pattern and keep build/runtime behavior predictable.

### 2) `classMap` Import Path

When using dynamic class composition, import exactly:

```ts
import { classMap } from "lit/directives/class-map.js";
```

### 3) Cleanup in `disconnectedCallback`

Every component that registers side resources must clean them up in `disconnectedCallback`, including:

- Event listeners
- Timers / intervals
- Observers
- Any external subscription handles

### 4) Naming and File Location

- Custom element tag names must use `jant-xxx` format.
- Custom events must use `jant:xxx` format.
- Client-side component files live in `src/client/components/`; server-rendered
  wrappers live with their owning feature under `src/ui/`.

### 5) Light DOM + SSR Fallback

- Use Light DOM only:
  - `createRenderRoot() { return this; }`
- No Shadow DOM styles in components (`static styles`).
- Server should render a useful skeleton/static fallback inside the custom element tag.
- Lit upgrades that fallback on hydration.

### 6) Which Bundle a Component Ships In

Signed-in pages load `src/client-auth.ts`, a small shell, and fetch the rest
by what the page contains. `src/client/lazy-entries.ts` owns the split; the
build fails when a heavy package or an over-budget entry slips into a
first-page-view bundle (`enforceClientBundleBudget` in `vite.shared.ts`).

| Entry                    | Loads when                                                                             | Put here                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/client.ts`          | every page                                                                             | reading interactions; Datastar and Lit                                                                     |
| `src/client-auth.ts`     | every signed-in page                                                                   | what an author uses on any page: post menu, command palette, shortcuts, the buttons that open the composer |
| `src/client-compose.ts`  | the composer first opens, or at once on the compose page                               | the editor, TipTap, uploads, slash commands                                                                |
| `src/client-settings.ts` | a settings element is on the page                                                      | settings pages                                                                                             |
| `src/client-manage.ts`   | the navigation manager, collection directory, or a collection page menu is on the page | management surfaces                                                                                        |

Rules that follow from the split:

- A new component goes in the narrowest entry that is on every page it
  renders on. When it is page-specific, add its tag (or the hook the server
  renders with it) to `PAGE_ENTRIES` in `lazy-entries.ts` so the shell loads
  the entry when the markup is present.
- Server-rendered markup must not call a lazily defined element directly —
  before its entry loads, the tag is an unupgraded `HTMLElement` with no
  methods. Render a data attribute the shell handles instead: `data-compose-open`,
  `data-reply-trigger`, `data-draft-continue` are wired in
  `src/client/compose-triggers.ts`. Shell code that needs the composer awaits
  `ensureComposeDialog()` from `compose-launch.ts`.
- Packages that only matter after an action — `mediabunny`, `heic-to`,
  `emoji-mart`, the slug dictionaries — stay behind an `import()` at the point
  of use (`client/mediabunny.ts`, `client/lazy-slugify.ts`). The guard lists
  them in `LAZY_ONLY_PACKAGES`.
- `pnpm build:client` prints every entry's gzipped size next to its budget.
  When a change needs a bigger budget, raise it in `ENTRY_BUDGETS_GZIP` with
  the reason in the commit message.

## Example Component

```ts
import { LitElement, html } from "lit";
import { classMap } from "lit/directives/class-map.js";

export class JantExample extends LitElement {
  static properties = {
    label: { type: String },
    _active: { state: true },
  };

  declare label: string;
  declare _active: boolean;

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.label = "";
    this._active = false;
  }

  render() {
    return html`<div class=${classMap({ active: this._active })}>
      ${this.label}
    </div>`;
  }
}

customElements.define("jant-example", JantExample);
```
