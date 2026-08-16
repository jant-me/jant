# Multilingual content

A Jant site publishes in one language by default: you set it once, and it tells readers, search engines, and feed readers what they are looking at.

Turn on multilingual content and the site starts serving one browsing surface per language. Each language gets its own home page, archive, and feed, readers get a switcher in the header, and posts written in different languages can be linked as versions of one another.

Every post keeps exactly one address through all of this. The languages change what a _list_ shows, never where a post lives.

## What the prefix means

The primary language stays at the root. Every other language is served under a URL prefix built from its tag, lowercased.

On a site whose primary language is Simplified Chinese, also publishing English and Japanese:

| Surface     | 简体中文       | English           | 日本語            |
| ----------- | -------------- | ----------------- | ----------------- |
| Home        | `/`            | `/en`             | `/ja`             |
| Latest      | `/latest`      | `/en/latest`      | `/ja/latest`      |
| Featured    | `/featured`    | `/en/featured`    | `/ja/featured`    |
| Archive     | `/archive`     | `/en/archive`     | `/ja/archive`     |
| Search      | `/search`      | `/en/search`      | `/ja/search`      |
| Collections | `/collections` | `/en/collections` | `/ja/collections` |
| Main feed   | `/feed`        | `/en/feed`        | `/ja/feed`        |
| A post      | `/hello`       | `/hello`          | `/hello`          |

A prefix selects a **view**: the same page, filtered to that language. `/en/archive` is the archive of English posts, `/en/feed` is a feed of English posts, and paging inside a view stays inside it.

Two paths that look like they should exist but do not, on purpose:

- **The primary language's own prefix** redirects to the root (`/zh-hans` → `/`, HTTP 301). One language, one canonical address.
- **Everything that is not a reader surface** — the dashboard, collection editors, post permalinks — has one address site-wide. `/en/settings` is a 404, not an English dashboard.

## Turning it on

Open **Settings → Language → Multilingual content** and choose **Turn on**. In the dialog, confirm which language is primary and add at least one more.

Two things happen when you save:

- **Posts with no language are stamped with the primary language.** Before multilingual content is first enabled, posts carry no language at all — the root view would otherwise come back empty. This is a one-time pass over existing posts, and the dialog tells you how many it will touch. Anything actually written in another language can be corrected afterwards from its own menu.
- **The URL prefixes are checked against your existing URLs.** If a prefix would shadow a post or page you already publish — an `/en` prefix on a site with a post at `/en` — the change is refused rather than quietly shadowing that address.

Nothing else moves. Post addresses stay as they are, and you can turn it off again at any time.

## Choosing a language when you publish

The composer grows a globe control once the site publishes more than one language. It offers each of your languages plus **Detect**, which reads the language from what you have written so far.

Detection is a character-set voter, not a statistical model, and it is honest about what it can tell:

- Hangul and kana are near-unambiguous, so Korean and Japanese are reliable.
- Simplified and Traditional Chinese are told apart by characters that exist in only one of the two. A sentence is usually plenty. Text written identically in both is reported as Chinese of unsettled variant — enough on a site that publishes only one of them, deliberately not enough on a site that publishes both.
- Latin script only says "not CJK". It resolves to a language when the site publishes exactly one non-CJK language, and otherwise leaves the choice to you.
- A fragment of a few words reads as nothing at all, and the default stands.

Detection never returns a language your site does not publish, and it is always a suggestion you can override. Posts that arrive through the API, the Telegram bot, or MCP — where nobody picked anything — run the same detection on the server.

A Thread has one language. Replies inherit it from the root, and changing the language of any post in a Thread changes the whole Thread.

## Linking translations

Open a post's **⋯** menu and choose **Language**. It holds everything about that post's language:

- **Change language** — set which language this post (and its Thread) is written in.
- **Write the {language} version** — open the composer on a new post in that language, already linked to this one. The original stays on screen while you write.
- **Link a version you already wrote** — search your posts and link one that exists. Only posts that can actually be linked are listed.
- **Other versions** — the posts already linked to this one, each openable, each unlinkable.

Linked posts form a **translation group**: one post per language, with no direction and no original. Nothing is a translation _of_ anything — the posts are versions of each other, and unlinking one leaves the others intact.

