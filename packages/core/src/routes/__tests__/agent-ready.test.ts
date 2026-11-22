import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import type { Database } from "../../db/index.js";
import { computePkceS256Challenge } from "../../services/oauth.js";
import { createServices } from "../../services/index.js";
import type { Bindings } from "../../types.js";
import { createRoundTripD1 } from "../../__tests__/helpers/d1-round-trips.js";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { createAuth } from "../../auth.js";

const ORIGIN = "https://blog.example";
const AUTH_SECRET = "s".repeat(48);

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as Parameters<ReturnType<typeof createApp>["fetch"]>[2];

async function createAgentReadyTestSite() {
  const { db, sqlite } = createTestDatabase({ fts: true });
  const rawQuery = {
    query: async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
      const stmt = sqlite.prepare(sql);
      return stmt.all(...params) as T[];
    },
  };

  const services = createServices(
    db as unknown as Database,
    rawQuery,
    DEFAULT_TEST_SITE_ID,
    { slugIdLength: 5, authSecret: AUTH_SECRET },
  );

  await services.settings.completeOnboarding();
  await services.settings.set("SITE_NAME", "Garden Notes");
  await services.settings.set(
    "SITE_DESCRIPTION",
    "Quiet essays and links about software.",
  );

  const auth = createAuth(db as unknown as Database, {
    secret: AUTH_SECRET,
    baseURL: ORIGIN,
    useSecureCookies: true,
  });
  const signup = await auth.api.signUpEmail({
    body: {
      email: "owner@blog.example",
      password: "strongpassword123",
      name: "Owner",
    },
    asResponse: true,
  });
  const setCookies = signup.headers.getSetCookie?.() ?? [
    signup.headers.get("set-cookie") ?? "",
  ];
  const sessionCookie = setCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");

  const createdUser = sqlite.prepare("SELECT id FROM user LIMIT 1").get() as {
    id: string;
  };
  await services.siteMembers.ensure(
    DEFAULT_TEST_SITE_ID,
    createdUser.id,
    "owner",
  );

  const essays = await services.collections.create({
    slug: "essays",
    title: "Essays",
    description: "Longer writing on engineering and design.",
  });

  const rootNote = await services.posts.create({
    format: "note",
    slug: "hello-agents",
    title: "Hello AI Agents",
    bodyMarkdown:
      "Jant stores **clean Markdown** natively.\n\nNo lossy HTML scraping needed.",
    status: "published",
    visibility: "public",
    featured: true,
    collectionIds: [essays.id],
  });

  const replyNote = await services.posts.create({
    format: "note",
    slug: "hello-agents-reply",
    bodyMarkdown: "Follow-up thought inside the same Thread.",
    status: "published",
    visibility: "public",
    replyToId: rootNote.id,
  });

  const linkPost = await services.posts.create({
    format: "link",
    slug: "rfc-9727",
    title: "RFC 9727 API Catalog",
    url: "https://www.rfc-editor.org/rfc/rfc9727",
    bodyMarkdown: "Standard way to publish an API catalog under .well-known.",
    status: "published",
    visibility: "public",
  });

  const quotePost = await services.posts.create({
    format: "quote",
    slug: "calm-quote",
    quoteText: "Simplicity is prerequisite for reliability.",
    title: "Edsger Dijkstra",
    url: "https://example.org/dijkstra",
    status: "published",
    visibility: "public",
  });

  const privatePost = await services.posts.create({
    format: "note",
    slug: "secret-diary",
    title: "Secret Diary",
    bodyMarkdown: "Private keyword: xylophone-secret-token.",
    status: "published",
    visibility: "private",
  });

  const draftPost = await services.posts.create({
    format: "note",
    slug: "unpublished-draft",
    title: "Unpublished Draft",
    bodyMarkdown: "Draft keyword: zeppelin-draft-secret.",
    status: "draft",
    visibility: "public",
  });

  const d1 = createRoundTripD1(sqlite);
  const app = createApp();
  const env = {
    DB: d1.binding,
    SITE_ORIGIN: ORIGIN,
    AUTH_SECRET,
  } as unknown as Bindings;

  async function req(
    path: string,
    init: ConstructorParameters<typeof Request>[1] = {},
  ): Promise<Response> {
    return app.fetch(
      new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }),
      env,
      executionCtx,
    );
  }

  return {
    req,
    services,
    sessionCookie,
    essays,
    rootNote,
    replyNote,
    linkPost,
    quotePost,
    privatePost,
    draftPost,
  };
}

