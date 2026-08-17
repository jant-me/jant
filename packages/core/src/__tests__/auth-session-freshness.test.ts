import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createAuth } from "../auth.js";
import { createTestDatabase } from "./helpers/db.js";
import { session as sessionTable } from "../db/schema.js";

/**
 * better-auth gates `list-sessions` behind a "fresh session" check whose
 * default window is 24 hours, measured from `session.createdAt` — a value
 * renewal never moves. Jant deliberately runs 90-day rolling sessions, so
 * without `freshAge: 0` the Sessions page answers "Session is not fresh"
 * forever from the second day of a sign-in onwards.
 */
async function signUpAndGetCookie(auth: ReturnType<typeof createAuth>) {
  const signUp = await auth.api.signUpEmail({
    body: {
      name: "Owner",
      email: "owner@example.com",
      password: "correct-horse-battery",
    },
    returnHeaders: true,
  });
  const token = signUp.headers
    .getSetCookie()
    .find((cookie) => cookie.includes(".session_token="));
  expect(token).toBeDefined();
  // Send only the session token, not the `session_data` cache cookie: a cache
  // hit short-circuits before the database read this test is about.
  return token!.split(";")[0]!;
}

describe("session freshness", () => {
  it("lists sessions that are older than better-auth's default fresh window", async () => {
    const { db } = createTestDatabase();
    const auth = createAuth(db, {
      secret: "test-secret-with-enough-entropy-for-session-cookies",
      baseURL: "https://example.com",
      useSecureCookies: true,
    });
    const cookie = await signUpAndGetCookie(auth);

    const [row] = await db.select().from(sessionTable);
    expect(row).toBeDefined();
    // Two days old: past the 24-hour default, well inside the 90-day window.
    await db
      .update(sessionTable)
      .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
      .where(eq(sessionTable.id, row!.id));

    const sessions = await auth.api.listSessions({
      headers: new Headers({ cookie }),
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.token).toBe(row!.token);
  });
});
