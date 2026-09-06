import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("__JANT_DEV__", false);
vi.stubGlobal("__JANT_VERSION__", "test-version");
vi.stubGlobal("__CLIENT_JS_FILE__", "/_assets/client.js");
vi.stubGlobal("__CLIENT_AUTH_JS_FILE__", "/_assets/client-auth.js");
vi.stubGlobal("__CLIENT_COMPOSE_PRELOAD__", [
  "/_assets/client-compose.js",
  "/_assets/chunks/create-editor.js",
]);

function createContext(
  mainRssFeed: "featured" | "latest",
  overrides?: {
    assetBasePath?: string;
    sitePathPrefix?: string;
    siteUrl?: string;
    siteAvatarUrl?: string;
    themeMode?: "auto" | "light" | "dark";
    themeId?: string;
    defaultThemeId?: string;
    siteLanguage?: string;
    /** Language of the page being rendered (post language or view language). */
    lang?: string;
    rssFeedsEnabled?: boolean;
    storageDriver?: string;
    r2PublicUrl?: string;
  },
) {
  const values = {
    appConfig: {
      mainRssFeed,
      rssFeedsEnabled: overrides?.rssFeedsEnabled ?? true,
      sitePathPrefix: overrides?.sitePathPrefix ?? "",
      siteUrl: overrides?.siteUrl ?? "https://example.com",
      siteAvatarUrl: overrides?.siteAvatarUrl,
      siteLanguage: overrides?.siteLanguage ?? "en",
      noindex: false,
      customCSS: "",
      themeMode: overrides?.themeMode ?? "auto",
      themeId: overrides?.themeId ?? overrides?.defaultThemeId ?? "linen",
      defaultThemeId: overrides?.defaultThemeId ?? "linen",
      assetBasePath: overrides?.assetBasePath ?? "/_assets",
      storageDriver: overrides?.storageDriver ?? "r2",
      r2PublicUrl: overrides?.r2PublicUrl,
    },
    lang: overrides?.lang ?? overrides?.siteLanguage ?? "en",
    i18n: {
      _: (descriptor: { message?: string }) => descriptor.message ?? "",
    },
    publicRequestUrl: "https://example.com",
  } as const;

  return {
    get(key: keyof typeof values) {
      return values[key];
    },
  } as never;
}

async function loadBaseLayout() {
  const [{ CORE_VERSION }, { BaseLayout }] = await Promise.all([
    import("../../../lib/version.js"),
    import("../BaseLayout.js"),
  ]);

  return { CORE_VERSION, BaseLayout };
}

