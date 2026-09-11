# Reading a Jant feed

Jant's Atom feed carries enough to redraw the site's own timeline: what kind of post each entry is, the text as the timeline cuts it, the attachments with their dimensions, and the shape of a thread. Hand this page to whoever writes the consumer — an app, a directory, a script, an AI given the feed and asked to render it.

It says what arrives and how to read it. Why each field is shaped that way is in [the feed contract](feed-contract.md); feed addresses and settings are in [Feeds](../feeds.md).

## Namespaces

| Prefix  | URI                             | Carries                               |
| ------- | ------------------------------- | ------------------------------------- |
| —       | `http://www.w3.org/2005/Atom`   | Everything standard                   |
| `jant`  | `https://jant.me/ns`            | Post ID and format, threads, Discover |
| `media` | `http://search.yahoo.com/mrss/` | Attachment metadata                   |

Both extensions are declared only when the feed emits something in them — which for `jant` is every served feed, since each carries `<jant:discover>`. The URIs are fixed identifiers, not addresses to fetch, and the prefixes bound to them are arbitrary — match on the URI.

An Atom reader that knows neither extension still gets a working feed. Everything Jant adds is either an element in its own namespace or an attribute on a Media RSS element.

## One entry

```xml
<entry>
  <title></title>
  <link href="https://ex.com/roasting-again" rel="alternate"/>
  <id>https://ex.com/roasting-again</id>
  <jant:id>pst_01jpyx3m7gw4w3h7m4bknq0v1d</jant:id>
  <published>2026-03-19T09:00:00.000Z</published>
  <updated>2026-03-19T09:00:00.000Z</updated>
  <jant:format>note</jant:format>
  <category term="coffee" label="Coffee" jant:page="https://ex.com/coffee"/>
  <media:content url="https://ex.com/m/beans.jpg" type="image/jpeg" medium="image"
                width="1600" height="1200">
    <media:description type="plain">Roasted beans cooling on a tray</media:description>
  </media:content>
  <summary type="html"><![CDATA[<p>Roasting again.</p>]]></summary>
  <content type="html"><![CDATA[<p>Roasting again.</p>
<div data-post-media>…</div>]]></content>
</entry>
```

| Element                  | Count | Read it for                                                                                            |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------ |
| `id`                     | 1     | The post's permalink. Always — even on a Link post, whose `alternate` points elsewhere                 |
| `jant:id`                | 1     | The post's ID. Unlike `id` it survives a slug rename or a new domain: key on it to recognise a post    |
| `title`                  | 1     | The title. **Empty, not absent**, on untitled Notes and every Quote                                    |
| `link[@rel="alternate"]` | 1     | Where the entry points: the external URL on a Link post, the permalink otherwise                       |
| `link[@rel="related"]`   | 0–1   | Link posts only: the permalink, since `alternate` was spent on the external URL                        |
| `link[@rel="enclosure"]` | 0–n   | Attachments a plain Atom parser can fetch. Images are excluded — the content already shows them        |
| `published` / `updated`  | 1     | Timestamps. A curated feed may date an entry by the curation rather than the post                      |
| `jant:format`            | 1     | `note`, `link`, or `quote` — the entry's, which is the root's in a thread                              |
| `jant:thread`            | 0–1   | The entry is a thread. Absent means a lone post                                                        |
| `jant:truncated`         | 0–1   | The summary's text was cut. Offer a "read more". A row's `truncated` says which post. Never on a Quote |
| `category`               | 0–n   | Collections. `@term` is the slug, `@label` the title, `@jant:page` the absolute URL                    |
| `media:thumbnail`        | 0–1   | A Link post's preview image, for a card or grid                                                        |
| `media:content`          | 0–n   | One per attachment, with dimensions and duration                                                       |
| `summary`                | 0–1   | The post's text, as the timeline renders it                                                            |
| `content`                | 1     | The whole post page                                                                                    |

A Quote's attribution is not its title — it is inside the text, as a `<figure>` with a `<figcaption>`. A star rating is inside the text too, as `★★★★☆ 4/5`.

## Two renderings

The site draws every post twice: cut down in the timeline, whole on its own page. The entry carries both.

- **`<summary>`** is the post's text as the timeline shows it — cut at the same place, a Quote's quotation and attribution, the rating, a thread folded down. No media, no Link preview image.
- **`<content>`** is the whole post page, attachments included.

Both are HTML in CDATA, with every URL absolute. Render them; do not strip the markup.

`<summary>` is present whenever the entry has any text, including when that text is the whole post. **Missing says one thing: this post has no text** — a photo with no caption. So `summary ?? ""` is the whole rule, and truncation is `jant:truncated`, never a comparison against `<content>`.

A Quote arrives whole: neither its quoted text nor its commentary is cut, because the site does not cut them either. So a Quote entry never carries `jant:truncated`, and its `<summary>` and `<content>` hold the same text.

To draw a timeline you need `<summary>`, not `<content>`.

## Threads

A thread arrives as one entry — root and replies together, so a reader does not fill with fragments. `<content>` carries the whole chain; `<summary>` folds it exactly the way the site's timeline does: the root, the first two replies, a gap link standing for the run between, then the last three replies with the newest as the hero. Up to six posts, so a thread that fits arrives whole and hides nothing.

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

| Attribute | Means                                                           |
| --------- | --------------------------------------------------------------- |
| `posts`   | Posts in the thread, root included                              |
| `hidden`  | How many the summary folds away                                 |
| `gap`     | The first post the fold hides. Only when `hidden` is above zero |
| `latest`  | The newest reply — the one the summary shows in full            |

One row per post, in thread order. `gap`, `latest`, and every
`media:content/@jant:post` name a `href` from this list.

