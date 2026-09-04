# Split author-only CSS out of the reader stylesheet

Item 3 from `2026-09-04-1540-public-page-performance.md`. Self-contained —
nothing from that session is needed to start.

## The problem

`client.css` is **568,404 bytes uncompressed / ~83 KB brotli**, render-blocking
on every page, served cross-origin from the asset host. On a live post page the
Lighthouse trace shows FCP landing ~75 ms after the stylesheet finishes
downloading, so this file _is_ the FCP floor for the whole site.

Layer breakdown of the built file:

| Layer          | Bytes       |
| -------------- | ----------- |
| properties     | 2,423       |
| theme          | 3,094       |
| base           | 4,459       |
| **components** | **462,361** |
| utilities      | 41,126      |

`@layer components` is almost all of it, and `src/styles/ui.css` (385,834 bytes)
is the bulk of that. Broken down by class family (top-level rules inside its
`@layer components` block):

| Family          | Bytes   | Rules | Audience             |
| --------------- | ------- | ----- | -------------------- |
| `.compose-*`    | 104,928 | 532   | author only          |
| `.tiptap-*`     | 28,045  | 145   | author only          |
| `.command-*`    | 3,901   | 23    | author only          |
| `.theme-*`      | 2,718   | 20    | author only (verify) |
| `.draft-*`      | 2,706   | 10    | author only (verify) |
| `.settings-*`   | 2,514   | 18    | author only          |
| `.picker-*`     | 1,911   | 12    | author only (verify) |
| `.confirm-*`    | 465     | 7     | author only (verify) |
| `.collection-*` | 24,433  | 132   | reader               |
| `.site-*`       | 23,759  | 110   | reader               |
| `.post-*`       | 21,321  | 139   | reader               |
| `.archive-*`    | 11,664  | 74    | reader               |
| `.brand-*`      | 9,176   | 55    | reader               |
| `.feed-*`       | 7,038   | 42    | reader               |
| `.thread-*`     | 6,888   | 37    | reader               |

Reproduce the table with the script in "Measuring" below.

AGENTS.md already budgets the _JS_ this way — `client.js` for readers, the
editor and settings behind `import()` (`src/client/lazy-entries.ts`). The CSS
never got the same treatment.

## Expected win — read this before starting

The clearly author-only families total **~147 KB of 568 KB uncompressed (26%)**.
Assuming they compress like the rest of the file, that is roughly **20 KB brotli
off the critical path of every page**, or about **100 ms of FCP** at Lighthouse's
simulated mobile bandwidth, plus less CSS to parse and less style recalculation.

Real, sitewide, but not a step change. It is the largest of the remaining
performance items, and it is also the one with the most build and cascade risk.
If it turns out to fight the build, items 6 and 7 in the umbrella file are
cheaper and worth doing first.

**Re-measure before starting.** The baseline above predates
commit `cf202a90` (page size 50 → 25, author-only DOM removed), which has not
been deployed yet. That commit did not touch CSS, so the stylesheet numbers
should be unchanged — confirm rather than assume.

## How the CSS is built

The mechanism is already in place for the CJK stylesheets; an author stylesheet
follows the same path.

- `packages/core/src/style.css` — the one reader entry:
  `@import "tailwindcss"` then `@import "./preset.css"`.
- `packages/core/src/preset.css` — imports basecoat, the typography plugin,
  `styles/components.css`, `styles/tokens.css`, `styles/ui.css`,
  `styles/site-media.css`, and defines `@theme` tokens and the dark-mode
  fallbacks.
- `packages/core/src/styles/ui.css` — `@source "../ui/"` then one big
  `@layer components { … }`.
- `packages/core/vite.shared.ts` → `clientBuildOptions.rollupOptions.input`
  lists every entry (`style`, `style-cjk`, `style-cjk-tc`, …), and
  `output.assetFileNames` maps each `*.css` name to its hashed public filename.
- `packages/core/vite.config.worker.ts` reads `dist/client/.vite/manifest.json`
  (`readClientManifestFile("src/style.css", "client", ".css")`) and feeds
  `__CLIENT_CSS_FILE__` and friends into `define`.
- `packages/core/src/lib/version.ts` declares and re-exports those as
  `CLIENT_CSS_FILE`, `CLIENT_CJK_CSS_FILE`, …
