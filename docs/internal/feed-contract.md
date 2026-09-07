# Feed Contract

This document defines what a Jant Atom entry carries and who each field is for.

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

`<summary>` holds the truncated body, a quote post's quotation and attribution,
the star rating, and a thread folded to its root plus a gap link and its newest
reply. It does not hold media, a link post's preview image, or the `★`
permalink — those are the post's content, not a summary of it.

It is present whenever the entry has any text, including when that text is the
whole post and repeats `<content>` verbatim. That costs the words and buys a
field with a meaning of its own rather than one a consumer has to derive from a
comparison it cannot see. **Missing therefore says one thing: this post has no
text.** A photo with no caption is the normal case.

Because the summary is always present, it says nothing about truncation.
`<jant:truncated/>` does.

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
| `jant:truncated`         | 0–1   | Empty element. Present when the timeline cut the root's text or the newest reply's.                                                                                                                                                                                                                                           |
| `category`               | 0–n   | One per collection. `@term` is the slug, `@label` the title, `@jant:page` the absolute URL — a single collection lives in the root URL namespace, so a site path prefix makes it unguessable from the term. Replies inherit their root's collections and the site prints them on the root alone, so they ride the entry once. |
| `media:thumbnail`        | 0–1   | **Direct child of the entry**: a link post's preview image, for card and grid views. A scraped thumbnail of someone else's page is not a published file, so it gets no enclosure.                                                                                                                                             |
| `media:content`          | 0–n   | One per attachment, root and replies together. See below.                                                                                                                                                                                                                                                                     |
| `summary`                | 0–1   | See above.                                                                                                                                                                                                                                                                                                                    |
| `content`                | 1     | Never empty: a post with only a title or a URL falls back to its plain-text projection.                                                                                                                                                                                                                                       |

## Attachments

Three surfaces, three audiences. None of them repeats another's job.

**`<content>`** presents them. Each post's attachments sit in one
`<div data-post-media>` beside that post's own text — the same attribute the
site puts on its gallery strip, so themes and external scripts read one
contract. In a thread this is the only surface that says which post an
attachment belongs to.

**`<media:content>`** describes them: `type`, `medium`, `fileSize`, `width`,
`height`, `duration`, `media:title` (filename), `media:description`, and a
nested `media:thumbnail` for a video's poster. Atom's `<link>` has nowhere to
put any of it.

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
```

`<content>` is not needed. The quotation, the rating and the folded thread are
already inside `text`.

Layout is the consumer's, not the feed's: no feed format can express the site's
justified strip. The dimensions to compute it are on `media:content` — width is
`rowHeight * aspectRatio` for pictures and clips, a 3:4 card for everything
else, and only pictures and clips influence the row height. A text file beside a
photo is no reason to resize the photo.

## Known Limits

- **`media:content` is flat across a thread.** Root and reply attachments arrive
  in one list with nothing saying which post carries them. A consumer that needs
  the attribution reads `<content>`, where each post has its own
  `data-post-media` container. Adding an attribute would duplicate an answer the
  markup already gives.
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
- **Feed strings are hardcoded English** — `▶ Watch video`, `📎`,
  `3 more posts`. The feed is a user-facing surface and this contradicts the
  i18n rule in AGENTS.md. Fixing it means threading an `i18n` instance into the
  renderer.
