# Introduction

> **Pre-1.0**: Jant is still early. Expect rough edges, breaking changes, and docs that keep moving while the product settles.
>
> Jant is open source under AGPL-3.0-or-later. Source code is hosted on [GitHub](https://github.com/jant-me/jant); please report problems via [Issues](https://github.com/jant-me/jant/issues).

Jant is a small blog system for one author. It supports three post formats — **Note, Link, Quote** — that you can connect into Threads and group into Collections. Publishing feels closer to Twitter or Threads than to a WordPress or Ghost dashboard.

![Jant Home](https://jant-me-media.jant.me/assets/jant-home-800.png)

Live demo: [demo.jant.me](https://demo.jant.me). Click [Sign in](https://demo.jant.me/signin) under the `More` menu — demo credentials are pre-filled, and the data resets daily.

You can also look at the author's own blog as a real-world example: [www.owenyoung.com](https://www.owenyoung.com/).

## A quieter way to write in public

The name comes from _Jantelagen_ — a concept from a 1933 Nordic satirical novel, often summarized as "don't show off, don't compare." In Scandinavia the term carries a critical edge, often invoked as shorthand for a collective culture that suppresses individuality. Happiness researchers tend to read it the other way around: a quiet agreement not to compete or intrude on each other is part of what makes Nordic societies feel calm, and one of the reasons people there report being so content.

Today's social networks push in exactly the opposite direction:

- One pressure comes from watching others — constant performance and comparison, which feeds anxiety.
- The other comes from being watched — every post is force-pushed to all your followers, until the weight of it kills the urge to say anything at all.

Most blog systems inherited the same logic, treating "published" and "broadcast" as a single decision — you post something, and it lands in your RSS feed, your subscribers' readers, and your homepage timeline at the same moment. Jant separates publishing from broadcasting: each post chooses its distribution — hidden from Latest, shown on Latest, or marked Featured to enter `/feed` and push to RSS.

If you're still on the fence about whether to start a blog, [this essay](why-blog.md) might give you a reason.

## The writing experience

A traditional blog gives you a form: title, body, category, tags, excerpt, SEO, cover image. That's an interface for managing content, not for writing. Jant takes the cue from Twitter and Threads instead — title is optional, you can extend any post into a Thread later, and publishing is a single action.

![Jant compose screen](https://jant-me-media.jant.me/assets/jant-compose.png)

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
