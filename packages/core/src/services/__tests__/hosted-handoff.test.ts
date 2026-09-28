import { describe, expect, it } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { createAuth } from "../../auth.js";
import type { Database } from "../../db/index.js";
import { account, siteMembers, user } from "../../db/schema.js";
import {
  signHostedSsoToken,
  type HostedSsoClaims,
} from "../../lib/hosted-sso.js";
import { createHostedHandoffService } from "../hosted-handoff.js";

const HOSTED_SSO_SECRET = "cloud-sso-secret-cloud-sso-secret";

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
    });

    await expect(
      hostedHandoff.completeFromSignedToken({
        currentSiteId: DEFAULT_TEST_SITE_ID,
        token,
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
      }),
    ).rejects.toThrow("Only the site's owner");
  });
});