describe("BaseLayout", () => {
  it("always renders favicon and apple-touch links", async () => {
    const { CORE_VERSION, BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        children: "Test",
      }),
    );

    expect(html).toContain(`/favicon.ico?v=${CORE_VERSION}`);
    expect(html).toContain(`/apple-touch-icon.png?v=${CORE_VERSION}`);
    expect(html).not.toContain('sizes="180x180"');
  });

  it("uses explicit favicon and apple-touch asset hrefs when provided", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        faviconHref: "/_/brand/assets/jant-favicon.ico",
        appleTouchHref: "/_/brand/assets/jant-apple-touch-icon.png",
        children: "Test",
      }),
    );

    expect(html).toContain("/_/brand/assets/jant-favicon.ico");
    expect(html).toContain("/_/brand/assets/jant-apple-touch-icon.png");
  });

  it("falls back to the bundled social image when no avatar is provided", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        description: "Quiet writing.",
        children: "Test",
      }),
    );

    expect(html).toContain(
      'meta property="og:image" content="/_/brand/assets/jant-social-preview.png"',
    );
    expect(html).toContain(
      'meta name="twitter:image" content="/_/brand/assets/jant-social-preview.png"',
    );
  });

  it("falls back to the bundled social image when appConfig.siteAvatarUrl is an empty string", async () => {
    // resolve-config initializes siteAvatarUrl to "" (not undefined) when no
    // avatar is configured. Regression test: the fallback chain must skip
    // empty strings so og:image / twitter:image are never blank.
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", { siteAvatarUrl: "" }),
        children: "Test",
      }),
    );

    expect(html).toContain(
      'meta property="og:image" content="https://example.com/_/brand/assets/jant-social-preview.png"',
    );
    expect(html).toContain(
      'meta name="twitter:image" content="https://example.com/_/brand/assets/jant-social-preview.png"',
    );
  });

  it("uses an explicit social image when provided", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        socialImageUrl: "https://cdn.example.com/jant-card.png",
        children: "Test",
      }),
    );

    expect(html).toContain(
      'meta property="og:image" content="https://cdn.example.com/jant-card.png"',
    );
    expect(html).toContain(
      'meta name="twitter:image" content="https://cdn.example.com/jant-card.png"',
    );
  });

  it("defaults og:type to website without article timestamps", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        children: "Test",
      }),
    );

    expect(html).toContain('meta property="og:type" content="website"');
    expect(html).not.toContain("article:published_time");
    expect(html).not.toContain("article:modified_time");
  });

  it("renders article og:type with published and modified timestamps", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "A post",
        ogType: "article",
        articlePublishedTime: "2026-01-02T03:04:05.000Z",
        articleModifiedTime: "2026-03-04T05:06:07.000Z",
        children: "Test",
      }),
    );

    expect(html).toContain('meta property="og:type" content="article"');
    expect(html).toContain(
      'meta property="article:published_time" content="2026-01-02T03:04:05.000Z"',
    );
    expect(html).toContain(
      'meta property="article:modified_time" content="2026-03-04T05:06:07.000Z"',
    );
  });

  it("keeps the small twitter card and omits dimensions for the default social image", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        children: "Test",
      }),
    );

    expect(html).toContain('meta name="twitter:card" content="summary"');
    expect(html).not.toContain('content="summary_large_image"');
    expect(html).not.toContain("og:image:width");
  });

  it("renders dimensions, alt, and a large twitter card for a landscape post image", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "A post",
        socialImageUrl: "https://cdn.example.com/photo.jpg",
        socialImageWidth: 1600,
        socialImageHeight: 900,
        socialImageAlt: "A wide landscape photo",
        children: "Test",
      }),
    );

    expect(html).toContain('meta property="og:image:width" content="1600"');
    expect(html).toContain('meta property="og:image:height" content="900"');
    expect(html).toContain(
      'meta property="og:image:alt" content="A wide landscape photo"',
    );
    expect(html).toContain(
      'meta name="twitter:image:alt" content="A wide landscape photo"',
    );
    expect(html).toContain(
      'meta name="twitter:card" content="summary_large_image"',
    );
  });

  it("keeps the small twitter card for a portrait post image", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "A post",
        socialImageUrl: "https://cdn.example.com/tall.jpg",
        socialImageWidth: 600,
        socialImageHeight: 900,
        children: "Test",
      }),
    );

    expect(html).toContain('meta name="twitter:card" content="summary"');
    expect(html).not.toContain('content="summary_large_image"');
  });

  it("renders JSON-LD structured data and escapes script-breaking characters", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "A post",
        jsonLd: {
          "@type": "BlogPosting",
          headline: "Mind the </script> gap",
        },
        children: "Test",
      }),
    );

    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).not.toContain("</script> gap");
  });

  it("skips JSON-LD when the page is noindex", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "A post",
        noindex: true,
        jsonLd: { "@type": "WebSite" },
        children: "Test",
      }),
    );

    expect(html).not.toContain("application/ld+json");
  });

  it("exposes the main and alternate feed links without duplicating featured", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured"),
        children: "Test",
      }),
    );

    expect(
      html.match(/rel="alternate" type="application\/atom\+xml"/g) ?? [],
    ).toHaveLength(2);
    expect(html).toContain('href="/feed"');
    expect(html).toContain('href="/latest/feed"');
    expect(html).not.toContain('href="/featured/feed"');
  });

  it("switches the alternate feed link when latest is the main feed", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("latest"),
        children: "Test",
      }),
    );

    expect(
      html.match(/rel="alternate" type="application\/atom\+xml"/g) ?? [],
    ).toHaveLength(2);
    expect(html).toContain('href="/feed"');
    expect(html).toContain('href="/featured/feed"');
    expect(html).not.toContain('href="/latest/feed"');
  });

  it("omits feed autodiscovery when feed publishing is disabled", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", { rssFeedsEnabled: false }),
        children: "Test",
      }),
    );

    expect(html).not.toContain('type="application/atom+xml"');
    expect(html).not.toContain('href="/feed"');
  });

  it("preloads the composer's files on signed-in pages, under the asset base path", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", {
          sitePathPrefix: "/blog",
          siteUrl: "https://example.com/blog",
          assetBasePath: "/blog/_assets",
        }),
        isAuthenticated: true,
        children: "Test",
      }),
    );

    expect(html).toContain(`src="/blog/_assets/client-auth.js"`);
    expect(html).toContain(
      `<link rel="modulepreload" href="/blog/_assets/client-compose.js"`,
    );
    expect(html).toContain(
      `<link rel="modulepreload" href="/blog/_assets/chunks/create-editor.js"`,
    );
  });

  it("preloads nothing for readers, who never open the composer", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured"),
        children: "Test",
      }),
    );

    expect(html).toContain(`src="/_assets/client.js"`);
    expect(html).not.toContain("modulepreload");
  });

  it("links the author stylesheet only once someone is signed in", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const render = (isAuthenticated: boolean) =>
      renderToString(
        BaseLayout({
          title: "Jant",
          c: createContext("featured", {
            sitePathPrefix: "/blog",
            siteUrl: "https://example.com/blog",
            assetBasePath: "/blog/_assets",
          }),
          ...(isAuthenticated ? { isAuthenticated } : {}),
          children: "Test",
        }),
      );

    // The composer, editor and settings CSS is the bulk of the hand-written
    // component styles and none of it renders for a visitor; shipping it on a
    // public page would put it back on the critical path of every page view.
    expect(render(false)).not.toContain("client-author.css");
    expect(render(true)).toContain(
      '<link rel="stylesheet" href="/blog/_assets/client-author.css"',
    );
    // Both pages still share the one reader stylesheet.
    expect(render(false)).toContain(`href="/blog/_assets/client.css"`);
    expect(render(true)).toContain(`href="/blog/_assets/client.css"`);
  });

  it("uses the public asset base path from appConfig in production", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", {
          sitePathPrefix: "/blog",
          siteUrl: "https://example.com/blog",
          assetBasePath: "/blog/_assets",
        }),
        children: "Test",
      }),
    );

    expect(html).toContain(`src="/blog/_assets/client.js"`);
    expect(html).toContain(`href="/blog/_assets/client.css"`);
    expect(html).toContain('data-asset-base-path="/blog/_assets"');
  });

  it("preconnects to the asset host when assets are served from a CDN", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", {
          siteUrl: "https://example.com",
          assetBasePath: "https://cdn.example.com/jant",
        }),
        children: "Test",
      }),
    );

    expect(html).toContain(
      '<link rel="preconnect" href="https://cdn.example.com"/>',
    );
    expect(html).toContain(
      '<link rel="preconnect" href="https://cdn.example.com" crossorigin="anonymous"/>',
    );
    // Before the stylesheet it warms the connection for.
    expect(html.indexOf('rel="preconnect"')).toBeLessThan(
      html.indexOf('rel="stylesheet"'),
    );
  });

  it("preconnects to the media host as well when it is a separate one", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", {
          siteUrl: "https://example.com",
          assetBasePath: "https://cdn.example.com/jant",
          r2PublicUrl: "https://media.example.com",
        }),
        children: "Test",
      }),
    );

    expect(html).toContain(
      '<link rel="preconnect" href="https://media.example.com"/>',
    );
    expect(html).not.toContain(
      '<link rel="preconnect" href="https://media.example.com" crossorigin="anonymous"/>',
    );
  });

  it("preconnects once to a host that serves both assets and media", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", {
          siteUrl: "https://example.com",
          assetBasePath: "https://cdn.example.com/_assets",
          r2PublicUrl: "https://cdn.example.com/media",
        }),
        children: "Test",
      }),
    );

    expect(html.match(/rel="preconnect"/g)).toHaveLength(2);
  });

  it("preconnects to nothing when assets and media share the site's origin", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const sameOrigin = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", {
          siteUrl: "https://example.com",
          assetBasePath: "https://example.com/_assets",
          r2PublicUrl: "https://example.com/media",
        }),
        children: "Test",
      }),
    );
    const samePath = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", { assetBasePath: "/_assets" }),
        children: "Test",
      }),
    );

    expect(sameOrigin).not.toContain('rel="preconnect"');
    expect(samePath).not.toContain('rel="preconnect"');
  });

  it("loads the CJK stylesheet for the site language", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", { siteLanguage: "zh-Hant" }),
        children: "Test",
      }),
    );

    expect(html).toContain("client-cjk-tc.css");
    expect(html).not.toContain("client-cjk.css");
  });

  it("follows the page language rather than the site language", async () => {
    const { BaseLayout } = await loadBaseLayout();
    // A Traditional Chinese post on a Simplified Chinese site: the Han glyphs
    // must come from the post's own language, not the site's.
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", {
          siteLanguage: "zh-Hans",
          lang: "zh-Hant",
        }),
        children: "Test",
      }),
    );

    expect(html).toContain("client-cjk-tc.css");
    expect(html).not.toContain("client-cjk.css");
  });

  it("emits the CJK font variables for the page language", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", { siteLanguage: "en", lang: "ja" }),
        children: "Test",
      }),
    );

    expect(html).toContain("--font-cjk-serif-fallback");
    expect(html).toContain("client-cjk-jp.css");
  });

  it("emits no CJK font variables for a non-CJK page language", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", { siteLanguage: "en" }),
        children: "Test",
      }),
    );

    expect(html).not.toContain("--font-cjk-serif-fallback");
  });

  it("exposes the active theme id on the root html element", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", { themeId: "frost" }),
        children: "Test",
      }),
    );

    expect(html).toContain('data-theme="frost"');
  });

  it("renders theme-color tags that follow the active theme in auto mode", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", {
          defaultThemeId: "linen",
          themeMode: "auto",
        }),
        children: "Test",
      }),
    );

    expect(html).toContain('meta name="theme-color" content="#faf7ec"');
    expect(html).toContain('media="(prefers-color-scheme: light)"');
    expect(html).toContain(
      'meta name="theme-color" content="#121211" media="(prefers-color-scheme: dark)"',
    );
  });

  it("pins theme-color to the forced theme mode", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured", {
          defaultThemeId: "linen",
          themeMode: "dark",
        }),
        children: "Test",
      }),
    );

    expect(html).toContain('meta name="theme-color" content="#121211"');
    expect(html).not.toContain('media="(prefers-color-scheme: light)"');
    expect(html).not.toContain('media="(prefers-color-scheme: dark)"');
  });

  it("includes critical CSS for the medium and small header layouts", async () => {
    const { BaseLayout } = await loadBaseLayout();
    const html = renderToString(
      BaseLayout({
        title: "Jant",
        c: createContext("featured"),
        children: "Test",
      }),
    );

    expect(html).toContain(".site-header-search-link");
    expect(html).toContain("@media(max-width:1200px)");
    expect(html).toContain(".site-header-search-form{display:none!important}");
    // Tiered nav collapse: 4 inline ≤960px, 3 inline ≤780px, 2 inline ≤580px
    expect(html).toContain("@media(max-width:960px)");
    expect(html).toContain(".site-header-link-collapse-lg");
    expect(html).toContain("@media(max-width:780px)");
    expect(html).toContain(".site-header-link-collapse-md");
    expect(html).toContain("@media(max-width:580px)");
    expect(html).toContain(".site-header-link-collapse-sm");
    expect(html).toContain(
      "@media(max-width:480px){.site-header-nav,.site-header-more{display:none!important}.site-header-search-slot{display:flex!important}",
    );
  });
});
