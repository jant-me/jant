# Trim the Jant Discover copy in General settings

## Why

The Discover block in Settings → General reads as an essay next to the one-line
checkbox above it:

```
[ ] Allow search engines to index my site

Discover is a public list of Jant blogs. It shows one of your posts at a time,
never sooner than a day after you publish it, and links back to your site.
How Discover picks posts

[ ] Show my site and posts in Jant Discover
    ( ) Latest / ( ) Featured only
    Turning this on sends your feed address to the directory once, so it knows
    your site exists.
[Save]
Where your site stands
Your feed says none, so no directory will list this site.
```

Three separate explanations, one of which (the announcement line) repeats what
the status block underneath already says, and a status block that reports "you
are not listed" to someone who just left the box unchecked.

The docs link is also invisible: it carries `class="link"`, and no `.link` rule
exists anywhere in the stylesheets, so under Tailwind preflight it renders as
plain body text. The same component styles its feeds docs link with
`underline hover:text-foreground transition-colors`.

## Design

- The checkbox becomes parallel to the indexing one above it — one line, same
  shape: **"Allow Jant Discover to list my site"**, with `Jant Discover` as the
  underlined docs link. The name is a `{name}` placeholder so word order stays
  free per locale; the component splits the translated string on the translated
  name and wraps that run in an anchor. If the split fails the sentence still
  renders whole, just without a link.
- One help line under it replaces the intro paragraph and the standalone
  "How Discover picks posts" link.
- The announcement line goes: the status block already says "Not announced yet.
  Save this section to announce your site." / "Feed address sent to the
  directory."
- A site that declares `none` is handed no status lines at all, so the block
  disappears rather than reporting "no directory will list this site" to
  someone who simply left the box unticked. The decision sits in the server's
  status builder, not in the component: the lines describe what is _stored_,
  so a tick that has not been saved yet must not change them.

## Also in scope: the docs page goes away

`docs/discover.md` was 114 lines for what is, in core, two settings and one
feed element. Most of it described the jant.me directory's own behaviour —
rotation, how long a post holds a slot, eligibility — which under the hosted
split is not core's to document, and which the directory's own page answers
better because it is the thing itself.

So: the page is deleted in both locales, and the part core genuinely owns
moves into `docs/feeds.md` as a `## Discover` section — the settings, the
one-off announcement, `DISCOVER_PING_URL`, and the `jant:discover` declaration
a third-party directory has to honour. The declaration is a feed extension;
"Feeds" is where someone reading feeds will look for it.

The settings page then links the directory's name to the **directory**, not to
a page about it: `getDiscoverDirectoryUrl()` derives `/discover` from the
configured ping URL, the same way `getDiscoverSubmitUrl()` already derives the
submission form, so a site announcing to a directory of its own links there.

## Steps

- [x] `ui/dash/settings/GeneralContent.tsx`: new `discoverName`, reword
      `discoverEnabled` + `discoverIntro`, drop `discoverAnnounce` and
      `discoverDocs`.
- [x] `client/components/jant-settings-general.ts`: link inside the label
      (stopPropagation so it does not toggle the box), real underline class,
      help line under the checkbox, status only when enabled.
- [x] Tests: component + GeneralContent.
- [x] `lib/discover.ts`: `getDiscoverDirectoryUrl()`; route and component
      swap `discoverDocsUrl` for `discoverUrl`.
- [x] Docs: delete `docs/discover.md` + `docs/zh-Hans/discover.md`, add
      `## Discover` to `docs/feeds.md`, fix both SUMMARYs and
      `docs/configuration.md`.
- [x] i18n: extract, hand-write zh-Hans / zh-Hant, compile.
- [x] Verify: `check-types`, `check-tests`, `check-lint`, `check-format`,
      `check-copy`.

## Results

Done as designed. Notes worth keeping:

- `class="link"` was dead: no `.link` rule exists in any stylesheet, so both
  links in this component rendered as plain body text under Tailwind's
  preflight. They now carry the same `underline hover:text-foreground
transition-colors` as the feeds docs link beside them.
- `getJantDocsUrl` has no caller left in `routes/dash/settings.tsx`.
- The label's docs link needs `stopPropagation`: a `<label>` forwards a click
  on any descendant to its control, so an unguarded link would open the
  directory and flip the setting on the way out. Covered by a test.

## Copy settled with the author

The help line is the author's, verbatim:

> 公开的 Jant 博客列表，延迟 24 小时展示你的博客最新一篇帖子，并链接回你的站点。

The English msgid was written to match it rather than the other way round.
Two objections were raised and overruled, recorded here so they are not
re-litigated: that 24 hours is the directory's interval rather than core's,
and that "latest post" does not hold under **Featured only**. The author's
call stands.

The one change to the author's wording came from the repo's own linter, not
from judgment: `zh-post-term` in `scripts/check-copy.mjs` rejects 文章 where
the msgid says "post", per the glossary, and has no `copy-ok` escape. Author
chose 帖子 / 貼文 over adding one.

zh-Hans now says 收录 in both checkboxes, matching zh-Hant, which already used
收錄 for search engines.

### Left open

`docs/zh-Hans/` has no `feeds.md`, so deleting `docs/zh-Hans/discover.md`
leaves Chinese readers without the declaration contract. The zh set is already
partial in the same way (no Feeds page at all), so this is not a regression
peculiar to Discover — it is the missing translation of `docs/feeds.md`.

Verified: `check-types`, `check-lint`, `check-format`, `check-copy`, and the
full `check-tests` suite, plus the running settings page in a browser — off
state, ticked state, and the link resolving to `https://jant.me/discover`. The
one test failure is the same pre-existing, unrelated
`src/node/__tests__/cli-site-snapshot.test.ts` case the previous Discover task
recorded, and it reproduces on a clean tree.
