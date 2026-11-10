---
"@jant/core": patch
---

On a page in Chinese, Japanese or Korean, titles and headings are set in the medium weight instead of semibold. The CJK serif faces have no semibold, so a Song title came out in Bold, far heavier than the Latin heading beside it and than the body under it, most of all on a phone. In medium, Songti and the Noto Serif the site ships fall to Regular and the title's size carries the hierarchy, as a book sets a chapter title; PingFang and the other sans faces have a Medium and take the half step. Pages in other languages keep semibold.

For themes: a CJK page sets `--type-heading-weight` and `--type-display-weight` to `var(--fw-medium)` on `:root` ahead of the theme style, the way it already sets the leadings, so a font theme or custom CSS that sets either still wins.

**Upgrade notes**

- No database migrations.
