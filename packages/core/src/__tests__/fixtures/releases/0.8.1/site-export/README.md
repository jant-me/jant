# Jant Demo — Hugo Export

This is a static site exported from [Jant](https://github.com/jant-me/jant), ready to build with [Hugo](https://gohugo.io/).

## Install Hugo

This export targets Hugo **extended 0.147.7+**.

**macOS (Homebrew):**

```sh
brew install hugo
```

**Windows (Scoop):**

```sh
scoop install hugo-extended
```

**Linux:**

Download the extended build from <https://github.com/gohugoio/hugo/releases>.

See the [Hugo installation docs](https://gohugo.io/installation/) for more options.

## Quick start

Preview locally:

```sh
hugo serve
```

Then open <http://localhost:1313> in your browser.

Build the site for deployment:

```sh
hugo --minify
```

The output goes to the `public/` directory. Upload it to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages, etc.).

## Deploy to Cloudflare Workers

`wrangler.jsonc` at the root is the deploy config: it names the Worker, runs `hugo --gc --minify`, and points the upload at `public/`. Connect this repository to Cloudflare Workers Builds and leave the commands Cloudflare offers as they are:

| Field           | Value                          |
| --------------- | ------------------------------ |
| Build command   | leave empty                    |
| Deploy command  | `npx wrangler deploy`          |
| Version command | `npx wrangler versions upload` |

The build belongs to `wrangler.jsonc` rather than to that field: Workers Builds reads a `package.json` to detect a framework, a Hugo site has none, and an empty build command deploys a `public/` that was never built. Filling the field in as well makes Hugo run twice.

Check one thing before the first deploy: `name` in `wrangler.jsonc` has to match the Worker's name in the Cloudflare dashboard. Workers Builds fails the build when they differ, and a deploy run by hand under another name goes to another Worker. A Worker imported from a repository is named after the repository, so an export pushed by GitHub Sync uses the repository name. A downloaded export has no repository and uses the name GitHub Sync suggests when it creates one for this site. If the Worker is named something else, change `name` to match — Cloudflare names each build token `<worker-name> build token`, so the token list is one place to read it.

Jant writes `wrangler.jsonc` once and never overwrites it, so a corrected name survives later syncs.

`static/_redirects` needs no configuration here. Hugo copies it to `public/_redirects` and Workers applies the rules as published.

## Feeds

The feed addresses changed. Jant served them under `/feed`; Hugo serves them as `index.xml` inside each section:

| Jant                 | This export               |
| -------------------- | ------------------------- |
| `/feed`              | `/featured/index.xml`     |
| `/latest/feed`       | `/index.xml`              |
| `/featured/feed`     | `/featured/index.xml`     |
| `/archive/feed`      | `/archive/index.xml`      |
| `/{collection}/feed` | `/{collection}/index.xml` |

A reader who is already subscribed holds one of the old addresses, and a feed reader that gets a 404 stops delivering posts. `static/_redirects` maps every old address to its new one with a 301. Cloudflare Pages and Netlify read that file as published; on any other host, translate its rules into that host's redirect configuration before you point the domain here.

Hugo's `aliases:` cannot cover this. An alias page redirects with a meta refresh and a script, and feed readers fetch XML without running either — only an HTTP redirect reaches them.

Feed entries keep the IDs Jant gave them, so feed readers don't show old posts again. Each root post stores its ID in `feed_id`: the post's address on Jant, which is not its page URL here. Don't change `feed_id`, or feed readers show that post again. A post you add here without one uses its page URL.

The **Subscribe** entry in the site navigation points at `/featured/index.xml`. The exported site has no `/subscribe` page; that page belongs to the Jant runtime.

## Project structure

```
hugo.toml                 — Site configuration (baseURL, title, theme, params)
wrangler.jsonc            — Cloudflare Workers deploy config (see Deploy above)
content/
  _index.md               — Home section
  archive/_index.md       — Archive section
  collections/_index.md   — Collections directory section
  featured/_index.md      — Featured section
  {slug}/
    _index.md             — Thread root (branch bundle)
    {reply-slug}/
      index.md            — Reply (leaf bundle, not rendered as its own URL)
data/
  jant.toml               — Nav items, branding, display preferences, ordered collections directory
themes/jant/              — Bundled Hugo theme (overrideable via layouts/ at the site root)
static/                   — Copy files here to add them to the published site
  _redirects              — Feed redirects (see Feeds above)
```

## Customizing

- **Site settings** — edit `hugo.toml` to change the baseURL, title, or pagination.
- **Jant metadata** — `data/jant.toml` drives nav and the collections directory, and is preserved across round-trip import.
- **Styles** — edit `themes/jant/static/main.css`, or drop a `static/main.css` at the site root to override.
- **Templates** — add files under `layouts/` at the site root to override the bundled theme.
- **Debugging** — from a Jant site project, run `npx jant site export --url <site-url> --output ./my-site`, then `cd my-site && hugo serve`.

## Fetching media locally

When the source site has a storage provider configured (R2/S3/local proxy), images and attachments in this export link to the provider URL instead of being bundled. That keeps the repo small but means the files aren't on disk — fine if Hugo can reach the internet, not fine if you want a fully self-contained archive.

To download every referenced media file into `static/media/` and rewrite the references to local paths, run this from the root of the export:

```sh
npx @jant/core site pull-media --path .
```

Safe to re-run; files already on disk are reused. Anything that fails to download keeps its original URL so the site still builds.

## Notes

- Each thread is a Hugo branch bundle. Replies live as nested leaf bundles with `build.render = "never"` so they do not produce standalone URLs; they render inside the thread page.
- `/{reply-slug}/` URLs are preserved via `aliases:` on the root post, so old links still land on the right thread anchor.
- Feed addresses are the exception: they move to `index.xml` and stay reachable only through `static/_redirects`. See [Feeds](#feeds).
- Media is emitted under `static/media/{id}.ext` and referenced from a flat `media:` array on each post. When a storage provider has a configured public URL (R2/S3/local proxy), the exporter links to the provider URL instead of re-bundling the bytes.
- Posts with `draft: true` in front matter are only built when you pass `--buildDrafts` to `hugo` / `hugo serve`.
