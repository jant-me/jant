# Feed Contract

This document defines what a Jant Atom entry carries and who each field is for.

A consumer-facing handout — what arrives and how to read it, without the
reasoning — is in [Reading a Jant feed](../feed-reading.md).

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
the star rating, and a thread folded the way the timeline folds it. It does not hold media, a link post's preview image, or the `★`
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
| `jant`  | `https://jant.me/ns`            | always on the served feed; see below            |
| `media` | `http://search.yahoo.com/mrss/` | some entry has an attachment or a preview image |

Declare a namespace only where something in it is emitted. On the served feed
that leaves `jant` always declared, because every feed carries
`<jant:discover>` — `none` included. Only the exported feed, which has no
Discover declaration, can omit it, and does so when it has no entries.

## Feed Elements

| Element                             | Notes                                                                                                                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`                             | Composed — `<site> - Latest posts` — so a reader's sidebar sorts one site's feeds together                                                                                                                                                                                           |
| `author/name`                       | The site's own name. A directory reads the blog's name from here, not from `title`                                                                                                                                                                                                   |
| `subtitle`                          | Site description; may be empty                                                                                                                                                                                                                                                       |
| `icon`                              | Site avatar, absolutized against the site URL                                                                                                                                                                                                                                        |
| `link[@rel="alternate"]`            | The site's home page                                                                                                                                                                                                                                                                 |
| `link[@rel="self"]`                 | This feed                                                                                                                                                                                                                                                                            |
| `link[@rel="alternate"][@hreflang]` | Sibling-language feeds; carries `type` because Atom forbids two alternates sharing a type/hreflang pair                                                                                                                                                                              |
| `updated`                           | The newest entry's timestamp, never the render time — stamping "now" tells every reader the feed changed on every poll                                                                                                                                                               |
| `@xml:lang`                         | The feed's content language                                                                                                                                                                                                                                                          |
| `jant:discover`                     | The site's Discover answer. `latest` or `featured` carries the feed to poll and the `status` endpoint to ask about posts; `none` — opted out, or never opted in — carries neither. Always present, so a site that said no is tellable from one running a Jant that predates Discover |

## Entry Elements

| Element                  | Count | Notes                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | 1     | **Always the post's permalink.** It moves when a slug is renamed or the site changes domain; `jant:id` does not. It stays the permalink anyway, because changing it would make every subscriber's reader show the feed again. For the same reason an exported feed keeps the permalink Jant served, not the Hugo page's URL; see Known Limits. |
| `jant:id`                | 1     | The root post's TypeID (`pst_…`), which never changes. A consumer that has to recognise the same post across a slug rename or a new domain keys on this, and it is what the Discover status endpoint takes. Served feed only: an exported site no longer has Jant's IDs to answer for.                                                         |
| `title`                  | 1     | **Empty**, not absent, for untitled notes and every quote. A quote's attribution is not its title.                                                                                                                                                                                                                                             |
| `link[@rel="alternate"]` | 1     | The external URL on a link post. The permalink otherwise.                                                                                                                                                                                                                                                                                      |
| `link[@rel="related"]`   | 0–1   | Link posts only: the permalink.                                                                                                                                                                                                                                                                                                                |
| `link[@rel="enclosure"]` | 0–n   | Non-image attachments. See below.                                                                                                                                                                                                                                                                                                              |
| `published` / `updated`  | 1     | A curated feed may date an entry by the curation, hence `feedPublishedAt` / `feedUpdatedAt`.                                                                                                                                                                                                                                                   |
| `jant:format`            | 1     | `note`, `link`, or `quote`, for the entry — which is the root. A reply's own format is on its `<jant:post>` row. Atom has no field for it, and `<category>` would show `quote` as a tag no author typed.                                                                                                                                       |
| `jant:truncated`         | 0–1   | Empty element. Present when the summary cut any post it renders — the root, or a reply the fold shows; a row's `truncated` says which. Never on a Quote.                                                                                                                                                                                       |
| `jant:thread`            | 0–1   | The entry is a whole thread, and this is its shape, with a `<jant:post>` row per post. Absent means a lone post. See below.                                                                                                                                                                                                                    |
| `category`               | 0–n   | One per collection. `@term` is the slug, `@label` the title, `@jant:page` the absolute URL — a single collection lives in the root URL namespace, so a site path prefix makes it unguessable from the term. Replies inherit their root's collections and the site prints them on the root alone, so they ride the entry once.                  |
| `media:thumbnail`        | 0–1   | **Direct child of the entry**: a link post's preview image, for card and grid views. A scraped thumbnail of someone else's page is not a published file, so it gets no enclosure.                                                                                                                                                              |
| `media:content`          | 0–n   | One per attachment, root and replies together. See below.                                                                                                                                                                                                                                                                                      |
| `summary`                | 0–1   | See above.                                                                                                                                                                                                                                                                                                                                     |
| `content`                | 1     | Never empty: a post with only a title or a URL falls back to its plain-text projection.                                                                                                                                                                                                                                                        |

## Threads

A thread is one entry. Both text constructs therefore run several posts
together — `<content>` the whole chain, `<summary>` the folded card — and three
things let a consumer take that apart.

The fold is the site's, not the feed's: the first two replies as context, the
last three with the newest as the hero, and the run between them collapsed into
a gap link. Up to six posts, so a thread that fits arrives whole and hides
nothing. `lib/thread-fold.ts` owns the rule — the site selects its posts in SQL
because a page of timeline items must not load whole threads, the feed slices
the chain it already holds for `<content>`, and both read their thresholds and
their hidden count from that one module.

The gap link opens **the first post it hides**, on both surfaces. The site used
to open the last visible post instead, so that the detail page began just above
the missing stretch — a deliberate choice, but one that makes the link mean
something other than its label, and one `gap` could not follow without handing a
consumer a post that is on screen.

**`<jant:thread>`** declares it, for a consumer that never parses the HTML.

| Attribute | Notes                                                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `posts`   | Total posts in the thread, root included                                                                                                                                      |
| `hidden`  | How many the summary folds away. Stated, not derived: the fold is the site's decision, and `posts - 2` only holds while that decision is "keep the root and the newest reply" |
| `gap`     | The first post the fold hides. Only when `hidden` is above zero                                                                                                               |
| `latest`  | The newest reply — the post the summary shows in full, and the one whose `media:content` belongs beside it                                                                    |

```xml
<jant:thread posts="4" hidden="2" gap="https://ex.com/r1" latest="https://ex.com/r3">
  <jant:post href="https://ex.com/dialing-in" format="note" published="2026-03-14T09:00:00.000Z"/>
  <jant:post href="https://ex.com/r1" format="link" published="2026-03-15T09:00:00.000Z"
             title="The AeroPress guide" url="https://other.example/aeropress"
             thumbnail="https://ex.com/m/prev.jpg"/>
  <jant:post href="https://ex.com/r2" format="quote" published="2026-03-16T09:00:00.000Z"/>
  <jant:post href="https://ex.com/r3" format="note" published="2026-03-17T09:00:00.000Z"
             title="Got it" truncated="true"/>
