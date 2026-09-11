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

**Length.** Each feed carries your most recent 50 entries. Change it with `RSS_FEED_LIMIT` (1–200). Any feed also takes `?limit=` for one read of a different length, up to 500: `/latest/feed?limit=200`. It is for catching up on a site's history, the way a directory reads your site the first time it sees it; the address without it is still the one to subscribe to. A value that is not a whole number above zero is ignored.

**Publication delay.** A post stays out of every feed for five minutes after publishing, so a typo caught right away never reaches anyone's reader. Change it with `RSS_PUBLISH_DELAY_SECONDS`, or set it to `0` to publish immediately.

**Private posts** never appear in any feed. Drafts do not either.

**Threads** arrive as one entry, with the replies included in the body, so a thread does not fill a reader with fragments.

**Post format.** Each entry declares what kind of post it is — `<jant:format>quote</jant:format>`, in the `https://jant.me/ns` namespace — because a quote and an untitled note are otherwise identical in Atom. A thread is declared by its root. Readers that do not know the namespace ignore it.

**Post ID.** Each entry also carries the post's own ID, `<jant:id>pst_…</jant:id>`, beside `<id>`. `<id>` is the post's address, which changes when you rename its slug or move the site to another domain. The ID never changes, so anything that needs to recognise the same post across either can rely on it.

## Feeds and languages

On a multilingual site every feed exists once per language, under that language's prefix: `/ja/feed`, `/ja/archive/feed`, `/ja/reading/feed`. Each carries only that language's posts and declares itself in that language. The primary language keeps the unprefixed addresses. See [Multilingual content](multilingual.md).

## Discover

[Jant Discover](https://jant.me/discover) is a public list of Jant blogs and their posts. Its home shows the posts blogs have marked Featured; its Links and Quotes lists show every link and quote post. Each links back to the blog it came from — no counts, no ranking, no trending list.

Your site takes part once you say so, under **Settings → General → Site visibility**, or on the last screen of first-run setup, which asks the same question once. Nothing is listed on a default: a directory reads your feed for an answer, and a site that has never been asked has not given one. A demo site, a site with `RSS_FEEDS_ENABLED=false`, and — until you choose for yourself — a site with `NOINDEX=true` stay out whatever the control says.

Turning it on sends your feed address to the directory, so it knows your site exists. Nothing else is sent. It is sent again when you turn Discover off and back on, or when you press **Announce my site** under the setting. Answering yes during setup sends it there and then — a directory decides for itself what a blog needs before it is listed, and re-reads the feed on its own schedule, so a site with nothing published yet loses nothing by saying hello early. The directory is the one your deployment belongs to: your own control plane when you run one, otherwise Jant's. `DISCOVER_PING_URL` overrides that; set it empty to announce nowhere.

To pull a post back out, remove it from the feed it was read from — unmark it Featured, tick **Hidden from Latest**, set it private, or move it back to draft. A directory learns it the next time it reads the feed, or, for an older post the feed no longer carries, the next time it asks about that post.

What a directory does with the feeds is its own policy: which list a post reaches, how long it waits before it is shown, and what a blog needs before it is listed are answered where the directory lives.

### What your feed declares

Every Atom feed carries the setting in its header, so a directory holding any one of your feeds can read your answer without being told separately.

```xml
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:jant="https://jant.me/ns" xml:lang="en">
  <title>A blog</title>
  <link href="https://example.com/" rel="alternate"/>
  <link href="https://example.com/latest/feed" rel="self"/>
  <jant:discover feed="https://example.com/latest/feed" featured="https://example.com/featured/feed" status="https://example.com/api/discover/posts">latest</jant:discover>
</feed>
```

The rules a directory should follow:

- The namespace is `https://jant.me/ns`. It is a fixed identifier, not an address to fetch, and the prefix it is bound to is arbitrary.
- The element's text is `latest`, `featured`, or `none`. Anything else should be ignored. `latest` is what the setting writes today: the directory may read any public post. `featured` is what older releases wrote for a site that chose to offer only its featured posts; a directory should keep honouring it, and read only the one feed it names.
- The `feed` attribute is the absolute URL to poll, and it is present for `latest` and `featured` only. Honour it only when it is on the same origin as the feed that declared it; otherwise a site could have somebody else's posts listed under its name.
- The `featured` attribute is the absolute URL of the site's featured feed, present beside `feed` under `latest`, so a directory can show featured posts on one list and everything on another without guessing the address. The same-origin rule applies. A feed from before this attribute omits it; the featured feed then sits beside the latest one at the same base path, `/featured/feed` for `/latest/feed`.
- The `status` attribute is the absolute URL a directory asks about posts it already holds; see [Asking about posts](#asking-about-posts). It is present whenever `feed` is, and on a multilingual site it carries the feed's language as `?lang=`. The same-origin rule applies.
- **An absent element is not `none`.** It means the site runs a version of Jant from before Discover, which is a different thing from a site that is not listed. It does not mean yes forever either: a feed that declared once and then goes quiet is a downgrade, a feed template that broke, or a domain that changed hands. A directory should stop listing a feed whose element has been missing for a long while — jant.me waits thirty days — and list it again on the first read that carries the element.
- `none` means stop, and it means stop now. It covers both a site that has taken itself out and a site that has never opted in; both answers are no.

On a multilingual site each language's feed declares itself and lists the others with `hreflang`, which is how a directory finds a bilingual blog's other language from whichever feed it happens to hold.

Two details decide what a directory sees. Feeds are cached for a minute, so a change to the setting takes effect on the next read that misses the cache. And a directory should know a post by its `<jant:id>`, not its `<id>`: renaming a slug or moving the site to another domain changes the second and never the first.

### Asking about posts

A feed carries only your newest entries, so a post missing from it may have been taken out or may only have been pushed past the feed's length. The permalink cannot settle it either: a post hidden from Latest or unfeatured is still a live page. A directory asks instead, at the address in the `status` attribute:

```
GET https://example.com/api/discover/posts?id=pst_01jpyx3m7gw4w3h7m4bknq0v1d&id=pst_01jpyx5bq4e0c9t2wq0h6gk3r8
```

```json
{
  "posts": [
    {
      "id": "pst_01jpyx3m7gw4w3h7m4bknq0v1d",
      "latest": true,
      "featured": false
    },
    {
      "id": "pst_01jpyx5bq4e0c9t2wq0h6gk3r8",
      "latest": false,
      "featured": false
    }
  ]
}
```

- `latest` says whether the post is in the Latest feed, `featured` whether its thread is in the featured feed. Both follow the feeds' own rules, the publication delay included.
- `false` on both covers every way a post can be gone — deleted, private, back to draft — and an ID the site does not know. The directory does not need the reason.
- Up to 50 IDs per request, the ones from `<jant:id>`. Each is answered once, in the order asked.
- The address answers only while the site is listed in Discover. It follows that setting rather than `PUBLIC_API_ENABLED`, because it tells nothing the public feeds do not.

## Older addresses

These still work and always will, so nobody's subscription breaks. New links should use the canonical address on the right.

| Old                     | Now              |
| ----------------------- | ---------------- |
| `/feed/latest`          | `/latest/feed`   |
| `/feed/featured`        | `/featured/feed` |
| `/feed/all`             | `/latest/feed`   |
| `/feed/atom.xml`        | `/feed`          |
| `/{page}/feed/atom.xml` | `/{page}/feed`   |
