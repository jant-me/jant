# Writing and organizing

Jant's publishing model has just one primitive: the post. A post comes in one of three formats (Note, Link, Quote), can carry attachments, and can carry a rating. If a few posts were written as a continuous train of thought, you can string them into a Thread. If Threads share a topic, you can group them into a Collection. Everything else is an extension of those two ideas.

## Post formats

### Note

Use Note when the body of the post is your own writing. Journal entries, essays, status updates, quick thoughts — all Notes.

The title is optional. If you give a Note a title, Jant uses it to generate the URL slug; otherwise it generates a short random one.

### Link

Use Link when you're sharing someone else's content along with your own take. Examples: a blog post a friend wrote, a fun tool you just discovered, a podcast episode worth listening to, a good article you read.

The URL is required. You'll need to fill in a title, and you can add your own commentary.

### Quote

Use Quote when you're citing someone else's words. Examples: a passage from a book, a sentence in an article that made you stop, a line from a film.

The quoted text is required; the author and source link are both optional. Quotes are typeset in their own dedicated style.

## Attachments

A post can carry attachments, and you can drag to reorder them. Two kinds:

- **Media attachments**: images, video, audio, and documents like PDFs.
- **Text attachments**: extra Markdown blocks. Good for content that doesn't belong in the same flow as the body — a full code listing, a raw AI conversation, a long quote.

## Ratings

A post can carry an optional rating from 1 to 5, typically used for things with a clear object of judgment — books, films, albums, restaurants. The rating shows up on the post page and in lists.

## Publish settings

Publishing settings sit in two places:

- **Publish settings** (next to the main **Publish** button): visibility (Public / Hidden from Latest / Private, shared by the whole Thread), plus saving a draft and opening Drafts.
- **Date and link** (top right of each post, reading `Now · /…` by default): sets the publish time and URL of that one post. It appears when you hover the post, and stays visible on narrow screens.

### Published on

A post is published with the current time by default. If you're backfilling older content — articles brought over from another platform, things you wrote long ago — open the date-and-link control at the top right of the post and set **Published on** to an earlier date; the post drops into the timeline at that point (Latest and the archive are both ordered by publish time).

Leave it blank to use the current time. You can only pick today or earlier: Jant doesn't schedule posts, so future dates are rejected.

### Custom link

A post's URL is generated from its title by default. **Custom link**, in the same control, sets the slug you want before publishing — for example, turning `/my-first-blog-post` into a clean `/hello`. Leave it blank to generate one automatically.