</jant:thread>
```

| Attribute   | Count | Notes                                                                                                |
| ----------- | ----- | ---------------------------------------------------------------------------------------------------- |
| `href`      | 1     | The post's permalink. What `gap`, `latest` and `media:content/@jant:post` name                       |
| `format`    | 1     | `note`, `link`, or `quote`, for this post                                                            |
| `published` | 1     | This post's own timestamp                                                                            |
| `title`     | 0–1   | Absent when the post has none, and on every Quote — the entry's rule for `<title>`, applied per post |
| `url`       | 0–1   | Link posts only: where it points. The row's `link[@rel="alternate"]`                                 |
| `thumbnail` | 0–1   | Link posts only: the preview image. The row's `media:thumbnail`                                      |
| `folded`    | 0–1   | `"true"` when the fold hid this post. Absence means the summary renders it                           |
| `truncated` | 0–1   | `"true"` when the summary cut this post's block                                                      |

**`folded` is stated, not inferred.** A consumer cannot read it off the
summary: `<summary>` is text, and a post with none — a photo with no caption,
which is an ordinary Jant post — contributes no block and no tail meta, leaving
it indistinguishable from a post the fold hid. Believing that would drop its
attachments and lose the post. The count of `folded="true"` rows equals
`@hidden`, which makes that attribute and `@gap` a cross-check rather than the
only answer.

**What belongs on a row:** what Atom itself would put on this post's entry —
its links, its title, its date — plus what Jant adds at entry level, `format`
and `truncated`. Never the body, a summary, or an excerpt. `<content>` stays
the only place the posts' words appear, and this stays a table of contents.

The rule exists because every entry-level field describes the **root**.
`<jant:format>` says `note` for a thread whose newest reply is a Quote;
`<title>` and `link[@rel="alternate"]` say nothing about a titled reply or a
Link reply. In `<content>` those show up as an `<h2>` and a `<blockquote>` —
renderings, not declarations a consumer laying the thread out itself can read.

The root gets a full row like every reply, repeating what the entry already
says about it. A consumer walking the rows should not have to know that one of
them is described somewhere else instead.

`gap` and `latest` point into this list, and `media:content`'s `jant:post`
resolves against it: the attribute references, the row declares.

**`truncated` sits at both levels, and they answer different questions.**
`<jant:truncated/>` on the entry says the summary cut something, which is what
a reader drawing one card per entry needs — and it is the only place a lone
post can say it, having no rows. A row's `truncated` says which post. Any post
the fold renders can carry it; a post behind the gap cannot, having no block to
cut. **Its absence therefore means "not cut here", never "this post arrived
whole."**

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

### A reply's header

Only a reply carries its title and, on a Link post, its source line inside the
text — the root's live in the entry's `<title>` and `link[@rel="alternate"]`.
That chrome is wrapped in `<header>`:

```xml
<header><p><a href="https://other.example/x">other.example</a></p>
<h2><a href="https://other.example/x">The AeroPress guide</a></h2></header>
```

A reader renders it and needs to know nothing more. A consumer drawing its own
card drops the `<header>` and redraws from the row, which carries `title`,
`url` and `thumbnail` — the last of which the text has no way to show. Matching
the shape instead would be guesswork: a body's own first paragraph can be a
link. The rule comes out uniform, since a root block has no `<header>` to drop.

## Attachments

Three surfaces, three audiences. None of them repeats another's job.

**`<content>`** presents them. Each post's attachments sit in one
`<div data-post-media>` beside that post's own text — the same attribute the
site puts on its gallery strip, so themes and external scripts read one
contract. It is the only surface that puts an attachment in the running order
of a thread's text.

**`<media:content>`** describes them: `type`, `medium`, `fileSize`, `width`,
`height`, `duration`, `media:title` (filename), `media:description`, and a
nested `media:thumbnail` wherever the file has a still that is not the file
itself: a video's poster, or a picture's resized rendering on a deployment
with image transforms. Atom's `<link>` has nowhere to put any of it.

- `@jant:post` is the post carrying the file. **In a thread every attachment
  carries it, the root's included**, and it lines the file up with both the
  tail-meta segment and the `<jant:post>` row naming the same permalink.
  `jant:page` below earns its omission because guessing wrong there lands you on
  the file instead of its page; guessing wrong here hangs a photo under the
  wrong post, so nothing is left to a rule about what a missing attribute means.
  A lone post's entry has one post and carries the attribute nowhere — it would
  only repeat `<id>` on every file.
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
- **A folded post's attachments are here too.** An entry's media is the whole
  thread's, and `<content>` shows every post, so a file belonging to a post the
  summary hid behind the gap link still arrives, carrying its `jant:post`. A
  consumer drawing only the summary can tell which those are — its
  `jant:post` matches a `<jant:post>` row that is neither the root nor
  `latest` — and whether to draw them is its own call.
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
from `media:content` where `jant:post` matches. Attachments left
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
  feed's summary is not the timeline's text.
- **An exported thread has no `<jant:thread>`.** The template emits no rows,
  so `posts`, `hidden`, `gap`, `latest` and a reply's `format`, `title`, `url`
  and `truncated` are not there to read; a consumer has only the tail meta
  inside `<content>` to take a thread apart.
- **An exported `<media:content>` carries no `jant:post`.** Attachments from
  every post in the thread arrive, but nothing says which post each hangs
  off.
- **An exported feed has no `<jant:discover>`.** A static site has no setting
  to declare, so a directory reads the absence as "predates Discover", and
  `xmlns:jant` is declared only when the feed has entries.
- **An exported `<id>` is the address Jant served, not the page's.** Hugo puts
  a Thread at `/{slug}/`, with a trailing slash Jant's permalink lacks and the
  slug where Jant served a custom path. A reader knows an entry by `<id>`
  alone, so the export writes the served permalink into the root's `feed_id`
  front matter, and `rss.xml` emits that; `<link>` points at the Hugo page. The
  address still resolves, through the host's slash redirect or the alias page
  the export writes for a custom path, so `permalink = entry/id` under
  Rendering A Timeline costs a redirect there. The ID is fixed at export: it
  does not follow a later `baseURL` change, which RFC 4287 asks of an ID whose
  feed moves. A post written in Hugo afterwards has no `feed_id` and takes its
  page URL.
- **An exported entry has no `<jant:id>`.** The ID names a post to the site
  that holds it — it is what the Discover status endpoint takes — and a static
  site has no such endpoint to answer for it.
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
