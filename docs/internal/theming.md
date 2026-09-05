# Theming (Internal)

Design guidelines and implementation details for contributors and AI agents.

For user-facing documentation, see [`docs/theming.md`](../theming.md).

## Design Philosophy: Organic Minimalism

Jant follows an **Organic Minimalism** (Soft UI) design language. Every UI decision should reflect these principles:

### Core Principles

- **Soft over sharp**: Prefer rounded corners, gentle gradients, and subtle shadows over hard edges and flat surfaces. Elements should feel approachable, not mechanical.
- **Breathe**: Generous whitespace is a feature, not waste. Content needs room to exist comfortably. Never crowd elements.
- **Quiet depth**: Use soft shadows and layering to create subtle spatial hierarchy. Avoid heavy drop shadows or stark elevation changes.
- **Natural palette**: Colors should feel muted, warm, and organic. Avoid saturated neon or high-contrast clashes. Think sun-bleached linen, stone, warm fog.
- **Minimal noise**: Remove anything that doesn't serve the content. No decorative borders, unnecessary dividers, or visual clutter. When in doubt, leave it out.
- **Gentle motion**: Transitions should be smooth and understated — ease-out curves, short durations. Animation supports comprehension, never demands attention.
- **Typography-driven hierarchy**: Let font size, weight, and spacing do the work. Avoid relying on color or decoration to establish hierarchy.

### Practical Guidelines

| Aspect      | Do                                                   | Don't                           |
| ----------- | ---------------------------------------------------- | ------------------------------- |
| Corners     | Soft radius (`0.5rem`-`1rem`)                        | Sharp 0 or overly pill-shaped   |
| Shadows     | Diffused, low-opacity (`0 2px 8px rgba(0,0,0,0.06)`) | Hard, high-contrast box shadows |
| Backgrounds | Subtle off-whites, warm grays                        | Pure `#fff` / `#000`            |
| Borders     | Thin (`1px`), low-contrast, or omit entirely         | Thick or high-contrast borders  |
| Spacing     | Generous padding and margins                         | Tight/cramped layouts           |
| Feedback    | Soft color shifts, gentle scale                      | Flash, shake, or bounce         |
| Icons       | Thin stroke, rounded joins                           | Heavy/filled, angular           |
| Text color  | Muted foreground, never pure black                   | `#000` on `#fff`                |

### Anti-Patterns to Avoid

- **Neumorphism excess**: A hint of inner/outer shadow for depth is fine; full neumorphic buttons with dual shadows are too heavy.
- **Gradient overuse**: Subtle background gradients are welcome; rainbow or multi-stop gradients on UI elements are not.
- **Over-decoration**: Ornamental lines, badges, or illustrations that don't serve function.
- **Contrast starvation**: Soft does not mean invisible. Maintain WCAG AA contrast ratios for text readability.

## Implementation

### CSS Priority (lowest to highest)

1. BaseCoat defaults (`:root`)
2. Design tokens (`styles/tokens.css`)
3. Component styles (`styles/components.css`, `styles/ui.css`; plus `styles/components-author.css` and `styles/ui-author.css` on signed-in pages)
4. Selected color theme (`:root:root` specificity)
5. `cssVariables` from `createApp()` config
6. Custom CSS injection from settings

### Component Styling

