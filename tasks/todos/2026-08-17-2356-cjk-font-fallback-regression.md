# CJK body font falls back to the OS last resort on non-CJK pages

Reported by heyhihello.jant.blog (蛋花儿女士): Chinese body text switched from a
serif face to PingFang SC and cannot be changed back.

## Diagnosis

`--font-cjk-serif-fallback` / `--font-cjk-sans-fallback` default to the literal
family name `"Jant Language Fallback"`, which no font is called. It was meant to
read as "no opinion", but a font stack cannot hold a no-op: the browser skips the
name, the Latin families in the stack have no Han coverage, and `ui-serif` /
`serif` resolve to Times/New York — also no Han. So the glyphs come from the OS
last-resort font, PingFang SC on macOS/iOS. A serif page renders Chinese in sans.

`BaseLayout` only overrides those two variables when the page language resolves
to a CJK profile (`zh-Hans`, `zh-Hant`, `ja`, `ko`). A site whose content is
Chinese but whose `SITE_LANGUAGE` is `en` therefore keeps the dead placeholder
and never loads the vendored Noto Serif SC stylesheet either.

Two commits together produced the report:

- `1d3fa078` replaced the real default CJK stacks in `tokens.css` with the
  placeholder, relying on `SITE_LANGUAGE` or an explicit `CJK_SERIF_FONT`
  setting to fill them in.
- `2aad38a0` removed `CJK_SERIF_FONT` entirely (config, service, settings UI)
  while 29 sites still had a value stored — so the escape hatch that had been
  covering the placeholder disappeared. heyhihello had `CJK_SERIF_FONT=zh-Hans`
  stored and `SITE_LANGUAGE=en`.

Production audit (Postgres on prod-deploy): 71 sites contain Han characters, 36
of them declare a non-CJK `SITE_LANGUAGE`, and all 36 are ≥50% CJK content. 4 of
those 36 have an ignored `CJK_SERIF_FONT` value.

## Fix

- [x] Give `--font-cjk-serif-fallback` / `--font-cjk-sans-fallback` real,
      script-neutral default stacks (Simplified-first, then Traditional,
      Japanese, Korean) in both `tokens.css` and `font-themes.ts`. A page in any
      language then renders CJK text in the intended serif/sans voice; the
      per-language profiles keep reordering it for correct glyph shapes.
- [x] Add a test that reads `tokens.css` and asserts its defaults match the
      exported constants, so the two copies cannot drift again.
- [x] Update the stale `CJK_SERIF_FONT` paragraph in `docs/internal/theming.md`.

Not doing: reinstating `CJK_SERIF_FONT`. The content language is the single
source of truth for script, and the 36 affected sites also serve `<html
lang="en">` and English-tagged feeds for Chinese content — the real fix for them
is setting the content language, which the default stack no longer blocks on.

## Results

- `mise run check-tests` — 279 files, 3616 tests passed.
- `mise run check-types`, `mise run check-lint`, `mise run check-copy` — clean.
- `mise run build` — the emitted `client-*.css` carries the real stack in
  `:root`, starting at `"Songti SC"` (serif) and `"PingFang SC"` (sans).
- Browser check in Chrome (macOS): a `lang="en"` page using the `literary`
  theme's serif stack renders 中文 in Songti SC with the new fallback, matching
  an explicit `font-family: "Songti SC"` control and clearly distinct from the
  `"PingFang SC"` control. The old placeholder chain happened to resolve to
  Songti on this machine and to PingFang on the reporter's — which is the bug:
  the outcome was left to OS and browser defaults.
