---
"@jant/core": patch
---

Posts read as articles again. Titles and headings are semibold, the weight a heading needs to stand above bold body text; before, they were medium, which the CJK serif faces have no face for, so a Chinese heading came out in Regular and lighter than the `<strong>` runs under it. Body text is 17px, up from 16.8px on desktop and on a par with the phone size, with titles and headings scaling with it. A heading sits closer to the text it introduces than to the paragraph before it. On a post's page the date sits a clear step below the title, a size larger, with more room before the body. A page in Chinese, Japanese or Korean gets a taller line height for body and headings, since those glyphs fill the line where Latin lowercase does not.

A titled post's timeline excerpt is now its lead: it stops ahead of the first heading, instead of running on into a section and showing its title with one orphaned paragraph. Headings a post opens with are kept. The character budget counts a Han, kana or hangul character as two, so a Chinese teaser takes the room an English one does rather than twice it. A heading inside an excerpt is set as a heading, above body size, not at body size in the medium weight.

Simplified and Traditional Chinese serif stacks now put the Noto Serif face the site ships ahead of SimSun and PMingLiU, which have one weight and render headings in synthetic bold on Windows.

For themes: `--type-heading-weight` and `--type-display-weight` default to `var(--fw-semibold)`, `--type-heading-leading` to `1.2`, and `--type-content-scale` to `0.81`. The Tufte font theme sets both weights back to `var(--fw-regular)`. A CJK page sets `--type-body-leading: 1.75` and `--type-heading-leading: 1.3` on `:root` ahead of the theme style, so a font theme or custom CSS that sets either still wins.

**Upgrade notes**

- No database migrations.
