# Introduction

> **Pre-1.0**: Jant is still early. Expect rough edges, breaking changes, and docs that keep moving while the product settles.
>
> Jant is open source under AGPL-3.0-or-later. Source code is hosted on [GitHub](https://github.com/jant-me/jant); please report problems via [Issues](https://github.com/jant-me/jant/issues).

Jant is a small blog system for one author. It supports three post formats — **Note, Link, Quote** — that you can connect into Threads and group into Collections. Publishing feels closer to Twitter or Threads than to a WordPress or Ghost dashboard.

![Jant Home](https://jant-me-media.jant.me/assets/jant-home-800-0816.webp)

Live demo: [demo.jant.me](https://demo.jant.me). Click [Sign in](https://demo.jant.me/signin) under the `More` menu — demo credentials are pre-filled, and the data resets daily.

You can also look at the author's own blog as a real-world example: [www.owenyoung.com](https://www.owenyoung.com/).

## Why Jant exists

I've always believed that practicing writing means writing in public — that's what forces a thought to become clear. But when every post goes out to RSS subscribers, publishing costs more than it should: a link, a quote, a photo taken on the way home — is that worth interrupting a few hundred people for? Most of the time the answer is no, so the post either never gets written or gets put off indefinitely.

Before Jant I blogged with a static site generator. Markdown is a format that actually lasts — a hundred years from now the plainest text editor will still open it — but the price is that publishing takes too many steps: new file, pick a name, write the front matter, write the body, commit, push, wait for the deploy before you can see it. So whenever I had good articles to share, I'd save up several before posting once.

I wanted a blog that stays readable and still gets updated often. Nothing on the market did both, so I built one.

## Publishing is not broadcasting

A post in Jant has three levels of visibility, and Latest is the default:

- **Latest** (default): appears in the homepage timeline, for people who come to look.
- **`Hidden from Latest`**: off the homepage, but the link is still public, and the post still shows up in `/archive` and in any Collection it belongs to.
- **Featured**: also appears on `/featured` and goes out to RSS subscribers through `/feed`.

The way I use it: everyday notes go to `Hidden from Latest`, collected in a Collection called Now; only what I actually want subscribers to read gets marked Featured. Without that option, I probably wouldn't post a lot of it.

## About the name

Jant comes from _Jantelagen_ — a concept from a 1933 Nordic satirical novel, often summarized as "don't show off, don't compare." In Scandinavia the term carries a critical edge, often invoked as shorthand for a collective culture that suppresses individuality. Happiness researchers tend to read it the other way around: a quiet agreement not to compete or intrude on each other is part of what makes Nordic societies feel calm, and one of the reasons people there report being so content. I've always liked the word. It felt right for something that's meant to be quiet.

Today's social networks push in exactly the opposite direction:

- One pressure comes from watching others — constant performance and comparison, which feeds anxiety.
- The other comes from being watched — every post is force-pushed to all your followers, until the weight of it kills the urge to say anything at all.

Jant does neither: no followers, no likes, no algorithmic feed.

If you're still on the fence about whether to start a blog, [this essay](why-blog.md) might give you a reason.

## The writing experience

A traditional blog usually hands you a form for managing content: title, body, category, tags, excerpt, SEO, cover image. Jant borrows the more ergonomic Tumblr / Twitter interface instead: you post from the homepage, the title is optional, and Reply extends a post into a Thread, so you can keep working on it afterwards.

Link and Quote are first-class formats, not variants of an article. More than half of what I post is links and quotes; Tumblr worked out over a decade ago that making them native formats gets people posting more often, and blog systems since have barely followed. Images, video, and audio too: I posted more of them in one month on Jant than in the whole year before.

The common moves have keyboard shortcuts: `n` opens a new post from any page (`l` for a link, `q` for a quote), `Cmd + K` searches; on a post page, `e` edits, `f` features, `c` changes Collections. The body is a Markdown editor — type `/` for commands.

![Jant compose screen](https://jant-me-media.jant.me/assets/jant-compose-800-0816.webp)

## What Jant has

- Three formats: Note, Link, Quote
- Threads: a continuous train of thought can keep going, with no need to pad it into an essay
- Collections: curated by topic — closer to a bookshelf than to tags
- Media attachments: images, video, audio, Markdown, documents, code snippets
- Ratings: rate books, films, podcasts, and articles
- Featured / Latest split: publishing is not the same as broadcasting
- Search, archive page, RSS
- Built-in themes, font themes, custom CSS
- Bidirectional GitHub Sync: every edit in Jant commits as Markdown to your GitHub repo, and edits made on GitHub flow back to the site. The repo itself is a complete Hugo site you can `hugo build` independently, and it doubles as a full backup. See [GitHub Sync](github-sync.md).
- API and MCP: automate publishing, imports, and maintenance — built for [AI agents](automation-and-api.md)
- Hugo static site export: you can [leave with your content](export-and-import.md) anytime

## What's next

- [Getting started](getting-started.md) — get a Jant blog running
- [Writing and organizing](writing-and-organizing.md) — how to use Note / Link / Quote, Threads, and Collections
- [GitHub Sync](github-sync.md) — sync your content to a GitHub repo