Two rules the site enforces, so a link never quietly restructures your content:

- A group holds at most one post per language.
- Two posts that each already belong to a group cannot be linked, because that would merge two groups. Unlink one side first.

Only Thread roots can be linked. A reply belongs to its Thread, and the Thread is what has a language.

### What readers get

- A post that has other versions shows **Also available in** with a link to each.
- The header switcher means "take me to this language's site". From a list surface it goes to that surface in the other language; from a post it goes to that post's version in the other language when one exists, and to that language's home page when it does not. It never links to a 404 and never warns.
- Each view's feed declares its own language, so a reader subscribing to `/en/feed` gets English posts marked as English.
- Per-language surfaces carry `<link rel="alternate" hreflang>` for every language plus `x-default`, and the sitemap lists the same groups. Both need an absolute site URL configured to be honoured — see [Configuration](configuration.md).

## Managing languages

All of it lives on **Settings → Language**, on the language list that replaces the single language picker once multilingual content is on.

**Add a language.** It appears in the switcher and takes its prefix immediately. You do not need a post in it first.

**Make another language primary.** The two swap in one step: the new primary takes the root URLs and the old primary moves to its own prefix. Post addresses do not change — but anyone subscribed to `/feed` starts receiving the new primary language's posts, because `/feed` is the root view's feed.

**Remove a language.** Only allowed while no post is written in it. With posts present there is no good answer — hiding, moving, or redirecting them all guess at what you meant — so Jant reports how many posts still use it and links to them, and leaves the decision to you. Once the language is gone its prefix stops answering.

**Remove the last one, and multilingual content goes with it.** Per-language views need a second language to mean anything, so removing the only language other than the primary turns the feature off in the same step. Jant asks first and says what changes. The rule above still holds: a language posts are written in cannot be removed, last one or not — change those posts' language first.

## Turning it off

Choose **Turn off** on the Language page. The root URLs go back to showing every language, and the old prefixes redirect there, so existing links and feed subscriptions keep working.

Your language list and every post's language are kept. Turning it back on restores the same setup, and nothing needs to be stamped a second time.

Removing your languages one by one ends up in the same place, with one difference: a removed language is gone from the list, so its prefix stops answering instead of redirecting. Turn it off when you might come back to it; remove a language when you are done with it.

## Settings reference

| Setting                | What it holds                                          |
| ---------------------- | ------------------------------------------------------ |
| `SITE_LANGUAGE`        | The primary language — the one served at the root      |
| `ADDITIONAL_LANGUAGES` | The languages served under a prefix, in switcher order |
| `MULTILINGUAL_ENABLED` | Whether the per-language views are served              |
| `DASHBOARD_LANGUAGE`   | The language of your own dashboard                     |

The first three are written by the Language page rather than edited directly: their values have to stay consistent with each other and with the language stamped on your posts. They are visible in the Config Editor, which links back to the Language page instead of making them editable there.

`DASHBOARD_LANGUAGE` is unrelated to what you publish. It sets the language of the private dashboard, only you see it, and **Follow content language** keeps it in step with the site's primary language.

## API

Every language operation has an HTTP endpoint, so the same moves are available to scripts and agents:

| Endpoint                                     | What it does                               |
| -------------------------------------------- | ------------------------------------------ |
| `PUT /api/posts/:id/language`                | Set the language of a post's whole Thread  |
| `GET /api/posts/:id/translations`            | List the versions linked to this post      |
| `GET /api/posts/:id/translations/candidates` | Search posts this one could be linked to   |
| `POST /api/posts/:id/translations`           | Link another post as a version of this one |
| `DELETE /api/posts/:id/translations`         | Unlink this post from its group            |

Posts created through the API can carry `language`, and `translationOfId` to land in an existing group on creation. Without a language, the server detects one. Request and response shapes are in the [API reference](API.md#language-and-translations).

## What's next

- [Writing and organizing](writing-and-organizing.md) — formats, Threads, and Collections
- [Configuration](configuration.md) — the settings behind the Language page
- [API reference](API.md#language-and-translations) — language and translation endpoints
