# Share a post as an image

Branch: `feat/share-image`. A standalone spike page, deleted once this
was built, measured snapdom in desktop Safari, iPhone Safari and
Playwright WebKit; what it found is under Decisions and in the font
notes of `client/share-capture.ts`.

The author picks "Share as image" in a post's "More" menu and gets a
Jant-styled PNG of the post — site, text, image, QR code to its address —
to save or share (WeChat Moments is the case that drove it).

## Decisions

- Readers share too (reversed from v1, which was author-only): the post's
  "More" menu, on the timeline and the post page, holds Copy link and Share
  as image for a reader; the author's menu gains Copy link above Share as
  image. WeChat Moments, the case that drove the feature, is mostly readers
  passing a post on. No text-selection entry.
- Generated in the author's browser with snapdom; the server renders the
  card's HTML. Workers never rasterize (10 ms CPU on Free, CJK fonts too
  big to bundle, Satori can't read the theme CSS).
- Every format is covered: untitled Note, titled Note, Link, Quote, and
  any of them with images.
- Text follows the summary the timeline shows (`extractSummaryHtml`): the
  author's `moreBreak` decides the card too. Height is capped at one phone
  screen (540×1170 CSS px) as a backstop.
- 3x: 540 CSS px wide, 1620 px in the image. 2x (1080 px) was enlarged by
  about a fifth on a 3x phone held upright and read soft (a user report);
  3x adds 0–50 ms to a capture.
- Only published posts that are Public or Hidden from Latest. Drafts and
  Private posts have no address a reader can open.
- No copy-text action in v1.
- Fonts: embed only the web font families the page itself uses.
- Safari: `document.fonts` can stay "loading" forever (the spike found
  it), and snapdom awaits `fonts.ready` unbounded there. The capture waits until no
  face is loading instead (2 s at most before the capture, 1 s per
  snapdom read): a stuck set has nothing loading, so it costs nothing,
  while a face really downloading is still waited for. `local()` stays in
  the CJK font CSS (iPhone test B).
- Loading: the dialog shows the laid-out card at once, faded like a print
  developing under one slow band of light, and the PNG brings it to full
  strength. The share bundle loads when a post menu that offers the item
  opens; the card's markup is fetched alongside it. A failed lazy load is
  forgotten, so the next try loads again.

## Card: paper on a mat

Third round. Round 1 had layouts of its own that did not match the site;
round 2 drew the timeline's own card, which matched but read as a
screenshot. Owen wanted the image to be the reason people share it, so the
card is now designed as a picture (direction A of two mockups, chosen over
B, a full-bleed magazine page):

- A sheet of paper (`--site-raised-bg`, 16 px radius, soft shadow; in dark
  mode lifted and edged instead) on a mat: the theme's accent mixed into
  the page (24% light, 8% dark). The mat gives the image an edge on the
  white of WeChat Moments, and gives every theme its own frame.
- Images across the top of the paper: one at 4:3, two side by side at 4:5,
  three as one wide over two, four as two by two with "+N"; video posters
  with a play mark; a link's preview image when it has no attachments.
- The date, then the post in the site's fonts with each format's marks:
  title 30 px; body 17.5 px at 1.85 leading (1.7 for non-CJK text); link
  domain with the site's link icon and the title at 32 px; quote mark and
  quote text in the serif stack, sized by length (29 / 25 / 21 px), the
  source after a short rule, the author's comment quieter below.
- "…" when the summary stops short of the post (hidden when the capture
  already cut and faded the body).
- Files a picture cannot show — documents (PDF, ePub, …), recordings,
  attached texts, videos without a poster — listed under the text, up to
  three and "+N": a slip with the format in capitals (from the extension,
  or the MIME type), the name (an attached text's opening words, set in the
  serif), and its size, duration or character count as the site formats
  them. Without this a post whose point is a PDF lost it on the card.
- Footer: avatar, site name in the site-title font over the site's
  address (host and path prefix, left out when the name already is it),
  QR to the post on the right (74 px, 222 in the image), centred under a hairline.

Text still follows the timeline's summary rules (note limits for untitled
notes, article limits otherwise, read-more break first); the one-screen
cut (1080×2340) is the backstop and never leaves fewer than three lines.
Icons are drawn inline (`renderIconsInline()`): the capture copies the
card without the page's sprite.

## Threads

A post in a Thread shares as that post, on the Thread's rail the way the
timeline sets a Thread's newest post, with almost nothing else (direction
A of three mockups, chosen over a stack of sheets and a title-only kicker;
a first build with the first post, a "N more posts" gap and two or three
lines of context read as too busy):

