# Feed Contract

This document defines what a Jant Atom entry carries and who each field is for.

A consumer-facing handout — what arrives and how to read it, without the
reasoning — is in [Reading a Jant feed](feed-reading.md).

The implementation lives in:

- `packages/core/src/lib/feed.ts` — the renderer
- `packages/core/src/routes/feed/feed.ts` — the routes and the data they load

An exported theme writes its own feed from Hugo templates under
`packages/core/src/services/export-theme/layouts/`, and that one is a reduced
form of this contract, not a copy of it. What it lacks is listed under Known
Limits. Read a claim here as describing the served feed; check the templates
before assuming an exported site says the same thing.

## Two Renderings

The site renders every post twice: cut down in the timeline, whole on its own
page. The entry carries both.

- `<summary type="html">` is the post's **text**, as the timeline renders it.
- `<content type="html">` is the **whole post page**.

`<summary>` holds the timeline's body, a quote post's quotation and attribution,
the star rating, and a thread folded to its root plus a gap link and its newest
reply. It does not hold media, a link post's preview image, or the `★`
permalink — those are the post's content, not a summary of it.

Inside a thread both constructs close each post's block with that post's own
dated permalink, so several posts in one field can still be told apart. See
Threads.

It is present whenever the entry has any text, including when that text is the
whole post and repeats `<content>` verbatim. That costs the words and buys a
field with a meaning of its own rather than one a consumer has to derive from a
comparison it cannot see. **Missing therefore says one thing: this post has no
text.** A photo with no caption is the normal case.

Because the summary is always present, it says nothing about truncation.
`<jant:truncated/>` does.

**A Quote is never cut**, on either half. Its quoted text never was, and its
commentary is not either: `QuoteCard` passes `bodyHtml` straight through and
nothing clamps `.feed-quote-commentary`, so the site shows the whole thing
however long it runs. Cutting it here would make `<summary>` a shorter
rendering of the feed's own rather than the timeline's. The exception runs the
other way for an untitled note, whose body _is_ cut here even though the site
renders it whole — there the site hides the tail with CSS the reader strips.

## Namespaces

| Prefix  | URI                             | Declared when                                   |
| ------- | ------------------------------- | ----------------------------------------------- |
| —       | `http://www.w3.org/2005/Atom`   | always                                          |
| `jant`  | `https://jant.me/ns`            | the feed has entries, or answers Discover       |
| `media` | `http://search.yahoo.com/mrss/` | some entry has an attachment or a preview image |

Declare a namespace only where something in it is emitted.

## Feed Elements

| Element                             | Notes                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `title`                             | Composed — `<site> - Latest posts` — so a reader's sidebar sorts one site's feeds together                             |
| `author/name`                       | The site's own name. A directory reads the blog's name from here, not from `title`                                     |
| `subtitle`                          | Site description; may be empty                                                                                         |
| `icon`                              | Site avatar, absolutized against the site URL                                                                          |
| `link[@rel="alternate"]`            | The site's home page                                                                                                   |
| `link[@rel="self"]`                 | This feed                                                                                                              |
| `link[@rel="alternate"][@hreflang]` | Sibling-language feeds; carries `type` because Atom forbids two alternates sharing a type/hreflang pair                |
| `updated`                           | The newest entry's timestamp, never the render time — stamping "now" tells every reader the feed changed on every poll |
| `@xml:lang`                         | The feed's content language                                                                                            |
| `jant:discover`                     | The site's Discover answer, `latest` or `featured`, with the feed to poll                                              |

## Entry Elements

