import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "../../__tests__/helpers/db.js";
import { createSettingsService } from "../../services/settings.js";
import type { Database } from "../../db/index.js";
import {
  getConfig,
  getHomeDefaultView,
  getConfigFallback,
  getTimeZone,
  getSiteFooter,
  isNoIndex,
} from "../config.js";
import type { Context } from "hono";

function createMockContext(
  services: { settings: ReturnType<typeof createSettingsService> },
  env: Record<string, string> = {},
): Context {
  return {
    env,
    var: { services },
  } as unknown as Context;
}

describe("getConfig", () => {
  let db: Database;
  let settingsService: ReturnType<typeof createSettingsService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    settingsService = createSettingsService(db);
  });

  it("returns default value when no DB or ENV value exists", async () => {
    const c = createMockContext({ settings: settingsService });
    const result = await getConfig(c, "HOME_DEFAULT_VIEW");
    expect(result).toBe("latest");
  });

  it("returns DB value when set", async () => {
    await settingsService.set("HOME_DEFAULT_VIEW", "featured");
    const c = createMockContext({ settings: settingsService });
    const result = await getConfig(c, "HOME_DEFAULT_VIEW");
    expect(result).toBe("featured");
  });

  it("returns env value when DB is empty", async () => {
    const c = createMockContext(
      { settings: settingsService },
      {
        HOME_DEFAULT_VIEW: "featured",
      },
    );
    const result = await getConfig(c, "HOME_DEFAULT_VIEW");
    expect(result).toBe("featured");
  });

  it("DB value takes precedence over env value", async () => {
    await settingsService.set("HOME_DEFAULT_VIEW", "featured");
    const c = createMockContext(
      { settings: settingsService },
      {
        HOME_DEFAULT_VIEW: "latest",
      },
    );
    const result = await getConfig(c, "HOME_DEFAULT_VIEW");
    expect(result).toBe("featured");
  });
});

describe("getHomeDefaultView", () => {
  let db: Database;
  let settingsService: ReturnType<typeof createSettingsService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    settingsService = createSettingsService(db);
  });

  it("returns 'latest' by default", async () => {
    const c = createMockContext({ settings: settingsService });
    const result = await getHomeDefaultView(c);
    expect(result).toBe("latest");
  });

  it("returns 'featured' when set in DB", async () => {
    await settingsService.set("HOME_DEFAULT_VIEW", "featured");
    const c = createMockContext({ settings: settingsService });
    const result = await getHomeDefaultView(c);
    expect(result).toBe("featured");
  });
});

describe("getTimeZone", () => {
  let db: Database;
  let settingsService: ReturnType<typeof createSettingsService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    settingsService = createSettingsService(db);
  });

  it("returns 'UTC' by default", async () => {
    const c = createMockContext({ settings: settingsService });
    const result = await getTimeZone(c);
    expect(result).toBe("UTC");
  });

  it("returns DB value when set", async () => {
    await settingsService.set("TIME_ZONE", "Beijing");
    const c = createMockContext({ settings: settingsService });
    const result = await getTimeZone(c);
    expect(result).toBe("Beijing");
  });
});

describe("getSiteFooter", () => {
  let db: Database;
  let settingsService: ReturnType<typeof createSettingsService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    settingsService = createSettingsService(db);
  });

  it("returns empty string by default", async () => {
    const c = createMockContext({ settings: settingsService });
    const result = await getSiteFooter(c);
    expect(result).toBe("");
  });

  it("returns DB value when set", async () => {
    await settingsService.set("SITE_FOOTER", "**Footer text**");
    const c = createMockContext({ settings: settingsService });
    const result = await getSiteFooter(c);
    expect(result).toBe("**Footer text**");
  });
});

describe("isNoIndex", () => {
  let db: Database;
  let settingsService: ReturnType<typeof createSettingsService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    settingsService = createSettingsService(db);
  });

  it("returns false by default", async () => {
    const c = createMockContext({ settings: settingsService });
    const result = await isNoIndex(c);
    expect(result).toBe(false);
  });

  it("returns true when NOINDEX is set to 'true'", async () => {
    await settingsService.set("NOINDEX", "true");
    const c = createMockContext({ settings: settingsService });
    const result = await isNoIndex(c);
    expect(result).toBe(true);
  });

  it("returns false when NOINDEX is set to other value", async () => {
    await settingsService.set("NOINDEX", "false");
    const c = createMockContext({ settings: settingsService });
    const result = await isNoIndex(c);
    expect(result).toBe(false);
  });
});

describe("DEFAULT_THEME", () => {
  it("returns 'halloween' by default", () => {
    const c = createMockContext({
      settings: {} as ReturnType<typeof createSettingsService>,
    });
    const result = getConfigFallback(c, "DEFAULT_THEME");
    expect(result).toBe("halloween");
  });

  it("returns env value when DEFAULT_THEME is set", () => {
    const c = createMockContext(
      { settings: {} as ReturnType<typeof createSettingsService> },
      { DEFAULT_THEME: "panda" },
    );
    const result = getConfigFallback(c, "DEFAULT_THEME");
    expect(result).toBe("panda");
  });

  it("is envOnly so getConfig skips DB lookup", async () => {
    const c = createMockContext(
      { settings: {} as ReturnType<typeof createSettingsService> },
      { DEFAULT_THEME: "beach" },
    );
    const result = await getConfig(c, "DEFAULT_THEME");
    expect(result).toBe("beach");
  });
});

describe("getConfigFallback", () => {
  it("returns default when no env value", () => {
    const c = createMockContext({
      settings: {} as ReturnType<typeof createSettingsService>,
    });
    const result = getConfigFallback(c, "HOME_DEFAULT_VIEW");
    expect(result).toBe("latest");
  });

  it("returns env value when set", () => {
    const c = createMockContext(
      { settings: {} as ReturnType<typeof createSettingsService> },
      { HOME_DEFAULT_VIEW: "featured" },
    );
    const result = getConfigFallback(c, "HOME_DEFAULT_VIEW");
    expect(result).toBe("featured");
  });
});
