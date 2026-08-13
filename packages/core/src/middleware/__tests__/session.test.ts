import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { attachSession } from "../session.js";
import { createAuth } from "../../auth.js";
import { createTestDatabase } from "../../__tests__/helpers/db.js";
import { session as sessionTable } from "../../db/schema.js";
import type { Bindings } from "../../types.js";
import type { AppSession, AppVariables } from "../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

function createAppWithAuth(mockAuth: AppVariables["auth"]): Hono<Env> {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("auth", mockAuth);
    await next();
  });
  app.use("*", attachSession());
  return app;
}

/**
 * `attachSession` calls `getSession` with `returnHeaders: true`, so the mock
 * has to answer in better-call's `{ headers, response }` shape.
 */
function buildSessionMock(
  impl: () => Promise<{ headers: Headers; response: AppSession }>,
): AppVariables["auth"] {
  return {
    api: { getSession: impl },
  } as unknown as AppVariables["auth"];
}

const VALID_SESSION = {
  user: { id: "user-1", email: "x@y.z", name: "X" },
  session: { id: "sess-1" },
} as unknown as AppSession;

function respondWith(
  response: AppSession,
  setCookies: string[] = [],
): () => Promise<{ headers: Headers; response: AppSession }> {
  return async () => {
    const headers = new Headers();
    for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
    return { headers, response };
  };
}

const REFRESHED_SESSION_COOKIE =
  "__Secure-better-auth.session_token=fresh; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax";

describe("attachSession", () => {
  it("populates c.var.session and isAuthenticated on a valid session", async () => {
    const app = createAppWithAuth(buildSessionMock(respondWith(VALID_SESSION)));
    app.get("/", (c) =>
      c.json({
        authed: c.var.isAuthenticated,
        userId: (c.var.session?.user as { id?: string } | undefined)?.id,
      }),
    );

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authed: true, userId: "user-1" });
  });

  it("sets isAuthenticated=false and session=null when no session is present", async () => {
    const app = createAppWithAuth(buildSessionMock(respondWith(null)));
    app.get("/", (c) =>
      c.json({ authed: c.var.isAuthenticated, session: c.var.session }),
    );

    const res = await app.request("/");
    expect(await res.json()).toEqual({ authed: false, session: null });
  });

  it("retries once so a blipping lookup does not present as a logout", async () => {
    let calls = 0;
    const app = createAppWithAuth(
      buildSessionMock(async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient database error");
        return { headers: new Headers(), response: VALID_SESSION };
      }),
    );
    app.get("/", (c) => c.json({ authed: c.var.isAuthenticated }));

    const res = await app.request("/");
    expect(calls).toBe(2);
    expect(await res.json()).toEqual({ authed: true });
  });

  it("swallows a persistent lookup failure and treats the request as unauthenticated", async () => {
    let calls = 0;
    const app = createAppWithAuth(
      buildSessionMock(async () => {
        calls += 1;
        throw new Error("session lookup failed");
      }),
    );
    app.get("/", (c) =>
      c.json({ authed: c.var.isAuthenticated, session: c.var.session }),
    );

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(await res.json()).toEqual({ authed: false, session: null });
  });

  it("writes better-auth's refreshed cookies onto the response", async () => {
    const app = createAppWithAuth(
      buildSessionMock(respondWith(VALID_SESSION, [REFRESHED_SESSION_COOKIE])),
    );
    app.get("/", (c) => c.json({ ok: true }));

    const res = await app.request("/");
    expect(res.headers.getSetCookie()).toEqual([REFRESHED_SESSION_COOKIE]);
  });

  it("never attaches cookies to a shared-cacheable response", async () => {
    const app = createAppWithAuth(
      buildSessionMock(respondWith(VALID_SESSION, [REFRESHED_SESSION_COOKIE])),
    );
    // Mirrors the media routes, which answer with a year-long public cache
    // directive. A session cookie stored alongside that response is handed to
    // whoever the CDN serves next.
    app.get("/media/x.png", (c) =>
      c.body("bytes", 200, {
        "Cache-Control": "public, max-age=31536000, immutable",
      }),
    );

    const res = await app.request("/media/x.png");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("attaches cookies to an explicitly private response", async () => {
    const app = createAppWithAuth(
      buildSessionMock(respondWith(VALID_SESSION, [REFRESHED_SESSION_COOKIE])),
    );
    app.get("/", (c) =>
      c.json({ ok: true }, 200, { "Cache-Control": "private, no-store" }),
    );

    const res = await app.request("/");
    expect(res.headers.getSetCookie()).toEqual([REFRESHED_SESSION_COOKIE]);
  });

  it("lets a route's own cookie win, so sign-out is not undone by the refresh", async () => {
    const cleared =
      "__Secure-better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
    const app = createAppWithAuth(
      buildSessionMock(respondWith(VALID_SESSION, [REFRESHED_SESSION_COOKIE])),
    );
    app.post("/signout", (c) => c.body(null, 302, { "Set-Cookie": cleared }));

    const res = await app.request("/signout", { method: "POST" });
    expect(res.headers.getSetCookie()).toEqual([cleared]);
  });
});