| Element                  | Count | Notes                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | 1     | **Always the post's permalink.**                                                                                                                                                                                                                                                                                              |
| `title`                  | 1     | **Empty**, not absent, for untitled notes and every quote. A quote's attribution is not its title.                                                                                                                                                                                                                            |
| `link[@rel="alternate"]` | 1     | The external URL on a link post. The permalink otherwise.                                                                                                                                                                                                                                                                     |
| `link[@rel="related"]`   | 0–1   | Link posts only: the permalink.                                                                                                                                                                                                                                                                                               |
| `link[@rel="enclosure"]` | 0–n   | Non-image attachments. See below.                                                                                                                                                                                                                                                                                             |
| `published` / `updated`  | 1     | A curated feed may date an entry by the curation, hence `feedPublishedAt` / `feedUpdatedAt`.                                                                                                                                                                                                                                  |
| `jant:format`            | 1     | `note`, `link`, or `quote`. Atom has no field for it, and `<category>` would show `quote` as a tag no author typed.                                                                                                                                                                                                           |
| `jant:truncated`         | 0–1   | Empty element. Present when the timeline cut the root's text or the newest reply's. Never on a Quote.                                                                                                                                                                                                                         |
| `jant:thread`            | 0–1   | The entry is a whole thread, and this is its shape. Absent means a lone post. See below.                                                                                                                                                                                                                                      |
| `category`               | 0–n   | One per collection. `@term` is the slug, `@label` the title, `@jant:page` the absolute URL — a single collection lives in the root URL namespace, so a site path prefix makes it unguessable from the term. Replies inherit their root's collections and the site prints them on the root alone, so they ride the entry once. |
| `media:thumbnail`        | 0–1   | **Direct child of the entry**: a link post's preview image, for card and grid views. A scraped thumbnail of someone else's page is not a published file, so it gets no enclosure.                                                                                                                                             |
| `media:content`          | 0–n   | One per attachment, root and replies together. See below.                                                                                                                                                                                                                                                                     |
| `summary`                | 0–1   | See above.                                                                                                                                                                                                                                                                                                                    |
| `content`                | 1     | Never empty: a post with only a title or a URL falls back to its plain-text projection.                                                                                                                                                                                                                                       |

## Threads

A thread is one entry. Both text constructs therefore run several posts
together — `<content>` the whole chain, `<summary>` the folded card — and three
things let a consumer take that apart.

**`<jant:thread>`** declares it, for a consumer that never parses the HTML.

| Attribute | Notes                                                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `posts`   | Total posts in the thread, root included                                                                                                                                      |
| `hidden`  | How many the summary folds away. Stated, not derived: the fold is the site's decision, and `posts - 2` only holds while that decision is "keep the root and the newest reply" |
| `gap`     | Where the folded middle starts. Only when `hidden` is above zero                                                                                                              |
| `latest`  | The newest reply — the post the summary shows in full, and the one whose `media:content` belongs beside it                                                                    |

**The tail meta** marks the joints, in both text constructs:

```xml
<p><small><a href="{permalink}" class="u-url"><time class="dt-published"
   datetime="{ISO}">Mar 19, 2026</time></a></small></p>
```

Every rendered post's block ends with one, **the root's included** — without
that the root and the first reply share a segment. So the rule is one line:
**every marker ends the block before it**, and names the post that wrote it. A
post that contributed no block contributes no marker: a photo with no caption
has no text in the summary, so nothing there is attributed to it.

This is the site's own markup. `PostFooter`'s `PostPublishedLink` puts the
timestamp after the post, links it, and carries microformats2 `u-url` and
`dt-published` inside its `h-entry` — so an mf2 parser gets the segmentation
free, and a reader that strips `class` still has an unambiguous shape: a
`<time datetime>` wrapped in an `<a>` is not something a post body produces.

A **lone post gets no marker at all.** The entry's `<published>` already dates
it and every reader prints that itself.

`<hr/>` is still drawn between posts, but it is decoration now, not structure —
it also separates a quote from its commentary, and an author can type one.
Nothing should parse it.

**`media:content/@jant:post`** names the post each file hangs off, so the text
segments and the attachments join on permalinks. See below.

## Attachments

Three surfaces, three audiences. None of them repeats another's job.

**`<content>`** presents them. Each post's attachments sit in one
`<div data-post-media>` beside that post's own text — the same attribute the
site puts on its gallery strip, so themes and external scripts read one
contract. It is the only surface that puts an attachment in the running order
of a thread's text.

**`<media:content>`** describes them: `type`, `medium`, `fileSize`, `width`,
`height`, `duration`, `media:title` (filename), `media:description`, and a
nested `media:thumbnail` for a video's poster. Atom's `<link>` has nowhere to
put any of it.

- `@jant:post` is the post carrying the file, emitted only where that is not
  the entry itself. A consumer reads `jant:post ?? entry/id`, and a single-post
  entry pays nothing. This is what lines an attachment up with the tail-meta
  segment naming the same permalink.
- `@url` is the file. `@jant:page` is where a click should land, and is emitted
  only where the two differ — today that means text attachments, whose markdown
  a browser downloads or dumps unstyled. A consumer reads `jant:page ?? url` and
  needs no rule per file kind.
- `media:description` carries a picture's alt text, or a text attachment's
  excerpt. One slot, because both answer "what is this file", and a text
  attachment never has the other.

**`<link rel="enclosure">`** is what a plain Atom parser reads, and the only
mechanism a podcast or offline client understands. **Images are excluded**: the
content already shows them full size inside a link to the original, so an
enclosure would only ask an attachment shelf to list the picture again under the
post. Audio, video and documents keep theirs — the content has only a link, and
that is the case the element exists for. Every podcast feed works this way.