- The Thread's first post in up to three lines, its title and the start
  of its words (what the Thread is about,
  and the same opening on every card from one Thread, as the timeline
  leads a Thread with its root), the posts between folded to a dotted
  stretch of rail, and the post after in one line. Context at 60% so it
  reads at a glance; the rail fades in above the root and out below the
  last line, but the words are never masked. Owen first had the post
  just before in place of the root, then asked for the root and a gap.
- The gap carries no words: the count is already in "6 / 7", and "N more
  posts" would be English on every card (public chrome is English).
- Its place in the Thread beside the date, "6 / 7", counting published
  posts only. Numbers, so no chrome string in a language the post is not.
- A context post shows its title (a titled note's or a link's; an
  untitled link's domain) set apart from its words: the heading face at
  16.5 px over 14.5 px text, 6 px between them, 25 px lines. A quote shows
  its words in the quote face behind a rule, as the site sets a
  blockquote, and its source under them ("— 山田 · example.com"), as the
  quote card does. The root gets three lines in all (title or source
  included); the post after gets one, its title if it has one. A link
  with no words is not shown by its address. A post with no words and no
  title shows its images, as the timeline does: up to three tiles (120 px,
  one alone at 160×120), the last counting the rest; the post after shows
  them at 64 px. A thumbnail the size of a line of text did not say what
  the post was.
- The shared post keeps everything a single card has; its images sit
  inside its column, after its text, so the card reads top to bottom.
- Display order (the root, then replies by time), as the post page lists
  them. The QR code opens the shared post, which the post page shows in
  its Thread.

## Readers

A signed-out reader gets the same ⋯ in each post's footer, wherever the
author's sits (`hideActions` decides both), with two items: Copy link and
Share as image. Owen weighed a ⋯ on every timeline post against keeping the
reader's timeline bare (mocked both) and chose the menu everywhere.

- Strings stay English, like the rest of the reader chrome: the public
  catalog is English-only by design (`lingui.config.ts`, mise
  `i18n-translate`), and the dialog and author menu already hardcode theirs.
- The share card and dialog styles leave `client-author.css` for a sheet of
  their own, `client-share.css`, linked by `share-launch.ts` when a menu
  that offers sharing opens. Readers need them, and they are too rarely used
  for the render-blocking `client.css`. `<html data-share-stylesheet>`
  carries its hashed path, the way `data-asset-base-path` carries the base.
- `/_/share-card/:id` answers signed-out requests; `canShareAsImage` (on the
  Thread's visibility) still refuses drafts and Private posts.
- Copy link writes the post's own permalink (the footer's `u-url`, made
  absolute), not the page's address; on a Thread page each post copies its
  own. Shown for every post that is not a draft.

- [x] Route: signed-out requests answered; tests for a reader, a draft, a
      Private post, a reply in a Private Thread.
- [x] Styles: `styles/share.css` + `style-share.css` entry, hashed name
      through the manifest define like `client-author.css`, html attribute,
      lazy link in `share-launch.ts`; audience test checks the author sheet
      holds no share rules.
- [x] Footer: reader trigger (`data-share-menu-trigger`) when the author's
      would show; `<jant-share-menu>` mounted for signed-out pages. The
      permalink rides on the article (`data-post-permalink`), since a
      titled post's page hides the footer date.
- [x] `jant-share-menu` (client.js): open/toggle, backdrop click, Escape,
      focus, Copy link, Share as image; placement, icons and copy in
      `client/post-menu-shared.ts`, which both menus use.
- [x] Author menu: Copy link above Share as image; not on drafts, shown on
      Private posts (the author can open those).
- [x] Tests: footer, reader menu, author menu, stylesheet loading, layout
      attribute.
- [x] Docs: writing-and-organizing (en, zh-Hans).
- [x] Browsers: reader and author, WebKit phone and Chromium desktop;
      production build serves `client-share.css`.
- [x] Checks and budgets.

Results: WebKit phone (reader) and Chromium desktop (reader, author) on the
seeded site: the menu lists Copy link and Share as image (the author's adds
Copy link above Share as image), Copy link writes
`http://localhost:19020/shape-thread-2` (read back from the clipboard in
Chromium) and toasts "Link copied.", focus returns to the ⋯, the dialog
opens styled by the linked `/src/style-share.css`, Escape closes menu and
dialog; no console errors. `pnpm build`: `client-share-BNqD2izX.css`
(3.4 KB gz) emitted and named in the server bundle; client.js 37.9 → 40.3
KB gz of 48, client-auth 62.1 → 63.4 of 72, client.css unchanged at 48.0.
check-tests 5402 passed, check-lint clean. Not verified: WeChat's in-app
browser (the dialog's image is a `blob:` URL; whether its long-press save
takes one needs a real phone).

## Plan

- [x] `lib/share-card.ts`: `assembleShareCard` loads the post, its media
      and alias; `buildShareCardView` picks the layout per format, cuts the
      summary (`extractSummaryHtml`, note or article limits), picks images,
      builds the absolute permalink, site address and QR SVG (`uqr`).
- [x] `ui/share/ShareCard.tsx`: one component for the four layouts; the
      quote card moves the site to the footer. Quote mark drawn inline (a
      sprite `<use>` would come out empty in the capture).
- [x] Route `GET /_/share-card/:postId` in `routes/pages/partials.tsx`:
      signed-in only; 404 for drafts, Private, missing.
- [x] Styles in `styles/ui-author.css` (author-only sheet). Type in px on
      the card, because the reading scale shrinks on narrow screens; colors
      and families from theme tokens. `share` added to the author-only
      families in `stylesheet-audience.test.ts`.
- [x] Post menu: "Share as image", its own section above Delete, for
      published non-Private posts.
- [x] Lazy entry `client-share.ts` (`ensureShare`, `share-launch.ts`);
      snapdom in `LAZY_ONLY_PACKAGES`; budget 118 KB (measured 103 KB).
      `client-auth` 61.8 KB (budget 72).
- [x] Dialog `jant-share-dialog`: BaseCoat dialog layout, loading, error
      with Try again, the PNG as `<img>`, Download, Share… (when the share
      sheet takes files), Copy image (when the clipboard takes images),
      touch-only hint to press and hold, Escape / backdrop / Close, focus
      on the panel, focus back to the menu trigger.
- [x] `client/share-capture.ts`: off-screen host, fonts (capped 2 s) and
      images, the one-screen cut with fade, embed only families the page
      uses, `fonts.ready` capped at 1 s during snapdom, 30 s overall limit.
- [x] Tests: `share-card-partial.test.ts` (access, four layouts, note and
      article limits, read-more break, four images + count, same-origin
      URLs, QR and address); post menu (offered and handed over; not for
      Private or drafts).
- [x] Second round: site card in a frame, footer redesign, inline icons.
- [x] Listed attachments (documents, recordings, texts, posterless video);
      route tests 17; checked with a PDF + ePub post, a recording, an
      attached text, and a photo + PDF post.
- [x] Third round: paper-on-mat design from mockups; route tests (15) for
      its markup — layouts, summary rules, quote sizes, four images and a
      count, video posters, same-origin URLs, QR and address.
- [x] Verify: `mise run check-tests` (typecheck, lint, 5353 tests pass),
      `mise run check-copy`, Prettier; real browser runs below.
- [x] Fourth round: 3x; wait for idle fonts, not `fonts.ready`;
      `prepareShareCard` lays out, `capture()` paints; dialog shows the
      card developing, then the PNG; warm-up on menu open, card fetched
      with the bundle; `once()` forgets failures. Tests: warm-up on open
      (not for drafts or Private), failed lazy load retried.
- [x] Threads: window in `lib/share-card.ts` (`thread` on the view, from
      `getThread`), markup in `ShareCard.tsx`, rail and fades in
      `ui-author.css`, route tests (first, middle, last, gap count,
      context formats, drafts left out), browser check.
- [x] Review before commit: a context post with only a file showed a bare
      dot (now its first file, "PDF · Annual report", with a test); stale
      comments on the bundle budget and the context builder. Changeset
      (minor) and a "Share a post as an image" section in
      `docs/writing-and-organizing.md` and its zh-Hans copy.
- [x] Commit on `feat/share-image`; PR into `preview`.
- [x] From Owen's site: a post whose body is one long list showed only its
      title. The cut stepped over top-level blocks only and cut to 0 when
      the first was not a paragraph (a list, a quotation, code). It now
      cuts between the paragraphs inside lists and quotations, and shows
      the start of a block taller than the screen. snapdom fixes each
      item's height, so list spacing that collapsed out through an item's
      edge was lost in the picture; it now stays inside the items. Tests in
      `share-capture.test.ts`; captures in both engines.
- [x] From Owen's iPhone: "Copy image" left a white block top left. The
      toast container moves into the open dialog, where BaseCoat's
      `.dialog > *` panel rule gave it full width and a -50% translate, so
      the "Image copied." toast sat mostly off screen. `components.css`
      undoes that rule for `.dialog > .toast-container`; it applied to
      every BaseCoat dialog. Checked in WebKit and Chromium, mobile and
      desktop.
- [x] A lone image was framed 4:3 and cropped, which cut the sides off
      a wide screenshot. It now keeps its own shape at full width, cut
      from the bottom only past 4:5 tall; wide images are never cut. The
      card carries the stored width and height so the layout is known
      before the image loads; images without one take the loaded size.
      Two or more keep the grid. Route test; captures of chat screenshot,
      phone-height, 3:4, 4:3, square and a Thread reply in both engines.
- [x] The corner close was out of a thumb's reach on a phone. At 640px and
      below the dialog closes from a Close button at the bottom left, the
      actions two to a row with Download bottom right, an odd one out
      across the row; wider screens keep the corner close. Every action
      has a Lucide icon (share, copy, download, x). Component test for the
      bottom Close and Escape; screenshots of WebKit and Chromium phones,
      dark mode, desktop.
- [x] A long slug wrapped the footer's address onto two or three lines.
      The footer names the site's address instead (host and path
      prefix), once when the site's name already is it; the QR code
      still points at the post. Route tests for the address, a path
      prefix, and a name that is the domain.
