# Discover

Discover is a public list of Jant blogs, at [jant.me/discover](https://jant.me/discover). It shows one post from each blog at a time and links back to the blog it came from. There are no follower counts, no rankings, and no trending list — just what people have been writing lately, newest first.

Your site takes part by default. **Settings → General → Site visibility** is where you say otherwise.

## The three settings

| Setting    | What it means                                                    |
| ---------- | ---------------------------------------------------------------- |
| `latest`   | Discover may show any of your public posts. This is the default. |
| `featured` | Discover may show only posts you have marked Featured.           |
| `off`      | Your site is not listed.                                         |

Two cases resolve to `off` without you choosing it:

- a site with `NOINDEX=true` that has never used the Discover control — hiding from search engines and being listed in a public directory contradict each other, and the quieter reading is the safe one;
- a site with `RSS_FEEDS_ENABLED=false`, because Discover reads your Atom feed and there is nothing to read.

Demo sites are never listed.

An explicit choice always wins. Once you have used the control, `NOINDEX` no longer decides this for you.

## How a post gets picked

Your blog holds one place in the list, per language you publish in. The post occupying it changes over time:

- **A post becomes eligible about a day after you publish it.** Nothing you write appears in Discover immediately.
- **Only one of your posts is shown at a time**, and it stays for a few hours before the next one takes over. That is what stops a busy afternoon filling the page with one blog.
- **If you publish faster than the rotation, some posts never appear.** This is deliberate: every blog gets the same amount of room, whether it posts once a week or six times a day.
- **If you have not published in a while, your most recent post stays as your entry**, until it is a couple of weeks old. After that your blog is absent from the list until you publish again.

The exact intervals are not a contract. They are tuned against how much the community is actually writing, and this page is updated when they change.

## Taking a post out

You do not have to delete anything.

**Before it appears**, there is nothing to undo. The delay means a post you publish and then reconsider was never shown.

**After it appears**, take it out of your latest feed and it leaves Discover on the next read of your feed. Any of these does it:

- tick **Hidden from Latest** on the post;
- set the post to private;
- move it back to draft.

Deleting the post works too, but it is the heaviest option and rarely the one you want.

## Announcing your site

A directory cannot list a self-hosted site it has never heard of. When you save Site visibility with Discover enabled for the first time, Jant sends your feed address — and nothing else — to the directory, once.

- It fires on that save only. Never on a schedule, never when you publish, never while the setting is off.
- The request body is the URL of your feed. No site name, no version, no counts, no identifier.
- Being announced is not the same as being listed. The directory still fetches your feed and reads what it says, and that declaration is what decides the outcome.

**Site visibility shows you what happened.** Whether the announcement reached the directory, what your feed declares, and how your site stands against the threshold below. All of it is read from your own site — a directory answers no questions about who it lists, so there is nothing to ask it. When an announcement does not get through, that section is also where you retry, or open the directory's form and submit the address by hand.

### When your site becomes eligible

jant.me lists a blog once it has **at least three public posts** and its **oldest public post is at least seven days old**. It keeps day-one test sites out without anyone reviewing anything, and there is nothing to apply for: the next read after you cross the line is the one that lists you. A directory of your own may decide differently.

A newly announced feed is read within six hours.

Set `DISCOVER_PING_URL` to point at a different directory, or to an empty value to announce nowhere:

```sh
# Announce to nobody.
DISCOVER_PING_URL=

# Announce to a directory of your own.
DISCOVER_PING_URL=https://directory.example/api/discover/ping
```

## What your feed declares

Every Atom feed your site publishes carries its Discover setting in its header, so a directory holding any one of your feeds can read your answer without being told separately.

```xml
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:jant="https://jant.me/ns" xml:lang="en">
  <title>A blog</title>
  <link href="https://example.com/" rel="alternate"/>
  <link href="https://example.com/latest/feed" rel="self"/>
  <jant:discover feed="https://example.com/latest/feed">latest</jant:discover>
</feed>
```

The rules a directory should follow:

- The namespace is `https://jant.me/ns`. It is a fixed identifier, not an address to fetch, and the prefix it is bound to is arbitrary.
- The element's text is `latest`, `featured`, or `none`. Anything else should be ignored.
- The `feed` attribute is the absolute URL to poll, and it is present for `latest` and `featured` only. Honour it only when it is on the same origin as the feed that declared it; otherwise a site could have somebody else's posts listed under its name.
- **An absent element is not `none`.** It means the site runs a version of Jant from before Discover, which is a different thing from a site that has said no.
- **But it does not mean yes forever.** A site is only ever listed after its element has been read, so a feed that declared once and then goes quiet is not an old version — it is a downgrade, a feed template that broke, or a domain that changed hands and now answers for somebody else. A directory should stop listing a feed whose element has been missing for a long while; jant.me waits thirty days, and lists it again on the first read that carries the element.
- `none` means stop, and it means stop now.

A multilingual site publishes a feed per language, each filtered to that language and labelled with `xml:lang`. Every feed lists the others:

```xml
<link href="https://example.com/latest/feed" rel="alternate" type="application/atom+xml" hreflang="zh-Hans"/>
<link href="https://example.com/en/latest/feed" rel="alternate" type="application/atom+xml" hreflang="en"/>
```

That is how a directory finds a bilingual blog's other language from whichever feed it happens to hold. A single-language site emits no such links.

## Two things worth knowing

**Feeds are cached for a minute.** A change to this setting takes effect on the next feed request that misses the cache, so a directory may act on the previous answer for up to a minute after you save.

**Renaming a post's slug changes its identity in the feed.** Discover identifies a post by its Atom `<id>`, which is built from its address. Rename the slug and the directory reads the old post as removed and the new one as newly published — so a post you rename may take its turn a second time. Custom URLs are stable: the first one a post is given stays its identity for good.