describe("attachSession with a real better-auth instance", () => {
  it("re-issues the session cookie so its browser lifetime rolls forward", async () => {
    const { db } = createTestDatabase();
    const auth = createAuth(db, {
      secret: "test-secret-with-enough-entropy-for-session-cookies",
      baseURL: "https://example.com",
      useSecureCookies: true,
    });

    const signUp = await auth.api.signUpEmail({
      body: {
        name: "Owner",
        email: "owner@example.com",
        password: "correct-horse-battery",
      },
      returnHeaders: true,
    });
    const signUpCookies = signUp.headers.getSetCookie();
    const sessionCookie = signUpCookies.find((cookie) =>
      cookie.includes(".session_token="),
    );
    expect(sessionCookie).toBeDefined();
    // Send only the session token, not the `session_data` cache cookie: that
    // one is written with `Max-Age=300`, so any request more than five minutes
    // after the last one arrives without it and takes the database path. A
    // cache hit deliberately short-circuits before any refresh.
    const cookieHeader = sessionCookie!.split(";")[0]!;

    // better-auth only re-issues the cookie once per `updateAge` (1 day). Age
    // the stored session past that threshold so this request is the one that
    // refreshes: with `expiresIn` at 90 days, any expiry inside the next 89
    // days is due.
    const rows = await db.select().from(sessionTable);
    expect(rows).toHaveLength(1);
    const due = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);
    await db
      .update(sessionTable)
      .set({ expiresAt: due })
      .where(eq(sessionTable.id, rows[0]!.id));

    const app = new Hono<Env>();
    app.use("*", async (c, next) => {
      c.set("auth", auth);
      await next();
    });
    app.use("*", attachSession());
    app.get("/", (c) => c.json({ authed: c.var.isAuthenticated }));

    const res = await app.request("/", { headers: { cookie: cookieHeader } });
    expect(await res.json()).toEqual({ authed: true });

    // The regression this guards: without `returnHeaders` the refreshed cookie
    // is dropped, so the browser copy keeps the expiry it was born with and
    // dies a fixed `expiresIn` after sign-in however active the user is.
    // Asserted against the aged-down 28 days rather than the configured window,
    // so this stays a test of "it rolls forward" and not of the current policy.
    const refreshed = res.headers
      .getSetCookie()
      .find((cookie) => cookie.includes(".session_token="));
    expect(refreshed).toBeDefined();
    expect(refreshed).toMatch(/Max-Age=\d+/);
    const maxAge = Number(/Max-Age=(\d+)/.exec(refreshed!)?.[1]);
    expect(maxAge).toBeGreaterThan(29 * 24 * 60 * 60);

    // And the database row rolled forward with it.
    const [after] = await db.select().from(sessionTable);
    expect(after!.expiresAt.getTime()).toBeGreaterThan(due.getTime());
  });
});
