# Reading typography: timeline excerpt and post body

Branch: `reading-typography`. Trigger: luckyhuangbin.jant.blog looks amateurish,
especially the timeline card of `/cheng-wei-wen-yi-fu-xing-ren` and the post
body. Goal: a default reading surface that looks professional on every Jant
site, in Jant's quiet style, for Chinese and Latin alike.

## What is wrong today (measured on the live site, 1230px viewport)

- Hierarchy is inverted for CJK. Headings use `--type-heading-weight: 500`;
  Songti SC has no 500 face, so headings render Regular while `<strong>` in the
  PingFang body renders Semibold. The feed title (22.8px) and every h2/h3 read
  lighter than bold body text.
- A heading inside an excerpt is set at body size (16.8px) in that thin serif,
  so "1. 广博而跨界的能力" looks like a stray line, not a heading.
- The excerpt cuts after five blocks regardless of structure: it runs past a
  heading into the first paragraph of a section, so the teaser shows a section
  title and one orphaned paragraph. The 500-char budget counts a Han character
  as one, so a Chinese teaser is about twice as tall as a Latin one.
- Body 16.8px on desktop; the current consensus floor is 18px (Medium 21,
  Substack 20, Ghost 17–19, sspai 17 with 1.8 leading).
- Heading bottom margin equals the paragraph gap, so a heading floats between
  paragraphs instead of binding to its text.
- Detail title → date gap is 0.7rem and the date is 13.5px: cramped.
- Windows: the zh-Hans serif stack lists SimSun before the vendored Noto Serif
  SC, so serif headings there are SimSun with synthetic bold.

## Plan

- [x] tokens.css: `--type-heading-weight` → semibold (docs already say
      headings are semibold), `--type-display-weight` likewise, heading
      leading 1.2, content scale 0.8 → 0.86 (body 18px), CJK overrides via
      `:root:lang()` (body leading 1.8, heading leading 1.3).
- [x] font-themes.ts: Tufte keeps regular-weight headings (its identity);
      zh-Hans/zh-Hant serif stacks prefer the vendored Noto Serif face over
      SimSun/PMingLiU.
- [x] preset.css: heading margins bind to their text (top ≈ 2–2.5× bottom);
      feed-body headings sized and weighted as headings.
- [x] summary.ts: excerpt stops before a heading once it holds a text block;
      budget counts East Asian wide characters as two.
- [x] ui.css: detail title/meta spacing, meta size; feed title leading.
- [x] Export theme `main.css` follows wherever it mirrors these rules.
- [x] Tests: summary.test.ts (new rules), timeline-cards/view tests, drift
      tests (`theme-docs`, token/font-theme sync), check-lint, check-tests.
- [x] Visual verification on the local dev server with the live post's content
      (desktop + phone, light + dark, Classic + Tufte + Bookish).

## Results

- Verified on the local dev server with the live site's five posts imported
  (same titles, dates, language), Classic + Tufte color theme, site language
  zh-Hans: desktop 1280, phone 390, dark mode, and all seven font themes.
- Excerpt of `/cheng-wei-wen-yi-fu-xing-ren` now ends at "核心点是：" and the
  Continue link, instead of running into section 1.
- Titles and headings render in Songti SC Bold / New York Semibold; body 18px
  at 1.75 leading on a zh-Hans page, 16.8px on phones.
- `mise run check-tests` (typecheck + lint + 5468 tests) and `check-copy`
  pass.
- Left alone, as a follow-up: the desktop frame still pins the column to the
  left with the Tufte sidenote gutter on the right; centering it when a post
  has no footnotes is a layout decision for the author.