describe("AI agent-ready surface", () => {
  it("serves /.well-known discovery documents and HTML/HTTP Link discovery without Content-Signal", async () => {
    const { req } = await createAgentReadyTestSite();

    // 1. Agent Skills Discovery index (v0.2.0) with matching SHA-256 of /skill.md
    const [skillRes, skillsIndexRes] = await Promise.all([
      req("/skill.md"),
      req("/.well-known/agent-skills/index.json"),
    ]);
    expect(skillRes.status).toBe(200);
    expect(skillsIndexRes.status).toBe(200);
    const skillText = await skillRes.text();
    const expectedHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(skillText),
        ),
      ),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const indexJson = (await skillsIndexRes.json()) as {
      $schema: string;
      skills: Array<{
        name: string;
        type: string;
        url: string;
        digest: string;
      }>;
    };
    expect(indexJson.$schema).toContain("0.2.0");
    expect(indexJson.skills).toHaveLength(1);
    expect(indexJson.skills[0]?.name).toBe("jant-site");
    expect(indexJson.skills[0]?.url).toBe(`${ORIGIN}/skill.md`);
    expect(indexJson.skills[0]?.digest).toBe(`sha256:${expectedHash}`);

    // 2. RFC 9727 API catalog
    const catalogRes = await req("/.well-known/api-catalog");
    expect(catalogRes.status).toBe(200);
    expect(catalogRes.headers.get("content-type")).toContain(
      "application/linkset+json",
    );
    const catalog = (await catalogRes.json()) as {
      linkset: Array<{ anchor: string }>;
    };
    const anchors = catalog.linkset.map((e) => e.anchor);
    expect(anchors).toContain(`${ORIGIN}/api/mcp`);
    expect(anchors).toContain(`${ORIGIN}/api/public/mcp`);
    expect(anchors).toContain(`${ORIGIN}/api/public/threads`);

    // 3. RFC 9728 + RFC 8414 OAuth metadata
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
    ]) {
      const res = await req(path);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        resource: string;
        authorization_servers: string[];
      };
      expect(body.resource).toBe(`${ORIGIN}/api/mcp`);
      expect(body.authorization_servers).toEqual([ORIGIN]);
    }

    const asMetaRes = await req("/.well-known/oauth-authorization-server");
    expect(asMetaRes.status).toBe(200);
    const asMeta = (await asMetaRes.json()) as {
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint: string;
      code_challenge_methods_supported: string[];
    };
    expect(asMeta.authorization_endpoint).toBe(`${ORIGIN}/_/oauth/authorize`);
    expect(asMeta.token_endpoint).toBe(`${ORIGIN}/api/oauth/token`);
    expect(asMeta.registration_endpoint).toBe(`${ORIGIN}/api/oauth/register`);
    expect(asMeta.code_challenge_methods_supported).toContain("S256");

    // 4. Homepage HTML emits discovery Link header, Vary: Accept, <link rel="alternate" type="text/markdown">, and NO Content-Signal
    const homeHtmlRes = await req("/", {
      headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    expect(homeHtmlRes.status).toBe(200);
    expect(homeHtmlRes.headers.get("content-type")).toContain("text/html");
    expect(homeHtmlRes.headers.get("vary")).toContain("Accept");
    expect(homeHtmlRes.headers.get("content-signal")).toBeNull();
    const linkHeader = homeHtmlRes.headers.get("link") ?? "";
    expect(linkHeader).toContain('rel="agent-skills"');
    expect(linkHeader).toContain('rel="api-catalog"');
    expect(linkHeader).toContain('rel="describedby"');
    expect(linkHeader).toContain(
      '</latest.md>; rel="alternate"; type="text/markdown"',
    );
    const homeHtml = await homeHtmlRes.text();
    expect(homeHtml).toContain(
      '<link rel="alternate" type="text/markdown" href="/latest.md"/>',
    );
  });

  it("serves native Markdown via Accept: text/markdown and explicit .md routes across posts, threads, collections, and /llms.txt", async () => {
    const { req } = await createAgentReadyTestSite();

    // Accept: text/markdown on homepage
    const homeMdRes = await req("/", {
      headers: { Accept: "text/markdown, text/html;q=0.9" },
    });
    expect(homeMdRes.status).toBe(200);
    expect(homeMdRes.headers.get("content-type")).toContain("text/markdown");
    expect(homeMdRes.headers.get("vary")).toContain("Accept");
    expect(Number(homeMdRes.headers.get("x-markdown-tokens"))).toBeGreaterThan(
      0,
    );
    const homeMd = await homeMdRes.text();
    expect(homeMd).toContain('site: "Garden Notes"');
    expect(homeMd).toContain(`skill: "${ORIGIN}/skill.md"`);
    expect(homeMd).toContain(`llms: "${ORIGIN}/llms.txt"`);
    expect(homeMd).toContain("Hello AI Agents");

    // Default Accept: */* still serves HTML (zero breaking change)
    const wildcardRes = await req("/", { headers: { Accept: "*/*" } });
    expect(wildcardRes.headers.get("content-type")).toContain("text/html");

    // Full Thread via explicit /{slug}.md
    const postMdRes = await req("/hello-agents.md");
    expect(postMdRes.status).toBe(200);
    expect(postMdRes.headers.get("content-type")).toContain("text/markdown");
    const postMd = await postMdRes.text();
    expect(postMd).toContain('format: "note"');
    expect(postMd).toContain("thread_posts: 2");
    expect(postMd).toContain("# Hello AI Agents");
    expect(postMd).toContain("Jant stores **clean Markdown** natively.");
    expect(postMd).toContain("## Reply 1");
    expect(postMd).toContain("Follow-up thought inside the same Thread.");

    // Link and Quote formats preserve semantics
    const linkMd = await (await req("/rfc-9727.md")).text();
    expect(linkMd).toContain('format: "link"');
    expect(linkMd).toContain(
      "# [RFC 9727 API Catalog](https://www.rfc-editor.org/rfc/rfc9727)",
    );

    const quoteMd = await (await req("/calm-quote.md")).text();
    expect(quoteMd).toContain('format: "quote"');
    expect(quoteMd).toContain("> Simplicity is prerequisite for reliability.");
    expect(quoteMd).toContain(
      "— [Edsger Dijkstra](https://example.org/dijkstra)",
    );
    // Commentary-free quote must not repeat quoteText as a plain paragraph
    expect(
      quoteMd.match(/Simplicity is prerequisite for reliability\./g)?.length,
    ).toBe(1);

    // Private and draft posts stay 404 to signed-out callers
    expect((await req("/secret-diary.md")).status).toBe(404);
    expect((await req("/unpublished-draft.md")).status).toBe(404);
    expect(
      (await req("/secret-diary", { headers: { Accept: "text/markdown" } }))
        .status,
    ).toBe(404);

    // Collections & static surface .md routes
    const collectionsMd = await (await req("/collections.md")).text();
    expect(collectionsMd).toContain("[Essays]");
    const essayColMd = await (await req("/essays.md")).text();
    expect(essayColMd).toContain("# Essays");
    expect(essayColMd).toContain("Hello AI Agents");
    expect((await req("/latest.md")).status).toBe(200);
    expect((await req("/featured.md")).status).toBe(200);
    expect((await req("/archive.md")).status).toBe(200);

    // /llms.txt brings everything together
    const llmsRes = await req("/llms.txt");
    expect(llmsRes.status).toBe(200);
    expect(llmsRes.headers.get("content-type")).toContain("text/markdown");
    const llms = await llmsRes.text();
    expect(llms).toContain("# Garden Notes");
    expect(llms).toContain("## Collections");
    expect(llms).toContain(`[Essays](${ORIGIN}/essays.md)`);
    expect(llms).toContain(`[Hello AI Agents](${ORIGIN}/hello-agents.md)`);
    expect(llms).toContain(`${ORIGIN}/api/public/mcp`);
    expect(llms).toContain(`[Site Skill](${ORIGIN}/skill.md)`);
    expect(llms).not.toContain("Secret Diary");
    expect(llms).not.toContain("Unpublished Draft");
  });

  it("lets existing custom URLs win over /llms.txt and .md fallbacks (1.0 compatibility)", async () => {
    const { req, services, rootNote } = await createAgentReadyTestSite();
    await services.customUrls.create({
      path: "llms.txt",
      targetType: "post",
      targetId: rootNote.id,
    });

    // When a custom URL claims `llms.txt`, it serves the user's content
    // instead of being shadowed by Jant's generated /llms.txt.
    const res = await req("/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Hello AI Agents");
  });

  it("exposes public collections, public search, and anonymous read-only MCP gated by PUBLIC_API_ENABLED", async () => {
    const { req, services } = await createAgentReadyTestSite();

    // Public collections
    const colsRes = await req("/api/public/collections");
    expect(colsRes.status).toBe(200);
    const colsJson = (await colsRes.json()) as {
      collections: Array<{ slug: string; threadCount: number }>;
    };
    expect(colsJson.collections.some((c) => c.slug === "essays")).toBe(true);

    const colRes = await req("/api/public/collections/essays");
    expect(colRes.status).toBe(200);
    const colJson = (await colRes.json()) as { slug: string; title: string };
    expect(colJson.title).toBe("Essays");

    // Public search excludes private & draft posts
    const searchPublicRes = await req("/api/public/search?q=Markdown");
    expect(searchPublicRes.status).toBe(200);
    const searchPublic = (await searchPublicRes.json()) as {
      results: Array<{ slug: string }>;
    };
    expect(searchPublic.results.map((r) => r.slug)).toContain("hello-agents");

    const searchPrivateRes = await req(
      "/api/public/search?q=xylophone-secret-token",
    );
    expect(searchPrivateRes.status).toBe(200);
    const searchPrivate = (await searchPrivateRes.json()) as {
      results: Array<{ slug: string }>;
    };
    expect(searchPrivate.results).toHaveLength(0);

    // Public read-only MCP without auth
    const mcpCall = async (method: string, params?: unknown) => {
      const res = await req("/api/public/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      return {
        status: res.status,
        json: (await res.json()) as Record<string, unknown>,
      };
    };

    const init = await mcpCall("initialize", {
      protocolVersion: "2025-06-18",
    });
    expect(init.status).toBe(200);

    const listTools = await mcpCall("tools/list");
    const tools = (listTools.json.result as { tools: Array<{ name: string }> })
      .tools;
    expect(tools.map((t) => t.name)).toEqual([
      "jant_public_threads_list",
      "jant_public_thread_get",
      "jant_public_collections_list",
      "jant_public_posts_search",
    ]);

    const threadRes = await mcpCall("tools/call", {
      name: "jant_public_thread_get",
      arguments: { slug: "hello-agents" },
    });
    const threadContent = (
      threadRes.json.result as {
        structuredContent: {
          posts: Array<{ slug: string; bodyMarkdown: string }>;
        };
      }
    ).structuredContent;
    expect(threadContent.posts).toHaveLength(2);
    expect(threadContent.posts[0]?.bodyMarkdown).toContain("clean Markdown");

    const publicSearchMcp = await mcpCall("tools/call", {
      name: "jant_public_posts_search",
      arguments: { q: "xylophone-secret-token" },
    });
    const mcpSearchData = (
      publicSearchMcp.json.result as {
        structuredContent: { count: number };
      }
    ).structuredContent;
    expect(mcpSearchData.count).toBe(0);

    // Disabling PUBLIC_API_ENABLED turns off all public API & public MCP routes
    await services.settings.set("PUBLIC_API_ENABLED", "false");
    expect((await req("/api/public/collections")).status).toBe(404);
    expect((await req("/api/public/search?q=Markdown")).status).toBe(404);
    expect(
      (
        await req("/api/public/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
        })
      ).status,
    ).toBe(404);
  });

  it("completes MCP OAuth 2.1 flow end-to-end with PKCE S256 and revocable API token", async () => {
    const { req, services, sessionCookie } = await createAgentReadyTestSite();

    // 1. Unauthenticated /api/mcp advertises RFC 9728 WWW-Authenticate challenge
    const unauthMcp = await req("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(unauthMcp.status).toBe(401);
    expect(unauthMcp.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="mcp"`,
    );

    // 2. Rejects unsafe redirect URI during registration
    const badReg = await req("/api/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Evil App",
        redirect_uris: ["http://evil.example/callback"],
      }),
    });
    expect(badReg.status).toBe(400);

    // 3. Registers a valid loopback PKCE client
    const redirectUri = "http://127.0.0.1:43210/callback";
    const regRes = await req("/api/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude Desktop",
        redirect_uris: [redirectUri],
      }),
    });
    expect(regRes.status).toBe(201);
    const regJson = (await regRes.json()) as {
      client_id: string;
      client_name: string;
    };
    expect(regJson.client_id).toMatch(/^ocl_/);

    const codeVerifier = "v".repeat(64);
    const codeChallenge = await computePkceS256Challenge(codeVerifier);
    const authQuery = new URLSearchParams({
      response_type: "code",
      client_id: regJson.client_id,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state: "xyz-state",
      scope: "mcp",
    });

    // 4. Signed-out authorize redirects to /signin?redirect=...
    const unauthAuthorize = await req(
      `/_/oauth/authorize?${authQuery.toString()}`,
    );
    expect(unauthAuthorize.status).toBe(302);
    expect(unauthAuthorize.headers.get("location")).toContain(
      "/signin?redirect=",
    );

    // 5. Signed-in authorize renders consent page with CSRF token
    const consentRes = await req(`/_/oauth/authorize?${authQuery.toString()}`, {
      headers: { Cookie: sessionCookie },
    });
    expect(consentRes.status).toBe(200);
    const consentHtml = await consentRes.text();
    expect(consentHtml).toContain("Claude Desktop");
    const csrfMatch = /name="csrf_token"\s+value="([^"]+)"/.exec(consentHtml);
    expect(csrfMatch?.[1]).toBeTruthy();
    const csrfToken = csrfMatch![1]!;

    // 6. Denying redirects back with error=access_denied
    const denyRes = await req("/_/oauth/authorize", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrf_token: csrfToken,
        client_id: regJson.client_id,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state: "xyz-state",
        scope: "mcp",
        decision: "deny",
      }).toString(),
    });
    expect(denyRes.status).toBe(302);
    const denyLocation = new URL(denyRes.headers.get("location")!);
    expect(denyLocation.searchParams.get("error")).toBe("access_denied");
    expect(denyLocation.searchParams.get("state")).toBe("xyz-state");

    // 7. Approving redirects back with single-use authorization code
    const approveRes = await req("/_/oauth/authorize", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrf_token: csrfToken,
        client_id: regJson.client_id,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state: "xyz-state",
        scope: "mcp",
        decision: "approve",
      }).toString(),
    });
    expect(approveRes.status).toBe(302);
    const approveLocation = new URL(approveRes.headers.get("location")!);
    const code = approveLocation.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(approveLocation.searchParams.get("state")).toBe("xyz-state");

    // 8. Exchange code with valid PKCE verifier mints a jnt_ Bearer token
    const tokenRes = await req("/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        client_id: regJson.client_id,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
    });
    expect(tokenRes.status).toBe(200);
    const tokenJson = (await tokenRes.json()) as {
      access_token: string;
      token_type: string;
      scope: string;
    };
    expect(tokenJson.access_token).toMatch(/^jnt_/);
    expect(tokenJson.token_type).toBe("Bearer");
    expect(tokenJson.scope).toBe("mcp");

    // 9. Replaying the same authorization code is rejected
    const replayRes = await req("/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        client_id: regJson.client_id,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
    });
    expect(replayRes.status).toBe(400);

    // 10. Issued token immediately authenticates /api/mcp and appears in API Tokens list
    const authMcpRes = await req("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(authMcpRes.status).toBe(200);

    const tokens = await services.apiTokens.list();
    expect(tokens.some((t) => t.name === "Claude Desktop (MCP)")).toBe(true);
  });
});
