# Discover help line: new copy, four links

## Why

The author rewrote the Discover copy in Settings → General:

- 允许搜索引擎收录我的网站 → 允许搜索引擎索引我的网站 (English already says
  "index").
- 在 Jant Discover 上列出我的网站 → 允许我的博客出现在 Jant Discover 中.
- The help line (author's Chinese, verbatim):

  > Jant Discover 是 Jant 社区人工维护的目录，旨在帮助用户发现新的 Jant 博客和内容。帖子设为 Featured 24 小时后会出现在 Discover 首页，Link 和 Quote 类型的帖子发布 24 小时后出现在 Links 和 Quotes 列表。这段时间里你可以继续修改，详见 Discover 社区规则。

  Links on `Jant Discover` → `/discover`, `Links` → `/links`, `Quotes` →
  `/quotes`, `Discover 社区规则` → `/discover/about`. The link on 目录 goes.

Directory paths confirmed in jant-cloud `apps/app/app/routes.ts`: the lists are
flat (`/discover`, `/links`, `/quotes`), the rules page is `/discover/about`.
The directory's own zh copy already says "Link 和 Quote 类型的帖子", and the
24 hours is its `PUBLIC_DELAY_SECONDS`.

## Design

- `lib/discover.ts`: `getDiscoverDirectoryUrl` → `getDiscoverPageUrls`
  (home, links, quotes, rules), derived from the same base address.
  `splitLinkedTerm` → `linkTerms`, which links several terms in one sentence
  and still degrades to plain text for any term a translation drops.
  `DISCOVER_LIST_NAMES` (Links/Quotes stay English, kept out of the catalog)
  and `DISCOVER_PUBLIC_DELAY_HOURS` (the directory's rule, stated by core like
  `DISCOVER_MIN_PUBLIC_POSTS`).
- English msgid follows the author's Chinese.
- Setup screen: same control, so the link moves from 目录 to the name there
  too; its shorter help line opens with the same first sentence.
- 收录 → 索引 also in the search-off line under the Discover box, which names
  the same checkbox.

## Steps

- [x] `lib/discover.ts` + unit tests
- [x] `GeneralContent.tsx`, `routes/dash/settings.tsx`, `settings-types.ts`
- [x] `jant-settings-general.ts`
- [x] `routes/auth/setup.tsx`
- [x] Component, view, setup tests
- [x] i18n: extract, zh-Hans / zh-Hant by hand, compile
- [x] Verify: check-types, check-lint, check-format, check-copy, i18n sync,
      check-tests, build

## Results

Done as designed. English msgid written to match the author's Chinese:

> {name} is a directory of Jant blogs, curated by hand by the Jant community to
> help people find new Jant blogs and posts. A post you mark Featured appears
> on the Discover home page {hours} hours later, and link and quote posts
> appear on the {links} and {quotes} lists {hours} hours after they are
> published. You can keep editing them in the meantime. See the {rules}.

The setup screen's help line keeps its first sentence and ends with "Posts you
mark Featured appear on the Discover home page." — concrete rather than "on
it", which read as "above" in Chinese (出现在上面).

`GeneralContent.test.tsx` now renders the help line in en, zh-Hans and zh-Hant
and fails if any catalog loses a linked term, which is how a reworded
placeholder would otherwise drop a link silently.

Verified: `check-types`, `check-lint`, `check-format`, `build` (budgets), i18n
catalogs in sync with source, every affected test file, and the settings page's
server output via the dev-login HTTP flow (all four URLs in `discover-pages`).
`check-copy` reports only `docs/internal/struggle.zh-Hans.md`, from fcebc1ae.

### Left open

Two tests fail on the full suite, both left stale by 103e1589 and not touched
here: `settings-discover.test.ts` posts `discover: "featured"`, which the
schema no longer accepts, and `language-routing.test.ts` expects the Discover
declaration without the new `featured="…"` attribute.
