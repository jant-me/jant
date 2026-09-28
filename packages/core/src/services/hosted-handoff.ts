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
}

export interface HostedHandoffService {
  completeFromSignedToken(input: {
    currentSiteId: string;
    token: string;
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
          user = await authContext.internalAdapter.createUser({
            email: claims.email,
            emailVerified: true,
            name: getDisplayName(claims),
            role: "member",
          });

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

      const session = await authContext.internalAdapter.createSession(
        user.id,
        false,
      );
      if (!session) {
        throw new ExternalServiceError("Failed to create a site session.");
      }

      return {
        sessionToken: session.token,
        userId: user.id,
      };
    },
  };
}
