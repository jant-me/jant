import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { sqliteSchemaBundle } from "../../db/schema-bundle.js";
import { createRequestRuntime } from "../index.js";
import { createNodeCliRuntime, createNodeRequestRuntime } from "../node.js";
import type { CliSiteSelector } from "../site.js";
import type { Bindings } from "../../types.js";
import { siteDomains, sites } from "../../db/schema.js";
import {
  ConflictError,
  NotFoundError,
  SiteUnavailableError,
} from "../../lib/errors.js";
import { TRANSIENT_SINGLE_SITE_ID } from "../../services/site.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function createSqliteRawQuery(
  sqlite: ReturnType<typeof createTestDatabase>["sqlite"],
) {
  return {
    prepare(query: string) {
      let params: unknown[] = [];

      return {
        bind(...nextParams: unknown[]) {
          params = nextParams;
          return this;
        },
        async all<T>() {
          return {
            results: sqlite.prepare(query).all(...params) as T[],
          };
        },
      };
    },
  };
}

describe("createNodeRequestRuntime", () => {
  it("builds services/auth/storage from NODE_SQLITE bindings", async () => {
    const { sqlite } = createTestDatabase({ fts: true });

    const runtime = await createNodeRequestRuntime(
      {
        NODE_SQLITE: sqlite,
        AUTH_SECRET: "test-secret",
        SITE_ORIGIN: "http://localhost:3000",
        STORAGE_DRIVER: "local",
        LOCAL_STORAGE_PATH: "/tmp/jant-node-runtime-test",
      } as Bindings,
      "http://localhost:3000/healthz",
    );

    expect(runtime.storage).not.toBeNull();
    expect(runtime.services.posts).toBeDefined();
    expect(runtime.auth.api).toBeDefined();
  });

  it("supports post creation through the Node runtime database adapter", async () => {
    const { sqlite } = createTestDatabase();

    const runtime = await createNodeRequestRuntime(
      {
        NODE_SQLITE: sqlite,
        AUTH_SECRET: "test-secret-with-enough-entropy-for-node-runtime",
        SITE_ORIGIN: "http://localhost:3000",
        STORAGE_DRIVER: "local",
        LOCAL_STORAGE_PATH: "/tmp/jant-node-runtime-test",
      } as Bindings,
      "http://localhost:3000/compose",
    );

    const post = await runtime.services.posts.create({
      format: "note",
      bodyMarkdown: "hello from node runtime",
    });

    expect(post.id).toBeTruthy();
    expect(post.body).toContain("hello from node runtime");
  });

  it("treats NODE_DATABASE bindings as the Node runtime path", async () => {
    const { db, sqlite } = createTestDatabase();

    const runtime = await createRequestRuntime(
      {
        NODE_DATABASE: {
          db,
          dialect: "sqlite",
          rawQuery: createSqliteRawQuery(sqlite),
          schema: sqliteSchemaBundle,
        },
        AUTH_SECRET: "test-secret-with-enough-entropy-for-node-runtime",
        SITE_ORIGIN: "http://localhost:3000",
        STORAGE_DRIVER: "local",
        LOCAL_STORAGE_PATH: "/tmp/jant-node-runtime-test",
      } as Bindings,
      "http://localhost:3000/compose",
    );

    expect(runtime.currentSite.id).toBeTruthy();
    expect(runtime.services.posts).toBeDefined();
  });

  it("uses a transient site during setup instead of bootstrapping immediately", async () => {
    const { db, sqlite } = createTestDatabase();

    await db.delete(siteDomains);
    await db.delete(sites);

    const runtime = await createNodeRequestRuntime(
      {
        NODE_DATABASE: {
          db,
          dialect: "sqlite",
          rawQuery: createSqliteRawQuery(sqlite),
          schema: sqliteSchemaBundle,
        },
        AUTH_SECRET: "test-secret-with-enough-entropy-for-node-runtime",
        SITE_ORIGIN: "http://localhost:3000",
        STORAGE_DRIVER: "local",
        LOCAL_STORAGE_PATH: "/tmp/jant-node-runtime-test",
      } as Bindings,
      "http://localhost:3000/setup",
    );

    const count = sqlite
      .prepare('SELECT COUNT(*) as count FROM "site"')
      .get() as { count: number };

    expect(runtime.currentSite.id).toBe(TRANSIENT_SINGLE_SITE_ID);
    expect(count.count).toBe(0);
  });

  it("disables managed site creation in single-site mode", async () => {
    const { db, sqlite } = createTestDatabase();

    const runtime = await createRequestRuntime(
      {
        NODE_DATABASE: {
          db,
          dialect: "sqlite",
          rawQuery: createSqliteRawQuery(sqlite),
          schema: sqliteSchemaBundle,
        },
        AUTH_SECRET: "test-secret-with-enough-entropy-for-node-runtime",
        SITE_ORIGIN: "http://localhost:3000",
      } as Bindings,
      "http://localhost:3000/api/internal/sites",
    );

    await expect(
      runtime.services.siteAdmin.createManagedSite({
        key: "demo-cloud",
        primaryHost: "demo-cloud.example.com",
        siteName: "Demo Cloud",
      }),
    ).rejects.toEqual(
      new ConflictError(
        "Managed site operations are only available in host-based mode.",
      ),
    );

    const count = sqlite
      .prepare('SELECT COUNT(*) as count FROM "site"')
      .get() as { count: number };

    expect(count.count).toBe(1);
  });

  it("allows host-based internal admin requests before any site matches the host", async () => {
    const { db, sqlite } = createTestDatabase();

    const runtime = await createRequestRuntime(
      {
        NODE_DATABASE: {
          db,
          dialect: "sqlite",
          rawQuery: createSqliteRawQuery(sqlite),
          schema: sqliteSchemaBundle,
        },
        AUTH_SECRET: "test-secret-with-enough-entropy-for-node-runtime",
        SITE_RESOLUTION_MODE: "host-based",
      } as Bindings,
      "http://internal-admin.local/api/internal/sites",
    );

    expect(runtime.currentSite.id).toBe(TRANSIENT_SINGLE_SITE_ID);
    expect(runtime.currentSite.key).toBe("internal");
    expect(runtime.services.siteAdmin).toBeDefined();
  });

  it("treats unknown host-based public hosts as site not found", async () => {
    const { db, sqlite } = createTestDatabase();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      createRequestRuntime(
        {
          NODE_DATABASE: {
            db,
            dialect: "sqlite",
            rawQuery: createSqliteRawQuery(sqlite),
            schema: sqliteSchemaBundle,
          },
          AUTH_SECRET: "test-secret-with-enough-entropy-for-node-runtime",
          SITE_RESOLUTION_MODE: "host-based",
        } as Bindings,
        "http://missing.localtest.me/",
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(consoleError).toHaveBeenCalledWith(
      "[Jant] Hosted site resolution failed: host=missing.localtest.me path=/ reason=host-not-found",
    );
  });

  it("treats suspended host-based sites as unavailable, not missing", async () => {
    const { db, sqlite } = createTestDatabase();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    sqlite
      .prepare(
        `
          INSERT INTO site_domain (id, site_id, host, path_prefix, kind, redirect_to_primary, created_at, updated_at)
          VALUES ('std_suspended_1', ?, 'suspended.localtest.me', NULL, 'primary', 1, 1774200001, 1774200001)
        `,
      )
      .run(DEFAULT_TEST_SITE_ID);

    sqlite
      .prepare(`UPDATE site SET status = 'suspended' WHERE id = ?`)
      .run(DEFAULT_TEST_SITE_ID);

    await expect(
      createRequestRuntime(
        {
          NODE_DATABASE: {
            db,
            dialect: "sqlite",
            rawQuery: createSqliteRawQuery(sqlite),
            schema: sqliteSchemaBundle,
          },
          AUTH_SECRET: "test-secret-with-enough-entropy-for-node-runtime",
          SITE_RESOLUTION_MODE: "host-based",
        } as Bindings,
        "http://suspended.localtest.me/",
      ),
    ).rejects.toBeInstanceOf(SiteUnavailableError);
    expect(consoleError).toHaveBeenCalledWith(
      "[Jant] Hosted site resolution failed: host=suspended.localtest.me path=/ reason=site-not-active siteId=sit_test00000000000000000000000 siteKey=default siteStatus=suspended",
    );
  });
});

describe("createNodeCliRuntime", () => {
  const OTHER_SITE_ID = "sit_other0000000000000000000000";

  function nodeDatabaseBindings(
    testDb: ReturnType<typeof createTestDatabase>,
    env: Partial<Bindings> = {},
  ): Bindings {
    return {
      NODE_DATABASE: {
        db: testDb.db,
        dialect: "sqlite",
        rawQuery: createSqliteRawQuery(testDb.sqlite),
        schema: sqliteSchemaBundle,
      },
      ...env,
    } as Bindings;
  }

  /** The default test site plus a second tenant on its own host. */
  function createDatabaseWithTwoSites() {
    const testDb = createTestDatabase();
    testDb.sqlite
      .prepare(
        `
          INSERT INTO site (id, key, status, created_at, updated_at)
          VALUES (?, 'other', 'active', 1774200001, 1774200001)
        `,
      )
      .run(OTHER_SITE_ID);
    testDb.sqlite
      .prepare(
        `
          INSERT INTO site_domain (id, site_id, host, path_prefix, kind, redirect_to_primary, created_at, updated_at)
          VALUES ('std_other_1', ?, 'other.localtest.me', NULL, 'primary', 1, 1774200001, 1774200001)
        `,
      )
      .run(OTHER_SITE_ID);
    return testDb;
  }

  // A hosted database holds every tenant, so there is no "only site" to fall
  // back to. The single-site lookup would blame SITE_RESOLUTION_MODE, which is
  // already host-based; the CLI has to say which flag picks the site.
  it("requires a site selector in host-based mode with several sites", async () => {
    const testDb = createDatabaseWithTwoSites();

    await expect(
      createNodeCliRuntime(
        nodeDatabaseBindings(testDb, { SITE_RESOLUTION_MODE: "host-based" }),
      ),
    ).rejects.toThrow(
      "host-based mode needs a target site. Pass --site <key|id>, --host <host>, or --url <url>.",
    );
  });

  it.each<[string, CliSiteSelector]>([
    ["key", { kind: "site", idOrKey: "other" }],
    ["id", { kind: "site", idOrKey: OTHER_SITE_ID }],
    ["host", { kind: "host", host: "other.localtest.me", pathPrefix: null }],
  ])(
    "scopes a host-based runtime to the site selected by %s",
    async (_label, selector) => {
      const testDb = createDatabaseWithTwoSites();

      const runtime = await createNodeCliRuntime(
        nodeDatabaseBindings(testDb, { SITE_RESOLUTION_MODE: "host-based" }),
        selector,
      );
      await runtime.services.settings.set("PASSWORD_RESET_TOKEN", "hash:1");

      expect(runtime.currentSite.id).toBe(OTHER_SITE_ID);
      expect(runtime.currentSiteDomain?.host).toBe("other.localtest.me");
      expect(
        testDb.sqlite
          .prepare(
            `SELECT site_id FROM site_setting WHERE key = 'PASSWORD_RESET_TOKEN'`,
          )
          .pluck()
          .all(),
      ).toEqual([OTHER_SITE_ID]);
    },
  );

  it("names the selector that matched no site", async () => {
    const testDb = createDatabaseWithTwoSites();
    const env = nodeDatabaseBindings(testDb, {
      SITE_RESOLUTION_MODE: "host-based",
    });

    await expect(
      createNodeCliRuntime(env, { kind: "site", idOrKey: "missing" }),
    ).rejects.toThrow("No site found for --site missing.");
    await expect(
      createNodeCliRuntime(env, {
        kind: "host",
        host: "other.localtest.me",
        pathPrefix: "/blog",
      }),
    ).rejects.toThrow(
      'No site found for host "other.localtest.me" and path prefix "/blog".',
    );
  });

  it("uses the instance's one site in single-site mode", async () => {
    const runtime = await createNodeCliRuntime(
      nodeDatabaseBindings(createTestDatabase()),
    );

    expect(runtime.currentSite.id).toBe(DEFAULT_TEST_SITE_ID);
  });

  // Here the single-site error is the accurate one: the database really does
  // belong to a host-based install.
  it("reports a multi-site database in single-site mode as misconfigured", async () => {
    await expect(
      createNodeCliRuntime(nodeDatabaseBindings(createDatabaseWithTwoSites())),
    ).rejects.toThrow("single-site mode found multiple sites in the database:");
  });
});
