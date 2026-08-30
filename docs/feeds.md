# Feeds

Every list page on a Jant site publishes an Atom feed, and the feed lives one segment below the page it belongs to. The archive is at `/archive`, so its feed is at `/archive/feed`. A collection at `/reading` has its feed at `/reading/feed`. Learn the rule once and you can address any of them.

Your readers do not have to learn it. `/subscribe` names the three feeds most people want, with the addresses ready to copy, and a feed icon sits beside every collection in the directory and on every filtered archive view. This page is the complete map, for when you want a feed those two do not offer.

Turn feeds off entirely under **Settings → General**. Every feed address stops resolving, `/subscribe` disappears, and the feed entries drop out of your navigation.

## The site-wide feeds

| Feed     | Address          | Carries                                                       |
| -------- | ---------------- | ------------------------------------------------------------- |
| Main     | `/feed`          | Whichever of the two below you chose under Settings → General |
| Latest   | `/latest/feed`   | Published posts, minus the ones hidden from Latest            |
| Featured | `/featured/feed` | Posts you marked as featured                                  |
| All      | `/archive/feed`  | Every published post, including ones hidden from Latest       |

`/feed` follows your setting: change **Main RSS feed** and everyone subscribed to `/feed` starts receiving the other one. `/latest/feed` and `/featured/feed` never move, so use those when you want an address that means the same thing a decade from now.

`/archive/feed` is the only feed carrying posts hidden from Latest. Those posts are public and reachable, they just stay off the front page — the archive feed is for a reader who wants everything anyway.

## Collection feeds

| Feed                 | Address                   |
| -------------------- | ------------------------- |
| One collection       | `/{collection}/feed`      |
| One smart collection | `/{collection}/feed`      |
| Several at once      | `/collections/{a+b}/feed` |

A combined feed carries posts in any of the collections you name, joined with `+`: `/collections/reading+cooking/feed`.

The collections directory at `/collections` has no feed of its own. It is a list of collections, not of posts.

## Filtered archive feeds

The archive's filters carry into its feed, so any view you can assemble at `/archive` you can also subscribe to. Filter the page, then use the feed icon beside the post count — the address it points at already carries what you selected.

| Parameter    | Example                            | Effect                                    |
| ------------ | ---------------------------------- | ----------------------------------------- |
| `collection` | `/archive/feed?collection=reading` | Only posts in that collection             |
| `year`       | `/archive/feed?year=2025`          | Only that year                            |
| `format`     | `/archive/feed?format=quote`       | Only Notes, Links, or Quotes              |
| `sort`       | `/archive/feed?sort=updated`       | Order by activity rather than publication |

By default the archive feed is ordered by publication, like the page it belongs to. `?sort=updated` orders by activity instead: a new reply pulls an older thread back to the top. That makes the feed's contents shift under a fixed length — a returning thread pushes something else out — which is why it is opt-in.

`?format=` also works on `/latest/feed`. It does nothing on `/feed` or on the featured feed.

## What every feed shares

**Length.** Each feed carries your most recent 50 entries. Change it with `RSS_FEED_LIMIT` (1–200).

**Publication delay.** A post stays out of every feed for five minutes after publishing, so a typo caught right away never reaches anyone's reader. Change it with `RSS_PUBLISH_DELAY_SECONDS`, or set it to `0` to publish immediately.

**Private posts** never appear in any feed. Drafts do not either.

**Threads** arrive as one entry, with the replies included in the body, so a thread does not fill a reader with fragments.

## Feeds and languages

On a multilingual site every feed exists once per language, under that language's prefix: `/ja/feed`, `/ja/archive/feed`, `/ja/reading/feed`. Each carries only that language's posts and declares itself in that language. The primary language keeps the unprefixed addresses. See [Multilingual content](multilingual.md).

## Older addresses

These still work and always will, so nobody's subscription breaks. New links should use the canonical address on the right.

| Old                     | Now              |
| ----------------------- | ---------------- |
| `/feed/latest`          | `/latest/feed`   |
| `/feed/featured`        | `/featured/feed` |
| `/feed/all`             | `/latest/feed`   |
| `/feed/atom.xml`        | `/feed`          |
| `/{page}/feed/atom.xml` | `/{page}/feed`   |
