import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { sqliteSchemaBundle } from "../../db/schema-bundle.js";
import { createRequestRuntime } from "../index.js";
import { createNodeRequestRuntime } from "../node.js";
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