### Media Rules

- Every `<media:content>` file is also presented in `<content>`. There is no
  attachment reachable from one and not the other.
- Do not match the two by URL. A text attachment's content link points at its
  rendered page, not at the file.
- `medium` is Media RSS's fixed vocabulary, so anything that is not a picture or
  playable is `document`.
- Video inlines a player: `<video controls preload="none">`, poster as an
  attribute, and the link in the `<figcaption>` outside the element so it
  survives a sanitizer that drops the player with its children. `preload="none"`
  is load-bearing — a reader painting a timeline must not pull the whole file.
- A poster is only written when it is a real still. The media pipeline leaves
  `thumbnailUrl` pointing at the file itself for anything that is not an image,
  so a clip with no poster key would otherwise poster itself with its own MP4.

## HTML Inside An Entry

Both text constructs are CDATA, and both go through the same treatment:

- Every navigational and media URL is absolutized. Readers do not consistently
  resolve root-relative URLs, and fragment-only links stay local so footnotes
  keep working.
- Embeds are replaced by their fallback link, raw HTML blocks are dropped, and
  stray `iframe`, `script` and `style` are removed. Atom readers reject
  `<iframe>` outright.
- Plain text the author typed keeps its breaks structurally — a blank line
  starts a `<p>`, a single newline becomes `<br/>`. The site holds those with
  `white-space: pre-line`, and feed readers strip CSS.
- A quote's quotation and source are one `<figure>`/`<figcaption>`, and an
  `<hr/>` separates them from the commentary. The site draws that separator with
  `.feed-quote-commentary::before`, which does not survive either.

The last two are the general rule: **anything the site expresses in CSS has to
become an element here, or it does not arrive.**

## Rendering A Timeline From The Feed

A consumer drawing its own list needs two fields.

```
permalink = entry/id
title     = entry/title            // no heading when empty
text      = entry/summary ?? ""    // HTML; render it, do not strip it
media     = entry/media:content[]  // in document order
tags      = entry/category[]
readMore  = entry/jant:truncated exists
thread    = entry/jant:thread      // absent on a lone post
```

`<content>` is not needed. The quotation, the rating and the folded thread are
already inside `text`.

A thread costs one more step, and only if the consumer draws the root and the
reply as separate cards. Split `text` on the tail meta — each marker ends the
block before it and carries that post's permalink — and take each block's files
from `media:content` where `jant:post ?? entry/id` matches. Attachments left
over belong to the posts the fold hid, and whether to show them is the
consumer's call. `jant:thread/@hidden` is the gap count as a number, so the gap
line can be written in the reader's own language rather than the feed's.

Layout is the consumer's, not the feed's: no feed format can express the site's
justified strip. The dimensions to compute it are on `media:content` — width is
`rowHeight * aspectRatio` for pictures and clips, a 3:4 card for everything
else, and only pictures and clips influence the row height. A text file beside a
photo is no reason to resize the photo.

## Known Limits

- **A text attachment's character count is not exposed.** Media RSS has no slot
  and `fileSize` is bytes. The card's excerpt is in `media:description`; the
  count is a meta line the feed leaves out.
- **The exported theme's `<summary>` is plain text.** It carries
  `type="text"` holding the flattened projection an older design used, not this
  contract's HTML, because the truncation boundary needs `extractSummaryHtml`
  and Hugo would cut somewhere else. The `<jant:truncated/>` beside it is
  accurate — the exporter computes it and writes `truncated` into front matter —
  but the recipe under Rendering A Timeline does not transfer: an exported
  feed's summary is not the timeline's text. Everything else on an entry is
  there, attachments included.
- **A link post's preview image is not exported at all.** No front-matter field
  carries it, so an exported feed has neither the entry-level
  `<media:thumbnail>` nor the preview figure in its content. Adding it means
  touching the exporter's media pipeline, which handles `previewImageKey` on a
  different path from attachments.
- **A thread's text and its attachments interleave only in `<content>`.** The
  tail meta and `@jant:post` say which post owns which words and which files,
  but `<summary>` is text alone, so a consumer placing a gallery _between_ two
  posts' paragraphs decides that position itself — or reads `<content>`, where
  each `data-post-media` already sits in the running order.
- **Feed strings are hardcoded English** — `▶ Watch video`, `📎`,
  `3 more posts`. The feed is a user-facing surface and this contradicts the
  i18n rule in AGENTS.md. Fixing it means threading an `i18n` instance into the
  renderer.
