# Getting Started

Get your Jant site running in 5 minutes.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/)
- A [Cloudflare](https://cloudflare.com/) account (free tier works)

## Create Your Site

```bash
pnpm create jant my-blog
cd my-blog
```

This scaffolds a new Jant project with everything configured.

## Local Development

```bash
pnpm dev
```

Open [http://localhost:8787](http://localhost:8787). You'll see the setup page on first visit.

## First-time Setup

1. Create your admin account (email + password)
2. Set your site name
3. Choose your language

That's it. You're ready to write.

## Writing Content

### Notes

Quick thoughts. No title needed.

### Articles

Longer posts with titles. Supports Markdown.

### Links

Share external content with your commentary.

### Quotes

Attribute words to others.

### Images

Photos with optional captions.

## Visibility

Every post has a visibility level:

| Level        | What it means                                 |
| ------------ | --------------------------------------------- |
| **Featured** | Highlighted content, appears in main RSS feed |
| **Quiet**    | Normal publish, lower profile (default)       |
| **Unlisted** | Only accessible via direct link               |
| **Draft**    | Work in progress, not published               |

Default is "quiet" to reduce publishing anxiety. Opt-in to "featured" for posts you're proud of.

## Threads

Reply to your own posts to create connected threads. The entire thread shares the same visibility.

## Collections

Organize posts into themed collections:

- `/c/reading-2024` - Book notes from this year
- `/c/recipes` - Your cooking experiments
- `/c/thoughts-on-ai` - A series on AI

## Next Steps

- [Deploy to Cloudflare](deployment.md)
- [Configure your site](configuration.md)
- [Customize the theme](theming.md)
