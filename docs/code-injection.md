# Code injection

Code injection embeds external resources like analytics, fonts, comments, and widgets into your site. Find it under **Settings > Advanced > Code Injection**.

Two injection slots:

| Slot        | Injection point  | Best for                                                                       |
| ----------- | ---------------- | ------------------------------------------------------------------------------ |
| Site Header | Before `</head>` | Things that must load early: analytics, custom meta tags, fonts, CSS           |
| Site Footer | Before `</body>` | Things that must not block rendering: chat widgets, comments, deferred scripts |

Injected content appears on **every public page** — every route outside settings. It is written into the HTML verbatim, which means:

- Injected scripts can read and write everything in the visitor's browser — cookies, localStorage, form input. Only paste sources you trust.
- A broken tag will break the page. Check the browser console after editing.
- Injected scripts affect first-paint performance. If something can be deferred, keep it out of the header.

## giscus (GitHub Discussions comments)

When configuring on [giscus.app](https://giscus.app), set **Page ↔ Discussions Mapping** to "Discussion title contains a specific term". Put any placeholder in the term box — the script below overrides it dynamically. Note the `data-repo`, `data-repo-id`, `data-category`, and `data-category-id` values giscus gives you.

Paste the following into **Site Footer**:

```html
<script>
  (function () {
    var slot = document.querySelector("[data-post-end]");
    if (!slot) return;

    var canonical = document.querySelector('link[rel="canonical"]');
    var term = canonical
      ? new URL(canonical.href, location.origin).pathname
      : location.pathname;

    var s = document.createElement("script");
    s.src = "https://giscus.app/client.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.setAttribute("data-repo", "OWNER/REPO");
    s.setAttribute("data-repo-id", "R_xxx");
    s.setAttribute("data-category", "Announcements");
    s.setAttribute("data-category-id", "DIC_xxx");
    s.setAttribute("data-mapping", "specific");
    s.setAttribute("data-term", term);
    s.setAttribute("data-strict", "1");
    s.setAttribute("data-reactions-enabled", "1");
    s.setAttribute("data-input-position", "bottom");
    s.setAttribute("data-theme", "preferred_color_scheme");
    s.setAttribute("data-lang", "en");
    slot.appendChild(s);
  })();
</script>
```

Key points:

- Mounting through the `[data-post-end]` slot inherits the body column width and left alignment automatically. The element is absent on non-post pages, which acts as a built-in page guard.
- `data-mapping="specific"` paired with the dynamic `term` turns giscus's "search discussions by term" mode into an exact match.
- The `term` reads from `<link rel="canonical">`'s path, not `location.pathname`. In Jant, all child URLs inside a thread share one canonical (pointing at the thread root), so the whole thread maps to a single discussion.
- `data-strict="1"` disables GitHub's fuzzy search, so different threads aren't accidentally collapsed into the same discussion.
- `data-theme="preferred_color_scheme"` follows Jant's light / dark mode automatically.

The first time someone visits a thread, giscus won't find a matching Discussion and shows "This post has no discussions yet". Once the first comment is posted, GitHub creates a Discussion automatically with the canonical path as its title, and later visits hit it.

## Disqus

Paste the following into **Site Footer** and replace `YOUR-SHORTNAME` with your Disqus shortname:

```html
<script>
  (function () {
    var slot = document.querySelector("[data-post-end]");
    if (!slot) return;

    var canonical = document.querySelector('link[rel="canonical"]');
    var canonicalUrl = canonical ? canonical.href : location.href;
    var canonicalPath = new URL(canonicalUrl, location.origin).pathname;

    var thread = document.createElement("div");
    thread.id = "disqus_thread";
    slot.appendChild(thread);

    window.disqus_config = function () {
      this.page.url = canonicalUrl;
      this.page.identifier = canonicalPath;
    };

    var s = document.createElement("script");
    s.src = "https://YOUR-SHORTNAME.disqus.com/embed.js";
    s.setAttribute("data-timestamp", String(+new Date()));
    s.async = true;
    document.head.appendChild(s);
  })();
</script>
```

Using the canonical path for `page.identifier` instead of `location.pathname` lets every child URL inside a thread share the same comment thread.

## Site analytics

Jant counts page views on its own; see [Stats](stats.md). An external service adds what Jant does not keep: unique visitors, countries, devices.

Analytics scripts are usually load-time sensitive — put them in **Site Header**.

**Plausible**:

```html
<script
  defer
  data-domain="yoursite.com"
  src="https://plausible.io/js/script.js"
></script>
```

**Umami**:

```html
<script
  defer
  src="https://YOUR-UMAMI-HOST/script.js"
  data-website-id="YOUR-WEBSITE-ID"
></script>
```

**Google Analytics 4**:

```html
<script
  async
  src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"
></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    dataLayer.push(arguments);
  }
  gtag("js", new Date());
  gtag("config", "G-XXXXXXXXXX");
</script>
```

Replace `G-XXXXXXXXXX` with the Measurement ID from GA4 Admin → Data Streams. GA4 is heavier than Plausible or Umami and writes cookies for cross-session tracking; if you want to avoid cookies, go with Plausible or Umami.

None of these need event configuration — `pageview` is reported on every full page load, and Jant is a server-rendered multi-page site, so it works out of the box.

If you only want to track public pages and skip settings, add a guard:

```html
<script>
  if (!location.pathname.startsWith("/settings")) {
    var s = document.createElement("script");
    s.defer = true;
    s.src = "https://plausible.io/js/script.js";
    s.setAttribute("data-domain", "yoursite.com");
    document.head.appendChild(s);
  }
</script>
```

## Custom fonts

When the built-in font themes aren't enough, load fonts from Google Fonts or self-hosted sources. Put the font declaration in **Site Header**:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Source+Serif+4:wght@400;600&display=swap"
/>
```

Then apply the fonts to Jant's typography variables in **Custom CSS**:

```css
:root {
  --font-body: "Inter", sans-serif;
  --font-heading: "Source Serif 4", serif;
}
```

For the full variable list, see [Theming § Typography variables](theming.md#typography-variables).

## What's next

- [Theming](theming.md) — list of CSS variables and font variables
- [FAQ](faq.md) — comments comparison, multilingual sites, SEO
