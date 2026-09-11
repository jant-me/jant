import { describe, expect, it, vi } from "vitest";
import {
  parseCliSiteSelector,
  resolveCliSite,
} from "../../../bin/lib/site-selection.js";

function createSiteRow(id, key) {
  return {
    id,
    key,
    status: "active",
    created_at: 1774134096,
    updated_at: 1774134096,
  };
}

const HOST_BASED_ENV = { SITE_RESOLUTION_MODE: "host-based" };

describe("CLI site selection", () => {
  it("resolves a host-scoped site in host-based mode", async () => {
    const query = vi.fn(async (sql) => {
      if (sql.includes('FROM "site_domain"')) {
        return [createSiteRow("sit_demo", "demo")];
      }

      return [];
    });

    const resolved = await resolveCliSite(
      {
        query,
      },
      {
        env: HOST_BASED_ENV,
        host: "demo.jant.blog",
      },
    );

    expect(resolved.site.id).toBe("sit_demo");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("resolves a URL selector with path prefix", async () => {
    const query = vi.fn(async (sql) => {
      if (
        sql.includes('FROM "site_domain"') &&
        sql.includes(`"site_domain"."path_prefix" = '/base'`)
      ) {
        return [createSiteRow("sit_demo", "demo")];
      }

      return [];
    });

    const resolved = await resolveCliSite(
      {
        query,
      },
      {
        env: HOST_BASED_ENV,
        url: "https://demo.jant.blog/base/",
      },
    );

    expect(resolved.site.key).toBe("demo");
  });

  it("resolves --site by key or by id", async () => {
    const sites = [
      createSiteRow("sit_one", "one"),
      createSiteRow("sit_two", "two"),
    ];
    const query = vi.fn(async (sql) =>
      sites.filter(
        (site) =>
          sql.includes(`"id" = '${site.id}'`) ||
          sql.includes(`"key" = '${site.key}'`),
      ),
    );

    const byKey = await resolveCliSite(
      { query },
      { env: HOST_BASED_ENV, site: "two" },
    );
    const byId = await resolveCliSite(
      { query },
      { env: HOST_BASED_ENV, site: "sit_one" },
    );

    expect(byKey.site.id).toBe("sit_two");
    expect(byId.site.id).toBe("sit_one");
  });

  // Unreachable through the managed API, whose keys cannot contain `_`, but a
  // hand-edited row must not make `--site` pick a tenant by accident.
  it("prefers the id match when a key equals another site's id", async () => {
    const query = vi.fn(async () => [
      createSiteRow("sit_other", "sit_target"),
      createSiteRow("sit_target", "target"),
    ]);

    const resolved = await resolveCliSite(
      { query },
      { env: HOST_BASED_ENV, site: "sit_target" },
    );

    expect(resolved.site.key).toBe("target");
  });

  it("names the --site value that matched nothing", async () => {
    const query = vi.fn(async () => []);

    await expect(
      resolveCliSite({ query }, { env: HOST_BASED_ENV, site: "missing" }),
    ).rejects.toThrow("No site found for --site missing.");
  });

  // A hosted database holds every tenant. Falling back to "the only site"
  // would work until the day a second tenant signs up, so host-based mode
  // never guesses — it fails before running a single query.
  it("requires a site flag in host-based mode, however many sites exist", async () => {
    const query = vi.fn(async () => [createSiteRow("sit_only", "only")]);

    await expect(
      resolveCliSite({ query }, { env: HOST_BASED_ENV }),
    ).rejects.toThrow(
      "host-based mode needs a target site. Pass --site <key|id>, --host <host>, or --url <url>.",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects more than one site flag instead of picking one", async () => {
    const query = vi.fn(async () => []);

    await expect(
      resolveCliSite(
        { query },
        { env: HOST_BASED_ENV, site: "one", host: "two.jant.blog" },
      ),
    ).rejects.toThrow("Choose only one of --site, --host, or --url.");
    expect(query).not.toHaveBeenCalled();
  });

  it("uses the only site in single-site mode", async () => {
    const query = vi.fn(async () => [createSiteRow("sit_only", "only")]);

    const resolved = await resolveCliSite(
      { query },
      { env: { SITE_RESOLUTION_MODE: "single-site" } },
    );

    expect(resolved.site.id).toBe("sit_only");
  });

  it("returns an actionable message for single-site multi-site instances", async () => {
    const query = vi.fn(async () => [
      createSiteRow("sit_one", "one"),
      createSiteRow("sit_two", "two"),
    ]);

    await expect(
      resolveCliSite(
        {
          query,
        },
        {
          env: {
            SITE_RESOLUTION_MODE: "single-site",
          },
        },
      ),
    ).rejects.toThrow(
      "single-site mode found multiple sites in the database: one (sit_one), two (sit_two). Restore SITE_RESOLUTION_MODE=host-based for this database, or remove the extra sites before restarting in single-site mode.",
    );
  });
});

describe("parseCliSiteSelector", () => {
  it("returns null when no site flag was passed", () => {
    expect(parseCliSiteSelector({ pathPrefix: "/blog" })).toBeNull();
  });

  it("reads --site as a key or id", () => {
    expect(parseCliSiteSelector({ site: " demo " })).toEqual({
      kind: "site",
      idOrKey: "demo",
    });
  });

  it("splits --url into its host and path prefix", () => {
    expect(parseCliSiteSelector({ url: "https://demo.jant.blog/" })).toEqual({
      kind: "host",
      host: "demo.jant.blog",
      pathPrefix: null,
    });
    expect(
      parseCliSiteSelector({ url: "https://demo.jant.blog/blog/" }),
    ).toEqual({
      kind: "host",
      host: "demo.jant.blog",
      pathPrefix: "/blog",
    });
  });

  it("pairs --host with --path-prefix", () => {
    expect(
      parseCliSiteSelector({ host: "demo.jant.blog", pathPrefix: "blog/" }),
    ).toEqual({
      kind: "host",
      host: "demo.jant.blog",
      pathPrefix: "/blog",
    });
  });

  it("rejects --url together with --host", () => {
    expect(() =>
      parseCliSiteSelector({
        host: "demo.jant.blog",
        url: "https://demo.jant.blog/",
      }),
    ).toThrow("Choose only one of --site, --host, or --url.");
  });
});