| Row attribute | Count | Notes                                                                     |
| ------------- | ----- | ------------------------------------------------------------------------- |
| `href`        | 1     | The post's permalink                                                      |
| `format`      | 1     | `note`, `link`, or `quote`, for this post                                 |
| `published`   | 1     | This post's own timestamp                                                 |
| `title`       | 0–1   | Absent when the post has none, and on every Quote                         |
| `url`         | 0–1   | Link posts only: where it points                                          |
| `thumbnail`   | 0–1   | Link posts only: the preview image                                        |
| `folded`      | 0–1   | `"true"` when the fold hid this post; absent means the summary renders it |
| `truncated`   | 0–1   | `"true"` when the summary cut this post's block                           |

**Read a reply here, not from the entry.** Every entry-level field describes
the root: `<jant:format>` says `note` for a thread whose newest reply is a
Quote, and `<title>` and `link[@rel="alternate"]` say nothing about a titled
reply or a Link reply. The root carries a full row too, so you can walk the
rows without special-casing it.

A row carries what Atom would put on that post's entry — links, title, date —
plus `format` and `truncated`. Never the body or an excerpt: those are in
`<content>`.

**Read `folded` rather than looking for the post in the summary.** A rendered
post with no text — a photo with no caption — contributes no block and no tail
meta, so its absence from the summary says nothing about whether it was hidden.
Treating it as folded drops its attachments and the post disappears.

**`truncated` on a row means the summary cut that post's block.** Any post the
fold renders can carry it. On a post behind the gap its absence means "not cut
here", **not** "this post arrived whole". The entry's `<jant:truncated/>` is the same answer for the whole card,
and the only form a lone post has.

Inside both text constructs, each post's block **ends** with that post's own dated permalink:

```xml
<p>Dialing in a new bag.</p>
<p><small><a href="https://ex.com/dialing-in" class="u-url"><time class="dt-published"
   datetime="2026-03-14T09:00:00.000Z">Mar 14, 2026</time></a></small></p>
<hr/>
<p><small><a href="https://ex.com/r1">2 more posts</a></small></p>
```

Every marker ends the block before it and names the post that wrote it, the root's included. That is how you split one field into several posts. The markup is microformats2 (`u-url`, `dt-published`), so an mf2 parser gets it without a special case, and the `<a>` wrapping a `<time datetime>` still identifies it when `class` is stripped.

A post with no text contributes no block and leaves no marker. A lone post has no marker at all — `<published>` already dates it.

A reply's title, and a Link reply's source line, sit in a `<header>` inside
its block — the root's are in the entry's own `<title>` and
`link[@rel="alternate"]` instead. Render it as it stands, or drop that one
element and redraw from the row, which also has the `thumbnail` the text cannot
show.

**Do not parse `<hr/>`.** It is drawn between posts, but it also separates a Quote from the author's commentary, and an author can type one.

## Attachments

Three surfaces, three jobs.

**`<content>`** shows them, each post's own inside a `<div data-post-media>` beside that post's text. It is the only place an attachment sits in the running order of a thread.

**`<media:content>`** describes them: `type`, `medium`, `fileSize`, `width`, `height`, `duration`, a `media:title` holding the filename, a `media:description` holding alt text or a text file's excerpt, and a nested `media:thumbnail` when the file has a still that is not the file itself: a video's poster, or a picture's resized rendering.

- `@jant:post` names the post carrying the file. In a thread every attachment has it, the root's included; a lone post's entry has none, because its one post is the entry.
- **Files from folded posts arrive too.** An entry's media is the whole thread's. When a file's `jant:post` names a row that is neither the root nor `latest`, it belongs to a post behind the gap link — drawing it is your call.
- `@jant:page` is where a click should land, written only when it differs from `@url` — text attachments, whose file a browser downloads. Read `jant:page ?? url`.
- `medium` is Media RSS's fixed vocabulary, so anything that is not a picture or playable is `document`.

**`<link rel="enclosure">`** is what a plain Atom parser reads. Images are left out — the content already shows them full size — while audio, video and documents keep theirs, the way a podcast feed encloses its audio and not its show-note images.

Do not match `<media:content>` to `<content>` by URL: a text attachment's link points at its rendered page, not at the file.

## Rendering a timeline

```
permalink = entry/id
title     = entry/title                // no heading when empty
text      = entry/summary ?? ""        // HTML; render it
media     = entry/media:content[]      // document order
tags      = entry/category[]
readMore  = entry/jant:truncated exists
thread    = entry/jant:thread          // absent on a lone post
```

For a thread drawn as separate cards, split `text` on the tail markers and match each block's files by `jant:post`. Each block's permalink also names a `<jant:post>` row, which is where that post's own format lives. Files left over belong to the posts the fold hid; showing them is your call. `hidden` is a number, so the gap line can be written in your reader's own language.

Layout is yours. No feed format can express the site's justified media strip — compute it from the dimensions on `media:content`, where a picture or clip is `rowHeight * aspectRatio` wide, everything else is a 3:4 card, and only pictures and clips set the row height.

## What the feed does not carry

- **A rating as a number.** It is `★★★★☆ 4/5` inside the text.
- **A text attachment's character count.** Media RSS has no slot for it and `fileSize` is bytes.
- **Attachments interleaved inside a summary.** `<summary>` is text alone. If you place a gallery between two posts' paragraphs, either decide that position yourself or read `<content>`, where each `data-post-media` already sits in order.
- **Translated strings.** `▶ Watch video` and `2 more posts` are English in every feed.
- **Anything a self-hosted export promises.** A site exported to a static theme writes its own feed, and that one carries less. Read the served feed when you need this contract.
