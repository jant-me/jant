import { describe, expect, it } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { createAuth } from "../../auth.js";
import type { Database } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { account, session, siteMembers, user } from "../../db/schema.js";
import {
  signHostedSsoToken,
  type HostedSsoClaims,
} from "../../lib/hosted-sso.js";
import { createHostedHandoffService } from "../hosted-handoff.js";

const HOSTED_SSO_SECRET = "cloud-sso-secret-cloud-sso-secret";

const BROWSER = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  ipAddress: "203.0.113.7",
};

async function seedExistingAdmin(db: Database) {
  const createdAt = new Date();
  const timestamp = Math.floor(Date.now() / 1000);

  await db.insert(user).values({
    id: "usr_01kmbaseadmin000000000000",
    name: "Existing Admin",
    email: "admin@example.com",
    emailVerified: true,
    role: "admin",
    createdAt,
    updatedAt: createdAt,
  });

  await db.insert(account).values({
    id: "acc_01kmbaseadmin000000000000",
    userId: "usr_01kmbaseadmin000000000000",
    accountId: "admin@example.com",
    providerId: "credential",
    password: "hashed-password",
    createdAt,
    updatedAt: createdAt,
  });

  await db.insert(siteMembers).values({
    siteId: DEFAULT_TEST_SITE_ID,
    userId: "usr_01kmbaseadmin000000000000",
    role: "owner",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function createHostedClaims(
  overrides?: Partial<HostedSsoClaims>,
): HostedSsoClaims {
  const now = Math.floor(Date.now() / 1000);

  return {
    aud: "jant-core",
    email: "owner@example.com",
    exp: now + 300,
    iat: now,
    iss: "jant-cloud",
    name: "Owner",
    role: "owner",
    siteId: DEFAULT_TEST_SITE_ID,
    sub: "clu_01kmbasecloud000000000000",
    ...overrides,
  };
}

describe("HostedHandoffService", () => {
  it("provisions a linked user even when public registration is closed", async () => {
    const testDb = createTestDatabase();
    const db = testDb.db as unknown as Database;

    await seedExistingAdmin(db);

    const auth = createAuth(db, {
      allowSystemUserProvisioning: true,
      secret: "test-auth-secret",
      baseURL: "http://127.0.0.1:3000",
      useSecureCookies: false,
    });
    const hostedHandoff = createHostedHandoffService(db, auth, {
      secret: HOSTED_SSO_SECRET,
    });
    const token = await signHostedSsoToken(
      HOSTED_SSO_SECRET,
      createHostedClaims(),
    );

    const result = await hostedHandoff.completeFromSignedToken({
      currentSiteId: DEFAULT_TEST_SITE_ID,
      token,
      client: BROWSER,
    });

    const linkedUser = await db.query.user.findFirst({
      where: (fields, { eq }) => eq(fields.email, "owner@example.com"),
    });
    const linkedAccount = await db.query.account.findFirst({
      where: (fields, { and, eq }) =>
        and(
          eq(fields.providerId, "jant-cloud"),
          eq(fields.accountId, "clu_01kmbasecloud000000000000"),
        ),
    });
    const membership = await db.query.siteMembers.findFirst({
      where: (fields, { and, eq }) =>
        and(
          eq(fields.siteId, DEFAULT_TEST_SITE_ID),
          eq(fields.userId, result.userId),
        ),
    });
    const createdSession = await db.query.session.findFirst({
      where: (fields, { eq }) => eq(fields.token, result.sessionToken),
    });

    expect(linkedUser?.id).toBe(result.userId);
    expect(linkedUser?.role).toBe("member");
    expect(linkedUser?.emailVerified).toBe(true);
    expect(linkedAccount?.userId).toBe(result.userId);
    expect(membership?.role).toBe("owner");
    expect(createdSession?.userId).toBe(result.userId);
  });

  it("signs in once per link and refuses the same link again", async () => {
    const testDb = createTestDatabase();
    const db = testDb.db as unknown as Database;
    const auth = createAuth(db, {
      allowSystemUserProvisioning: true,
      secret: "test-auth-secret",
      baseURL: "http://127.0.0.1:3000",
      useSecureCookies: false,
    });
    const hostedHandoff = createHostedHandoffService(db, auth, {
      secret: HOSTED_SSO_SECRET,
    });
    const token = await signHostedSsoToken(
      HOSTED_SSO_SECRET,
      createHostedClaims(),
    );

    await hostedHandoff.completeFromSignedToken({
      currentSiteId: DEFAULT_TEST_SITE_ID,
      token,
      client: BROWSER,
    });

    await expect(
      hostedHandoff.completeFromSignedToken({
        currentSiteId: DEFAULT_TEST_SITE_ID,
        token,
        client: BROWSER,
      }),
    ).rejects.toThrow("This sign-in link has expired.");
  });

  it("lets only the owner sign in while core has no roles", async () => {
    const testDb = createTestDatabase();
    const db = testDb.db as unknown as Database;
    const auth = createAuth(db, {
      allowSystemUserProvisioning: true,
      secret: "test-auth-secret",
      baseURL: "http://127.0.0.1:3000",
      useSecureCookies: false,
    });
    const hostedHandoff = createHostedHandoffService(db, auth, {
      secret: HOSTED_SSO_SECRET,
    });
    const token = await signHostedSsoToken(
      HOSTED_SSO_SECRET,
      createHostedClaims({ role: "editor" }),
    );

    await expect(
      hostedHandoff.completeFromSignedToken({
        currentSiteId: DEFAULT_TEST_SITE_ID,
        token,
        client: BROWSER,
      }),
    ).rejects.toThrow("Only the site's owner");
  });

  describe("sessions", () => {
    /** A handoff whose every call signs a fresh one-use link for the owner. */
    function setUp() {
      const testDb = createTestDatabase();
      const db = testDb.db as unknown as Database;
      const auth = createAuth(db, {
        allowSystemUserProvisioning: true,
        secret: "test-auth-secret",
        baseURL: "http://127.0.0.1:3000",
        useSecureCookies: false,
      });
      const hostedHandoff = createHostedHandoffService(db, auth, {
        secret: HOSTED_SSO_SECRET,
      });
      let issued = 0;
      const signIn = async (
        client: Parameters<
          typeof hostedHandoff.completeFromSignedToken
        >[0]["client"],
        claims?: Partial<HostedSsoClaims>,
      ) => {
        issued += 1;
        const token = await signHostedSsoToken(
          HOSTED_SSO_SECRET,
          createHostedClaims({
            iat: Math.floor(Date.now() / 1000) - issued,
            ...claims,
          }),
        );
        return hostedHandoff.completeFromSignedToken({
          currentSiteId: DEFAULT_TEST_SITE_ID,
          token,
          client,
        });
      };
      const findSession = (token: string) =>
        db.query.session.findFirst({
          where: (fields, { eq }) => eq(fields.token, token),
        });
      const countSessions = async () =>
        (await db.query.session.findMany()).length;
      return { db, signIn, findSession, countSessions };
    }

    // The Sessions page names a device from its user agent. The handoff made
    // its sessions outside any better-auth endpoint, where better-auth has no
    // request to read one from, so every hosted sign-in showed "Unknown device".
    it("records the browser on a new session", async () => {
      const { signIn, findSession } = setUp();

      const result = await signIn(BROWSER);

      expect(result.reused).toBe(false);
      const session = await findSession(result.sessionToken);
      expect(session?.userAgent).toBe(BROWSER.userAgent);
      expect(session?.ipAddress).toBe(BROWSER.ipAddress);
    });

    it("keeps the session a browser already holds for the same person", async () => {
      const { signIn, countSessions } = setUp();
      const first = await signIn(BROWSER);

      const second = await signIn({
        ...BROWSER,
        sessionToken: first.sessionToken,
      });

      expect(second.reused).toBe(true);
      expect(second.sessionToken).toBe(first.sessionToken);
      expect(await countSessions()).toBe(1);
    });

    it("names the device on a kept session that recorded none", async () => {
      const { signIn, findSession } = setUp();
      const first = await signIn({ userAgent: "", ipAddress: "" });
      expect((await findSession(first.sessionToken))?.userAgent).toBe("");

      await signIn({ ...BROWSER, sessionToken: first.sessionToken });

      const session = await findSession(first.sessionToken);
      expect(session?.userAgent).toBe(BROWSER.userAgent);
      expect(session?.ipAddress).toBe(BROWSER.ipAddress);
    });

    it("starts a new session when the one the browser holds was revoked", async () => {
      const { db, signIn, countSessions } = setUp();
      const first = await signIn(BROWSER);
      await db.delete(session).where(eq(session.token, first.sessionToken));

      const second = await signIn({
        ...BROWSER,
        sessionToken: first.sessionToken,
      });

      expect(second.reused).toBe(false);
      expect(second.sessionToken).not.toBe(first.sessionToken);
      expect(await countSessions()).toBe(1);
    });

    it("starts a new session when the one the browser holds has expired", async () => {
      const { db, signIn } = setUp();
      const first = await signIn(BROWSER);
      await db
        .update(session)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(session.token, first.sessionToken));

      const second = await signIn({
        ...BROWSER,
        sessionToken: first.sessionToken,
      });

      expect(second.reused).toBe(false);
      expect(second.sessionToken).not.toBe(first.sessionToken);
    });

    it("never hands over a session that belongs to someone else", async () => {
      const { db, signIn } = setUp();
      await seedExistingAdmin(db);
      const createdAt = new Date();
      await db.insert(session).values({
        id: "ses_01kmbaseadmin000000000000",
        userId: "usr_01kmbaseadmin000000000000",
        token: "someone-elses-session",
        expiresAt: new Date(Date.now() + 3600_000),
        ipAddress: "",
        userAgent: "",
        createdAt,
        updatedAt: createdAt,
      });

      const result = await signIn({
        ...BROWSER,
        sessionToken: "someone-elses-session",
      });

      expect(result.reused).toBe(false);
      expect(result.sessionToken).not.toBe("someone-elses-session");
    });
  });
});
