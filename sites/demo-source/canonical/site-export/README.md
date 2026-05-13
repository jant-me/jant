# Jant — Hugo Export

This is a static site exported from [Jant](https://github.com/jant-me/jant), ready to build with [Hugo](https://gohugo.io/).

## Install Hugo

This export targets Hugo **extended 0.160.1+**.

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

## Project structure

```
hugo.toml                 — Site configuration (baseURL, title, theme, params)
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
```

## Customizing

- **Site settings** — edit `hugo.toml` to change the baseURL, title, or pagination.
- **Jant metadata** — `data/jant.toml` drives nav and the collections directory, and is preserved across round-trip import.
- **Styles** — edit `themes/jant/static/main.css`, or drop a `static/main.css` at the site root to override.
- **Templates** — add files under `layouts/` at the site root to override the bundled theme.
- **Debugging** — from a Jant site project, run `npx jant site export --directory ./my-site`, then `cd my-site && hugo serve`.

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
- Media is emitted under `static/media/{id}.ext` and referenced from a flat `media:` array on each post. When a storage provider has a configured public URL (R2/S3/local proxy), the exporter links to the provider URL instead of re-bundling the bytes.
- Posts with `draft: true` in front matter are only built when you pass `--buildDrafts` to `hugo` / `hugo serve`.
