import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { pageRoutes } from "../page.js";

function createPageTestApp(options: { authenticated?: boolean } = {}) {
  const testApp = createTestApp(options);
  testApp.app.route("/", pageRoutes);
  return testApp;
}

async function createDraft(
  services: ReturnType<typeof createTestApp>["services"],
  title = "A private draft",
) {
  return services.posts.create({
    format: "note",
    title,
    bodyMarkdown: `${title} body`,
    status: "draft",
  });
}

describe("draft preview route", () => {
  it("redirects anonymous visitors to sign in and preserves the preview path", async () => {
    const { app, services } = createPageTestApp();
    const draft = await createDraft(services);

    const res = await app.request(`/preview/${draft.slug}`, {
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      `/signin?redirect=${encodeURIComponent(`/preview/${draft.slug}`)}`,
    );
  });

  it("renders the public post view with explicit private preview signals", async () => {
    const { app, services } = createPageTestApp({ authenticated: true });
    const draft = await createDraft(services);

    const res = await app.request(`/preview/${draft.slug}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");

    const html = await res.text();
    expect(html).toContain(`data-post-id="${draft.id}"`);
    expect(html).toContain("A private draft body");
    expect(html).toContain("data-preview-status");
    expect(html).toContain("Draft preview");
    expect(html).toContain("This post isn’t published.");
    expect(html).toContain("Edit draft");
    expect(html).toContain(`/preview/${draft.slug}?edit=1`);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain("application/ld+json");
    expect(html).not.toContain("article:published_time");
    expect(html).toContain('id="compose-dialog"');
  });

  it("renders every draft in a saved thread", async () => {
    const { app, services } = createPageTestApp({ authenticated: true });
    const root = await createDraft(services, "Thread root");
    const reply = await services.posts.create({
      format: "quote",
      quoteText: "Unpublished reply quote",
      status: "draft",
      replyToId: root.id,
    });

    const res = await app.request(`/preview/${root.slug}`);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Thread root body");
    expect(html).toContain("Unpublished reply quote");
    expect(html).toContain(`/preview/${reply.slug}`);
  });

  it("redirects a published post preview to its public permalink", async () => {
    const { app, services } = createPageTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "Already public",
      status: "published",
    });

    const res = await app.request(`/preview/${post.slug}`, {
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`/${post.slug}`);
  });

  it("returns 404 for the preview root and unknown draft slugs", async () => {
    const { app } = createPageTestApp({ authenticated: true });

    expect((await app.request("/preview")).status).toBe(404);
    expect((await app.request("/preview/missing-draft")).status).toBe(404);
  });
});

describe("reserved path and redirect precedence", () => {
  it("ignores a legacy redirect that collides with the preview route", async () => {
    const { app, services } = createPageTestApp({ authenticated: true });
    const draft = await createDraft(services);
    await services.paths.create({
      path: `preview/${draft.slug}`,
      kind: "redirect",
      redirectToPath: "elsewhere",
      redirectType: 301,
    });

    const res = await app.request(`/preview/${draft.slug}`, {
      redirect: "manual",
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`data-post-id="${draft.id}"`);
  });

  it("makes a legacy canonical preview path inert", async () => {
    const { app, services } = createPageTestApp({ authenticated: true });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "Old preview post",
      status: "published",
    });
    await services.paths.updatePostSlug(post.id, "preview");

    const res = await app.request("/preview", { redirect: "manual" });

    expect(res.status).toBe(404);
  });

  it("keeps ordinary redirects working and ahead of derived collection feeds", async () => {
    const { app, services } = createPageTestApp();
    const collection = await services.collections.create({
      slug: "reading",
      title: "Reading",
    });
    const post = await services.posts.create({
      format: "note",
      bodyMarkdown: "Book log",
      status: "published",
    });
    await services.collections.addThread(collection.id, post.id);
    await services.paths.create({
      path: "reading/feed",
      kind: "redirect",
      redirectToPath: "archive",
      redirectType: 302,
    });
    await services.paths.create({
      path: "old-link",
      kind: "redirect",
      redirectToPath: "reading",
      redirectType: 301,
    });

    const feedRes = await app.request("/reading/feed", {
      redirect: "manual",
    });
    expect(feedRes.status).toBe(302);
    expect(feedRes.headers.get("Location")).toBe("/archive");

    const ordinaryRes = await app.request("/old-link", {
      redirect: "manual",
    });
    expect(ordinaryRes.status).toBe(301);
    expect(ordinaryRes.headers.get("Location")).toBe("/reading");
  });
});
