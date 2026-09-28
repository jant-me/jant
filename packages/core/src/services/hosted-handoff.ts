import { and, eq } from "drizzle-orm";
import type { Auth } from "../auth.js";
import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import {
  ConflictError,
  DomainError,
  ExternalServiceError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../lib/errors.js";
import {
  verifyHostedSsoToken,
  type HostedSsoClaims,
} from "../lib/hosted-sso.js";
import { createSiteMemberService } from "./site-member.js";

export interface HostedHandoffSession {
  sessionToken: string;
  userId: string;
  /** Whether the browser's existing session was kept instead of a new one. */
  reused: boolean;
}

/**
 * The browser a sign-in link was opened in.
 *
 * better-auth records the device on a session from the request of the auth
 * endpoint that creates it. The handoff creates its session outside any such
 * endpoint, so it has nothing to read them from, and every session it made
 * showed as "Unknown device". The route passes them in instead.
 */
export interface HostedHandoffClient {
  /** The `User-Agent` header, which the Sessions page turns into a device name. */
  userAgent: string;
  /** The client address, or `""` when none was reported. */
  ipAddress: string;
  /** The session token the browser already carries for this site, if any. */
  sessionToken?: string | null;
}

export interface HostedHandoffService {
  completeFromSignedToken(input: {
    currentSiteId: string;
    token: string;
    client: HostedHandoffClient;
  }): Promise<HostedHandoffSession>;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function getDisplayName(claims: HostedSsoClaims): string {
  const name = claims.name?.trim();
  return name && name.length > 0 ? name : claims.email;
}

export function createHostedHandoffService(
  db: Database,
  auth: Auth,
  options: {
    providerLabel?: string;
    schema?: DatabaseSchema;
    secret?: string;
  },
): HostedHandoffService {
  const databaseSchema = options.schema ?? sqliteSchemaBundle;
  const { account } = databaseSchema;
  const siteMembers = createSiteMemberService(db, databaseSchema);
  const providerLabel =
    options.providerLabel?.trim() || "the connected hosted account provider";

  return {
    async completeFromSignedToken(input) {
      if (!options.secret) {
        throw new NotFoundError("Hosted sign-in endpoint");
      }

      let claims: HostedSsoClaims;
      try {
        claims = await verifyHostedSsoToken(options.secret, input.token);
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }

        if (
          error instanceof Error &&
          error.message === "Hosted SSO token has expired."
        ) {
          throw new UnauthorizedError(
            `This sign-in link has expired. Return to ${providerLabel} and try again.`,
          );
        }

        throw new UnauthorizedError("Invalid sign-in link.");
      }

      if (claims.siteId !== input.currentSiteId) {
        throw new UnauthorizedError(
          "This sign-in link does not match the current site.",
        );
      }

      // Core has one level of access: every member can do everything the
      // owner can. Until roles mean something here, an admin or editor
      // signing in would get the owner's powers, so only the owner may.
      if (claims.role !== "owner") {
        throw new ForbiddenError(
          `Only the site's owner can sign in to it for now. Ask the owner in ${providerLabel}.`,
        );
      }

      const authContext = await auth.$context;

      // A sign-in link travels in a URL, so it can land in a log or a
      // history entry. It signs in once, then counts as expired: the reader
      // gets the same page, with the way back to the provider. The record
      // expires with the link.
      const usedIdentifier = `hosted-sso:${await sha256Hex(input.token)}`;
      if (
        await authContext.internalAdapter.findVerificationValue(usedIdentifier)
      ) {
        throw new UnauthorizedError(
          `This sign-in link has expired. Return to ${providerLabel} and try again.`,
        );
      }
      await authContext.internalAdapter.createVerificationValue({
        identifier: usedIdentifier,
        value: claims.sub,
        expiresAt: new Date(claims.exp * 1000),
      });
      const linkedAccount = await db
        .select({ userId: account.userId })
        .from(account)
        .where(
          and(
            eq(account.providerId, "jant-cloud"),
            eq(account.accountId, claims.sub),
          ),
        )
        .limit(1);

      let user =
        linkedAccount[0] &&
        (await authContext.internalAdapter.findUserById(
          linkedAccount[0].userId,
        ));

      if (!user) {
        const userByEmail = await authContext.internalAdapter.findUserByEmail(
          claims.email,
          {
            includeAccounts: true,
          },
        );

        if (userByEmail) {
          const conflictingCloudLink = userByEmail.accounts.find(
            (existingAccount) =>
              existingAccount.providerId === "jant-cloud" &&
              existingAccount.accountId !== claims.sub,
          );

          if (conflictingCloudLink) {
            throw new ConflictError(
              `This email is already linked to another account in ${providerLabel}.`,
            );
          }

          user = await authContext.internalAdapter.updateUser(
            userByEmail.user.id,
            {
              email: claims.email,
              emailVerified: true,
              name: getDisplayName(claims),
            },
          );

          const existingPlatformLink = userByEmail.accounts.find(
            (existingAccount) =>
              existingAccount.providerId === "jant-cloud" &&
              existingAccount.accountId === claims.sub,
          );

          if (!existingPlatformLink) {
            await authContext.internalAdapter.createAccount({
              accountId: claims.sub,
              providerId: "jant-cloud",
              userId: user.id,
            });
          }
        } else {
          // The control plane vouched for this identity, the same way an
          // OAuth provider would, and the account below carries its ID.
          user = await authContext.internalAdapter.createUser(
            {
              email: claims.email,
              emailVerified: true,
              name: getDisplayName(claims),
              role: "member",
            },
            { method: "oauth", oauth: { providerId: "jant-cloud" } },
          );

          await authContext.internalAdapter.createAccount({
            accountId: claims.sub,
            providerId: "jant-cloud",
            userId: user.id,
          });
        }
      } else {
        user = await authContext.internalAdapter.updateUser(user.id, {
          email: claims.email,
          emailVerified: true,
          name: getDisplayName(claims),
        });
      }

      await siteMembers.ensure(input.currentSiteId, user.id, claims.role);

      const { client } = input;
      const device = {
        userAgent: client.userAgent,
        ipAddress: client.ipAddress,
      };

      // Opening the site from the provider again, in a browser already signed
      // in as the same person, keeps that browser's session. Every open used to
      // mint another one, and the Sessions page filled up with the same
      // browser. The row is read from the database rather than taken from the
      // request's session, which better-auth may answer from a cookie cache for
      // minutes after the session was revoked.
      const existing = client.sessionToken
        ? await authContext.internalAdapter.findSession(client.sessionToken)
        : null;
      if (
        existing &&
        existing.session.userId === user.id &&
        new Date(existing.session.expiresAt).getTime() > Date.now()
      ) {
        // A session made before the handoff recorded devices has none; this
        // browser is the one holding it, so it can say what it is.
        if (!existing.session.userAgent && device.userAgent) {
          await authContext.internalAdapter.updateSession(
            existing.session.token,
            device,
          );
        }
        return {
          sessionToken: existing.session.token,
          userId: user.id,
          reused: true,
        };
      }

      const session = await authContext.internalAdapter.createSession(
        user.id,
        false,
        device,
      );
      if (!session) {
        throw new ExternalServiceError("Failed to create a site session.");
      }

      return {
        sessionToken: session.token,
        userId: user.id,
        reused: false,
      };
    },
  };
}