- `packages/core/src/ui/layouts/BaseLayout.tsx` emits the `<link>` tags
  (`CLIENT_CSS_FILE` around line 543, the CJK one around 254). It already
  computes `resolvedClientBundle = clientBundle ?? (isAuthenticated ? "full" :
"public")` — that is the gate to reuse.
- `packages/core/vite.config.ts` `define` block carries dev-mode placeholders
  for each `__CLIENT_*_CSS_FILE__`; dev serves the source path instead
  (`IS_VITE_DEV`).

## Plan

1. Move the author-only families out of `styles/ui.css` into a new
   `styles/ui-author.css`, keeping them inside `@layer components`. Verify each
   "verify" row above against its component before moving it — a family that
   turns out to be reader-facing must stay.
2. Add `packages/core/src/style-author.css` as the entry. It must **not**
   `@import "tailwindcss"` — that would duplicate the whole base, theme and
   utilities layers. It needs the layer order declared so `@layer components`
   resolves the same way, and it needs the tokens it references to already be
   defined by `client.css` (they are — both stylesheets load together on an
   author page). Check what Tailwind v4 wants here: `@reference` is the
   documented way for a second file to see the theme without emitting it again.
3. Register the entry: `clientBuildOptions.rollupOptions.input`,
   `output.assetFileNames`, `vite.config.worker.ts` manifest read + define,
   `vite.config.ts` dev placeholder, `lib/version.ts` declare/export.
4. `BaseLayout.tsx`: emit the author stylesheet only when
   `resolvedClientBundle === "full"`. In dev (`IS_VITE_DEV`) point at
   `/src/style-author.css` the way the CJK branch points at its source.
5. Check `enforceClientBundleBudget()` in `vite.shared.ts` — it currently
   budgets JS chunks. Consider adding a budget for `client.css` so the reader
   stylesheet cannot silently grow back.

## Risks

- **Cascade layers.** Layer order is document-wide and fixed by first
  appearance. `client.css` loads first and establishes
  `properties, theme, base, components, utilities`, so a later stylesheet
  re-opening `@layer components` joins the existing layer rather than creating
  a new one after `utilities`. Confirm this in a browser, not by reasoning —
  get it wrong and author styles either lose to utilities or beat them.
- **Source order within the layer.** Two rules of equal specificity in the same
  layer are decided by order, and the author sheet now comes second. Compose
  rules and reader rules mostly do not overlap, but check the shared ones
  (`.btn-*`, `.field-*`, `.input-*`, `.prose-*` appear in ui.css with 1-2 rules
  each).
- **Tailwind utilities are not split by this.** `@source "../ui/"` scans the
  whole tree and emits every utility the compose components use into
  `client.css`'s `utilities` layer. That layer is 41 KB total and stays where it
  is. The saving is the hand-written component CSS only — do not promise more.
- **`@source` scoping.** If `ui-author.css` gets its own `@source`, make sure
  the reader entry no longer scans the compose tree, or the utilities come back.
- **Dev parity.** Vite dev serves CSS from source; the author sheet has to load
  there too or the composer will look broken in `mise run dev` only.

## Measuring

Family breakdown of `ui.css`:

```
python3 - <<'EOF'
import re
from collections import Counter
css=open('packages/core/src/styles/ui.css',encoding='utf-8').read()
b=Counter(); r=Counter()
pat=re.compile(r'\n {2}([^\s{}][^{}\n]{0,400}?)\s*\{')
pos=0
while True:
    m=pat.search(css,pos)
    if not m: break
    depth=0; j=m.end()-1
    while j<len(css):
        if css[j]=='{': depth+=1
        elif css[j]=='}':
            depth-=1
            if depth==0: break
        j+=1
    cl=re.findall(r'\.([a-zA-Z0-9_-]+)',m.group(1))
    fam=cl[0].split('-')[0] if cl else '(at-rule)'
    b[fam]+=j-m.start(); r[fam]+=1
    pos=j+1
for k,v in b.most_common(40): print(f"{v:>8,} {r[k]:>4} rules  .{k}-*")
EOF
```

Layer sizes of a built stylesheet: same brace-walk over
`@layer (\w+) {` in `dist/client/_assets/client-*.css`.

## Verifying

- `mise run check-tests` and `mise run check-lint` — this touches build config
  and shared infrastructure.
- `mise run build`, then confirm `dist/client/_assets/` holds both stylesheets
  and that `client.css` actually shrank by roughly the expected amount.
- `mise run dev-debug`, then load a reader page and an author page in the
  browser pane and compare against `main`. The composer, the command palette,
  the settings pages and the theme sample page are the surfaces most likely to
  lose styling — open each one. Confirm the reader's page still renders
  identically.
- Confirm the reader page requests only `client.css` (plus the CJK sheet) and
  the author page requests both.