Jant uses [BaseCoat](https://github.com/hunvreus/basecoat) for UI components. Style components using its class names:

```html
<button class="btn">Post</button>
<input class="input" placeholder="What's on your mind?" />
<div class="card">...</div>
```

Use Tailwind utilities for layout only:

```html
<!-- Good: Tailwind for layout -->
<div class="flex gap-4 mt-2">...</div>

<!-- Avoid: Tailwind for component styling -->
<button class="bg-blue-500 px-4 py-2 rounded">...</button>
```

### Dark Mode

By default, dark mode follows `@media (prefers-color-scheme: dark)`. Users can also force Light or Dark in **Settings > Color Theme** via a root `data-theme-mode` attribute. BaseCoat ships with a `.dark` class-based approach, but `preset.css` overrides this:

1. `@custom-variant dark` is redefined to use the media query (for Tailwind `dark:` utilities)
2. BaseCoat's `.dark { }` variables are mirrored in a `@media` block in `preset.css` (as fallback)
3. `buildThemeStyle()` outputs theme dark overrides for both system-driven dark mode and forced dark mode, with higher specificity than BaseCoat defaults

**When upgrading BaseCoat**: check if the `.dark { }` variable block changed and update the mirror in `preset.css`.

### Adding a New Color Theme

Define themes in `src/ui/color-themes.ts` using `defineTheme()`. Each theme specifies 8 required colors plus optional semantic colors per mode:

- **Required**: `bg`, `fg`, `primary`, `primaryFg`, `siteAccent`, `muted`, `mutedFg`, `border`
- **Optional**: `destructive`, `success`, `searchMarkBg`, `searchMarkColor`, `dashBg`

Optional colors fall back to sensible defaults. Override them when the default clashes with the theme's palette (e.g. green `--success` on the Gameboy green theme).

### Typographic Voice Separation

The font system distinguishes two voices:

- **Content voice** (`--font-heading`, `--font-body`, `--font-serif`) — controlled by the active font theme. Used for post titles, body text, quotes, and anything the user is _reading_.
- **UI voice** (`--font-ui`) — always system sans-serif, never overridden by font themes. Used for buttons, badges, navigation, timestamps, form labels, admin headings, and anything the user is _operating_.

**Decision rule:** if the user is reading it, use content voice. If the user is interacting with it, use UI voice.

This separation is invisible when the font theme is sans-serif (most themes), but becomes critical with serif themes like Tufte or Bookish — serif buttons and navigation labels look broken.

`--font-ui` is defined in `tokens.css` and wired into BaseCoat via `--default-font-family` in `preset.css`, so all BaseCoat components (`.btn`, `.badge`, `.input`, `.alert`, `.select`) automatically use the UI font. Content elements override with `var(--font-body)` or `var(--font-heading)` as needed.

### Animation

Transitions use these CSS variables:

```css
--transition-fast: 150ms ease-out;
--transition-base: 200ms ease-out;
```

### CJK Font Assets

Self-hosted CJK font subsets live under `packages/core/src/styles/fonts/`.

Font profiles resolve from the language of the page being rendered — a post's
own language on a post page, the view language on a language-filtered list, and
`SITE_LANGUAGE` otherwise:

1. A language that maps to `zh-Hans`, `zh-Hant`, `ja`, or `ko` (including
   equivalent regional BCP 47 tags) selects the matching profile, which
   overrides both fallback variables and loads that profile's stylesheet.
2. Every other language keeps the script-neutral defaults from `tokens.css`:
   Simplified first, then Traditional, Japanese, and Korean.

The default is a real stack, not a placeholder. The families around this slot
are Latin-only and `serif` / `sans-serif` resolve to Latin faces too, so a
default that matches nothing hands CJK text to the operating system's
last-resort font — on Apple platforms that is PingFang SC, which renders a serif
page in sans. `DEFAULT_FONT_CJK_SERIF_FALLBACK` and
`DEFAULT_FONT_CJK_SANS_FALLBACK` in `ui/font-themes.ts` mirror the token values,
and a test fails if the two drift.

Every font theme retains control over whether a surface uses serif or sans.
Profiles only fill `--font-cjk-serif-fallback` and
`--font-cjk-sans-fallback`; they never change a theme's pairing. The profile
stylesheet supplies the self-hosted serif face, while the sans profile prefers
locale-appropriate system families before falling back across CJK variants.

- Simplified Chinese uses the vendored `Noto Serif SC` subsets in `packages/core/src/styles/fonts/noto-serif-sc/`.
- Traditional Chinese uses vendored `Noto Serif TC` subsets in `packages/core/src/styles/fonts/noto-serif-tc/`.

Regenerate both CJK packs with:

```bash
pnpm --filter @jant/core fonts:generate:cjk
```

Generate a single pack with:

```bash
pnpm --filter @jant/core fonts:generate:sc
pnpm --filter @jant/core fonts:generate:tc
```

The generator reads the source `woff2` files from `@fontsource/noto-serif-sc` or `@fontsource/noto-serif-tc`, runs `cn-font-split`, then rewrites the generated CSS so the committed output stays under `src/styles/fonts/`.

Jant intentionally keeps these font subsets as real asset files instead of inline `data:` URLs.

- The app ships with a strict CSP and keeps `font-src 'self'`.
- Inline `data:` fonts would require widening CSP to `font-src 'self' data:`.
- Real font files cache independently from CSS and fit the reserved `/_assets/*` asset namespace better.
- Tiny subsets are still emitted as files on purpose. This is a policy choice, not an accident.

If you change the font pipeline, preserve that behavior.

- The CJK generator appends `?no-inline` to generated `woff2` URLs.
- The client build also disables asset inlining for production.
- Treat any reappearance of `data:font/...` in built CSS as a regression.

Run it again when upgrading either `@fontsource` package or changing the split strategy.
