/**
 * Authentication with better-auth
 */

import { betterAuth, APIError } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "./db/index.js";
import type { DatabaseDialect } from "./db/dialect.js";
import { sqliteSchemaBundle, type DatabaseSchema } from "./db/schema-bundle.js";
import { AUTH_ID_PREFIX, createTypeId } from "./lib/ids.js";
import { hashPassword, verifyPassword } from "./lib/password.js";

export function createAuth(
  db: Database,
  options: {
    allowSystemUserProvisioning?: boolean;
    secret: string;
    baseURL: string;
    useSecureCookies: boolean;
    databaseDialect?: DatabaseDialect;
    schema?: DatabaseSchema;
  },
) {
  const schema = options.schema ?? sqliteSchemaBundle;
  const allowSystemUserProvisioning =
    options.allowSystemUserProvisioning ?? false;

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: options.databaseDialect === "pg" ? "pg" : "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    secret: options.secret,
    baseURL: options.baseURL,
    advanced: {
      useSecureCookies: options.useSecureCookies,
      database: {
        generateId: ({ model }) => {
          switch (model) {
            case "user":
              return createTypeId(AUTH_ID_PREFIX.user);
            case "session":
              return createTypeId(AUTH_ID_PREFIX.session);
            case "account":
              return createTypeId(AUTH_ID_PREFIX.account);
            case "verification":
              return createTypeId(AUTH_ID_PREFIX.verification);
            default:
              return false;
          }
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
    },
    session: {
      // An idle window, not a hard cap. `attachSession` writes better-auth's
      // re-issued cookie back to the browser, so any visit inside the window
      // pushes both the stored session and the cookie out another 90 days —
      // a single author on their own machine should effectively never be
      // asked to sign in again.
      expiresIn: 3600 * 24 * 90, // 90 days
      // How stale a session may get before a read renews it. Same as
      // better-auth's default, but stated here because it sets the renewal
      // cadence and that shouldn't be invisible library behaviour.
      updateAge: 3600 * 24, // 1 day
      // Turns off better-auth's re-authentication gate, whose default lets a
      // session read `/list-sessions` only within 24 hours of sign-in — and it
      // measures that from `createdAt`, which renewal never moves, so the
      // Sessions page would answer "Session is not fresh" from day two onward.
      // The gate also guards nothing here: revoking a session, the destructive
      // half of that page, is not behind it, and the endpoints that would care
      // (delete-user, unlink-account) are not part of Jant.
      freshAge: 0,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (userData) => {
            const isSystemProvisionedMember =
              allowSystemUserProvisioning &&
              userData.role === "member" &&
              userData.emailVerified === true;

            if (isSystemProvisionedMember) {
              return { data: userData };
            }

            const existing = await db
              .select({ id: schema.user.id })
              .from(schema.user)
              .limit(1);
            if (existing.length > 0) {
              throw new APIError("FORBIDDEN", {
                message: "Registration is closed.",
              });
            }
            return { data: { ...userData, role: "admin" } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