This is the simplest way to lock in a link when you first publish. Note: **changing this link after publishing makes the old address 404** — Jant won't redirect it. To change the URL of a post that's already published, use [Custom URLs](#custom-urls) below instead, which 301-redirects the old address to the new one.

### Preview a draft

Save the post, open **Drafts**, then choose **… → Preview** on its row. Jant opens `/preview/{slug}` in a new tab using the same Note, Link, Quote, media, and Thread rendering as the published page. A status bar marks the page as a draft preview.

Preview URLs require sign-in and are never indexed or cached.

## Threads

A Thread is a structure that strings multiple posts together in chronological order — you write a root post, and each subsequent post is a "reply" attached to it.

Good for the kind of content where you think as you write and update across several sittings: you might not know exactly where it's going at the start, but you want readers to follow it in order.

The whole Thread shares the visibility of the root post (Public / Hidden / Private), but Featured state is independent — a single reply can be featured on its own, with no need for the root post to be featured too.

To extend a Thread, click "Reply" at the bottom of the post detail page.

## Collections

A Collection is a curated grouping organized under `/{slug}`. The same Thread can belong to multiple Collections; its root and replies always share one membership set.

Good for:

- Long-running topics (for example, reading notes on a particular book)
- Reading, watching, and listening lists
- Site-status pages like `/now` (in the spirit of [nownownow](https://nownownow.com/), a "what I'm doing now" page — basically a slow, continuously updated story)

Each Collection has its own page and feed.

If you want a Collection whose members follow a rule instead of your tagging, see [Smart Collections](#smart-collections).

You can also combine multiple Collections in the URL:

- `/collections/reading+movies`
- `/collections/notes+links+quotes`

Jant treats this as a combined view across multiple Collections:

- Shows the union of complete Threads across the listed Collections
- A Thread that belongs to more than one of those Collections shows up only once
- Every matching Thread is shown in full, including all of its published replies
- The same pattern works for feeds: `/collections/{slug1}+{slug2}/feed`

## Smart Collections

A Smart Collection is a Collection whose members are decided by conditions rather than by tagging. You write the conditions once — "all Quotes", "Notes with images from 2024" — and every post that matches is in it, including the ones you write later.

To a reader it is a Collection: it lives at `/{slug}`, has a title, a description, a list of posts, and its own feed. One line under the count says what gathers them, and links to the archive showing the same posts, so a reader who wants to narrow further has somewhere to go.

Create one from **Collections → ⋯ → New Smart Collection**. The dialog counts matches as you type, so you can see what a condition does before saving it.

The conditions are combined with AND — a post has to match all of them. Each condition can appear once:

| Condition    | Chooses                                                   |
| ------------ | --------------------------------------------------------- |
| `Collection` | Threads in one Collection                                 |
| `Format`     | Notes, Links, or Quotes                                   |
| `Title`      | Titled or untitled posts                                  |
| `Year`       | Posts published in one calendar year                      |
| `Media`      | Posts with any attachment, none, or attachments of a kind |
| `Replies`    | Threads with replies, or single posts                     |
| `Visibility` | Public, Featured, or Hidden from Latest                   |

Saving with no conditions is allowed: that Smart Collection collects every post.

### What a Smart Collection cannot do

The conditions decide membership, so some things a Collection can do have no counterpart:

|                        | Collection            | Smart Collection      |
| ---------------------- | --------------------- | --------------------- |
| Add one post to it     | Tick it while writing | The conditions decide |
| Pin a Thread inside it | Yes                   | No                    |
| Reorder by hand        | Yes                   | No                    |
| Sort order             | You choose            | You choose            |
| Layout                 | —                     | List or grid          |
| Appears in Collections | Yes                   | Yes                   |
| Can go in navigation   | Yes                   | Yes                   |

Because of the first row, Smart Collections do not appear in the Collection picker while you write. There is nothing to pick: a post lands in one by matching, not by being added.

### Always public

There is no private Smart Collection. `Visibility` can only be `Public`, `Featured`, or `Hidden from Latest`, so a Smart Collection page never answers 404 to a visitor.

That is not the same as leaking private posts. Every page applies the same per-post rules a Collection page does: a visitor sees only what they could see anywhere else, and you may see a larger count when signed in.

If you want a private filtered view for yourself, filter `/archive` and bookmark the URL — that address already works, and what you give up is only the name.

## Make a standalone page (About)

Jant has no separate "page" type — a standalone page is just a Hidden from Latest post. To make an About page:

1. Create a Note, title it `About`, and write your introduction in the body.
2. Set the publishing state to **Hidden from Latest** — the page drops off the homepage Latest, but direct links still work and it stays out of the default `/feed`.

Once published, the page lives at `/about` — Jant derives the slug from the title. To give visitors a way in, add a link to `/about` under **Settings → Appearance → Navigation**.

## Visibility and curation

### Publishing states

A post has four publishing states:

- **`Public`**: public, appears on the homepage Latest, visible to anonymous visitors.
- **`Hidden from Latest`**: hidden from the homepage, but still public — direct links work, its Thread can belong to a Collection, and it appears in `/archive`.
- **`Private`**: visible only after sign-in.
- **`Draft`**: unpublished, visible only to you.

`/archive` is a complete index of every public post on the site.

### Featured

Marking a post as Featured does two things at once: it highlights that exact post on the `/featured` page, and it includes its Thread in the default `/feed` that goes to your subscribers. The page and feed show each Thread once even when several of its posts are Featured.

- The Featured page groups selected posts by Thread and orders Threads by the newest selected post's publication time
- The Featured feed lives at `/featured/feed`
- The main `/feed` can point at Featured or Latest, and defaults to Featured

### Why the default feed is Featured

One of Jant's core design choices is to separate "publishing" from "broadcasting."

**Publish** means the content appears on your site — accessible by direct link, eligible for a Collection, available to extend into a Thread.

**Broadcast** means the content gets pushed into subscribers' RSS feeds.

In Jant these two are independent:

- A post marked `Hidden from Latest` is hidden from the homepage, but the content itself stays public: direct links work, its Thread can belong to a Collection, and it appears in `/archive`.
- A `Public` post appears on the homepage Latest, but **does not** enter the default `/feed`.
- Only posts marked `Featured` enter `/feed` and reach subscribers.

This means you can publish small fragments without weight — they appear on your site but don't disturb your subscribers — and only the things you actually want to syndicate end up in the feed.

### Default behavior at a glance

The table below assumes the default `MAIN_RSS_FEED=featured`.

| Post state            | Direct URL | Latest | `/archive` | Default `/feed` | Collection |
| --------------------- | ---------- | ------ | ---------- | --------------- | ---------- |
| `Public` and Featured | Yes        | Yes    | Yes        | Yes             | Yes        |
| `Public`              | Yes        | Yes    | Yes        | No              | Yes        |
| `Hidden from Latest`  | Yes        | No     | Yes        | No              | Yes        |
| `Private`             | Login only | No     | Login only | No              | Login only |
| `Draft`               | No         | No     | No         | No              | No         |

If you switch `MAIN_RSS_FEED` to `latest`, the default `/feed` behavior shifts accordingly, but `Hidden from Latest` still keeps those posts out of that stream.

## URLs and browse pages

Jant uses readable URLs:

- Post: `/{slug}`
- Collection: `/{slug}`
- Combined Collection view: `/collections/{slug1}+{slug2}+{slug3}`
- Search: `/search`
- Archive: `/archive`
- Featured page: `/featured`

Feeds:

- `/feed` uses your currently configured main feed
- `/latest/feed` returns posts that appear on the homepage Latest (excludes `Hidden from Latest`)
- `/featured/feed` returns one entry per Thread containing Featured posts
- `/archive/feed` returns every public post (including `Hidden from Latest`), and supports filters like `?year=`, `?format=`, `?collection=`, `?media=`
- `/{slug}/feed` returns the feed for a single Collection
- `/collections/{slug1}+{slug2}/feed` returns the feed for a combined Collection view

Every page declares its feeds in the HTML head, so feed readers and browser
extensions find them without being handed a URL. Collection and Archive pages
put their own feed first — filters included — so subscribing from a page gives
you what the page shows.

All dynamic Atom feeds generated by Jant use the same publication grace
period. New posts and replies appear on the website immediately but become
eligible for feeds after five minutes by default. This gives you time to check
the published content, fix mistakes, or unpublish it before a feed reader can
fetch it. See
[Configuration § Feed defaults](configuration.md#feed-defaults-optional).

## Custom URLs

In addition to the default slug, Jant lets you set custom paths for posts, Collections, and archive pages, and lets you configure redirects. Manage all of them in the admin under **Settings → Advanced → Custom URLs** (the route is `/settings/custom-urls`).

There are four types:

- **Post**: assign a new primary path to a specific post; the original slug auto-redirects with a 301.
- **Collection**: assign a new primary path to a specific Collection; the original slug auto-redirects with a 301.
- **Archive**: pin a set of archive filters to a fixed path — for example, `/quotes` actually renders `/archive?format=quote&visibility=public&view=list`.
- **Redirect**: redirect any path to another path or to an external URL.

### Setting a custom path for a post or Collection

Go to **Settings → Advanced → Custom URLs**, then click **New Custom URL** in the top right:

- **Path**: the new public path you want — for example, `blog/my-post` (no leading `/`)
- **Type**: choose `Post` or `Collection`
- **Target Slug**: the slug of the post or Collection to point at

Once set, the new path becomes the canonical URL for that piece of content (permalink, feed, `og:url` all use the new path), and the original slug auto-redirects with a 301 — old links already in circulation keep working.

Useful when you want to graft content imported from another platform back onto its original URLs.

### Custom archive views (retired)

Custom URLs used to include an `Archive` type: a short path holding a hand-typed archive query. [Smart Collections](#smart-collections) replace it — same result, without writing `format=note&title=none` into a text field, and with a title, a description, and a feed.

Existing archive paths keep working, and there are no plans to change that. Each one gets a **Turn into a smart collection** action in its row menu, which opens the dialog with the conditions filled in so you can give it a real name before saving. A path whose query cannot be read exactly — or one that filters on `Private`, which a Smart Collection can never do — keeps working as it is and offers no upgrade.

### Redirect rules

- **Path**: an old or external path that's already in circulation
- **Type**: choose `Redirect`
- **Destination**: the target path (`/new-path`) or a full external URL (`https://...`)
- **Redirect Type**:
  - `301 (Permanent)` — for permanent moves; search engines update their index
  - `302 (Temporary)` — for temporary changes; search engines keep the original path

### A note on editing the slug directly

If you only want to change the public-facing path, **prefer the Post / Collection custom URL above** — the original slug redirects automatically and there's nothing else to do.

If you really do edit the slug field directly in the editor, note that Jant won't preserve the old address, and the old path becomes a 404. In that case, also go to **Settings → Advanced → Custom URLs** and add a manual 301 from the old path to the new slug.

### Reserved paths

The following top-level paths are used by Jant itself and can't be used as custom URLs:

`featured`, `latest`, `signin`, `signout`, `setup`, `settings`, `dash`, `api`, `feed`, `search`, `archive`, `media`, `pages`, `reset`, `collections`, `compose`, `preview`, `new`, `static`, `assets`, `_assets`, `healthz`, `readyz`

If an older site already uses `/preview` as a post or custom URL, that stored record is left unchanged but the old link becomes a 404. Older custom URLs below that prefix also stop resolving as custom URLs because the whole namespace now belongs to authenticated previews. Jant doesn't generate a replacement slug or redirect; edit the conflicting post or custom URL yourself if you want a new public address.

Custom paths can only contain lowercase letters, digits, hyphens (`-`), slashes (`/`), and dots (`.`). The first character must be a letter or digit.

## Quick entry point

When you're signed in, visiting `/new` takes you straight to the compose page — handy as a browser bookmark. If you're not signed in, you'll go through the sign-in page first and land on `/new` afterward.

## What's next

- [Multilingual content](multilingual.md) — publish in more than one language
- [GitHub Sync](github-sync.md) — keep your content synced to a GitHub repo
- [Theming](theming.md) — adjust how your site looks