- [x] Pictures made on an iPhone came out soft (a reader's report), text
      and images alike. snapdom draws a capture holding any box-shadow or
      text-shadow at 1x in Safari and stretches it to the scale asked for,
      and the paper's shadow and the Thread dots' halos were box-shadows.
      The capture now turns shadows off (`.share-card-host[data-capturing]`)
      and paints the paper's shadow back on the canvas
      (`paintPaperShadow`, read from the paper's computed style, so dark
      mode paints none); the rail breaks around each dot instead of running
      under a halo, and the current dot's ring is a border. SSIM of the
      card's copy against the source scaled to size, WebKit: one image
      0.960 → 0.981, two 0.950 → 0.964, level with Chromium (0.982, 0.963).
      Chromium card before/after 0.9994.
- [ ] Owen tries it on his own site/devices.

## Results

Dev site (`mise run dev-debug`), posts seeded through the API: untitled
note with a photo, titled article with two photos, link, quote, note with
five photos, long untitled note, Private note, English article.

Third round (paper on a mat), WebKit phone viewport / Chromium desktop:

| Post                        | Card         | WebKit | Chromium |
| --------------------------- | ------------ | ------ | -------- |
| note + photo                | 1080×1456    | 206 ms | 205 ms   |
| article + 2 photos          | 1080×2320    | 233 ms | 211 ms   |
| link                        | 1080×882     | 126 ms | 104 ms   |
| quote                       | 1080×1074    | 127 ms | 110 ms   |
| note + 5 photos (2×2, "+1") | 1080×1572    | 208 ms | 206 ms   |
| long note (cut, fade)       | 1080×2154    | 127 ms | 113 ms   |
| English article             | 1080×1108    | 125 ms | 107 ms   |
| Private note                | no menu item | —      | —        |

Checked in Paper, Clay, Sage, Ember and Ink, light and dark.

Times are from the click to the image, fetch included. Download saves
`{slug}.png`; Escape closes and returns focus to the menu trigger. Dark
mode renders a dark card with the QR on its white block.

Fourth round, zh-Hans site, 3x, from the click (menu open 300 ms first):

| Post               | Image     | WebKit card / image    | Chromium card / image |
| ------------------ | --------- | ---------------------- | --------------------- |
| quote with emoji   | 1620×1452 | 90 / 299 ms (was 4864) | 73 / 139 ms           |
| note + photo       | 1620×2208 | 93 / 255 ms            | 65 / 179 ms           |
| article + 2 photos | 1620×3186 | 86 / 280 ms            | 64 / 235 ms           |
| quote              | 1620×1617 | 89 / 173 ms            | 65 / 120 ms           |
| link               | 1620×1338 | 81 / 178 ms            | —                     |
| long note (cut)    | 1620×3423 | 87 / 223 ms            | —                     |
| files              | 1620×1611 | 94 / 197 ms            | —                     |

The same posts at 2x took 204–294 ms in WebKit. Chromium at 4x CPU
throttling (a mid-range phone): card 285 ms, image 599 ms. Dark mode
checked in WebKit.

Threads, root-and-gap design (WebKit phone viewport, zh-Hans site; seeded
a seven-post Thread with every format, a two-post Thread and an English
three-post Thread): middle post with photos 1620×2556 in 331–339 ms,
second 1620×2316, quote 1620×1836, last 1620×1272; Chromium 236 ms.
Light and dark checked; the card's rail is a step stronger than the
timeline's threadline, which all but vanished on dark paper.

Not verified: a real iPhone or Android phone (`/__dev/login` only answers
on local hostnames, so a phone has to sign in with the demo account at the
LAN address); WeChat in-app browser.

## Open

- `local()` in the CJK font CSS: settled — keep it. iPhone test B
  (`local()` removed, `fonts.ready` uncapped) still hung snapdom past 20 s,
  though the page's own `fonts.ready` settled at once: on iOS the set gets
  stuck during snapdom's own font warm-up. Removing `local()` fixes the Mac
  case only, so the capture keeps capping `fonts.ready` (1 s per read,
  about 2 s per capture on iPhone in test A) and the font CSS stays as is.
- Worth reporting upstream: snapdom awaits `document.fonts.ready` without
  a timeout on Safari.
- A link card with a preview image (`previewImageKey`) is not exercised:
  the seeded link had none, and the route tests create none.
