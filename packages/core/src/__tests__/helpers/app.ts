/**
 * Test App Helper
 *
 * Creates a minimal Hono app with services wired up for route testing.
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { createTestDatabase, DEFAULT_TEST_SITE_ID } from "./db.js";
import type { Database } from "../../db/index.js";
import type BetterSqlite3 from "better-sqlite3";
import {
  errorHandler,
  notFoundHandler,
} from "../../middleware/error-handler.js";
import { createI18n } from "../../i18n/i18n.js";
import { DEFAULT_APP_PORT } from "../../lib/env.js";
import { createMemoryRateLimiter } from "../../lib/rate-limit-memory.js";
import { resolveConfig } from "../../lib/resolve-config.js";
import type { StorageDriver } from "../../lib/storage.js";
import type { HostedHandoffService } from "../../services/hosted-handoff.js";
import { createServices } from "../../services/index.js";
import { sqliteSchemaBundle } from "../../db/schema-bundle.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

interface TestAppOptions {
  /** If true, all requests are treated as authenticated */
  authenticated?: boolean;
  /** Enable FTS for search tests */
  fts?: boolean;
  /** Enable public demo restrictions in appConfig */
  demoMode?: boolean;
  /** Optional storage driver for upload/settings route tests */
  storage?: StorageDriver | null;
  /** Optional internal admin token for internal API route tests */
  internalAdminToken?: string;
  /** Optional site resolution mode override */
  siteResolutionMode?: "single-site" | "host-based";
  /** Optional hosted SSO secret binding */
  hostedControlPlaneSsoSecret?: string;
  /** Optional hosted handoff service override */
  hostedHandoff?: HostedHandoffService;
  /** Optional `TELEGRAM_BOT_TOKENS` env binding for Telegram webhook tests */
  telegramBotTokens?: string;
  /** Optional `TELEGRAM_WEBHOOK_SECRET` env binding for Telegram webhook tests */
  telegramWebhookSecret?: string;
  /** RSS publication delay; defaults to zero in general route tests. */
  rssPublishDelaySeconds?: number;
  /** `SITE_PATH_PREFIX`, such as `/blog`; none by default. */
  sitePathPrefix?: string;
  /** More environment bindings, as an operator would set them. */
  env?: Partial<Record<keyof Bindings, string>>;
}

/**
 * Creates a test Hono app with real services backed by in-memory SQLite.
 * Returns the app and service instances for assertions.
 */
export function createTestApp(options: TestAppOptions = {}) {
  const testDb = createTestDatabase({ fts: options.fts });
  const db = testDb.db as unknown as Database;
  const sqlite = testDb.sqlite;

  // Create a mock D1 for search service
  const mockD1 = createMockD1(sqlite);

  const servicesConfig = {
    slugIdLength: 5,
    siteResolutionMode: options.siteResolutionMode ?? "single-site",
  };
  const servicesForSite = (siteId: string) =>
    createServices(db, mockD1, siteId, servicesConfig);
  const services = servicesForSite(DEFAULT_TEST_SITE_ID);

  // Fresh limiter per test app so counters don't leak between tests.
  const rateLimiter = createMemoryRateLimiter();

  const app = new Hono<Env>();

  // Global error handler: maps DomainError → HTTP responses
  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  // Inject env bindings and services middleware
  app.use("*", async (c, next) => {
    // Provide mock env bindings so c.env.* works in route handlers
    c.env = {
      SITE_ORIGIN: `http://localhost:${DEFAULT_APP_PORT}`,
      SITE_PATH_PREFIX: options.sitePathPrefix ?? "",
      DEMO_MODE: options.demoMode ? "true" : "false",
      INTERNAL_ADMIN_TOKEN: options.internalAdminToken,
      HOSTED_CONTROL_PLANE_SSO_SECRET: options.hostedControlPlaneSsoSecret,
      TELEGRAM_BOT_TOKENS: options.telegramBotTokens,
      TELEGRAM_WEBHOOK_SECRET: options.telegramWebhookSecret,
      RSS_PUBLISH_DELAY_SECONDS: options.rssPublishDelaySeconds ?? 0,
      NODE_DATABASE: {
        db,
        dialect: "sqlite",
        rawQuery: mockD1,
        schema: sqliteSchemaBundle,
      },
      SITE_RESOLUTION_MODE: options.siteResolutionMode,
      ...options.env,
    } as AppVariables["services"] extends never ? never : Bindings;

    c.set("services", services as AppVariables["services"]);
    c.set(
      "servicesForSite",
      servicesForSite as AppVariables["servicesForSite"],
    );
    c.set(
      "hostedHandoff",
      options.hostedHandoff ??
        ({
          async completeFromSignedToken() {
            return {
              sessionToken: "test-session-token",
              userId: "test-user",
            };
          },
        } as HostedHandoffService),
    );
    c.set("currentSite", {
      id: DEFAULT_TEST_SITE_ID,
      key: "default",
      status: "active",
      createdAt: 0,
      updatedAt: 0,
    });
    c.set("currentSiteDomain", null);
    const allSettings = await services.settings.getAll();
    c.set("allSettings", allSettings);
    c.set("appConfig", resolveConfig(c.env, allSettings));
    c.set("storage", options.storage ?? null);
    c.set("rateLimiter", rateLimiter);
    const publicRequestUrl = c.req.url;
    c.set("publicRequestUrl", publicRequestUrl);
    c.set("publicPath", new URL(publicRequestUrl).pathname);

    // i18n (English default for tests)
    const i18n = createI18n("en");
    c.set("lang", "en");
    c.set("i18n", i18n);

    if (options.authenticated) {
      await services.siteMembers.ensure(
        DEFAULT_TEST_SITE_ID,
        "test-user",
        "owner",
      );
      const session = {
        user: { id: "test-user", email: "test@test.com", name: "Test" },
        session: { id: "test-session" },
      } as unknown as AppVariables["session"];
      // Mock auth that always returns a session
      c.set("auth", {
        api: {
          getSession: async () => session,
        },
      } as AppVariables["auth"]);
      // Mirror what `attachSession` middleware would produce in production.
      c.set("session", session);
      c.set("isAuthenticated", true);
    } else {
      c.set("auth", {
        api: {
          getSession: async () => null,
        },
      } as AppVariables["auth"]);
      c.set("session", null);
      c.set("isAuthenticated", false);
    }

    await next();
  });

  return { app, services, db, sqlite };
}

function createMockD1(sqliteDb: BetterSqlite3.Database) {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async all<T>() {
              const stmt = sqliteDb.prepare(query);
              const rows = stmt.all(...(params as never[])) as T[];
              return { results: rows };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}
