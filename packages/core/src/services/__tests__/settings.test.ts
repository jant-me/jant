import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { createSettingsService } from "../settings.js";
import type { Database } from "../../db/index.js";
import { MAX_SITE_FOOTER_LENGTH } from "../../types.js";

describe("SettingsService", () => {
  let db: Database;
  let settingsService: ReturnType<typeof createSettingsService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    settingsService = createSettingsService(db, DEFAULT_TEST_SITE_ID);
  });

  describe("get", () => {
    it("returns null for non-existent key", async () => {
      const result = await settingsService.get("SITE_NAME");
      expect(result).toBeNull();
    });

    it("returns value after set", async () => {
      await settingsService.set("SITE_NAME", "My Blog");
      const result = await settingsService.get("SITE_NAME");
      expect(result).toBe("My Blog");
    });
  });

  describe("set", () => {
    it("creates a new setting", async () => {
      await settingsService.set("SITE_NAME", "Test Site");
      const result = await settingsService.get("SITE_NAME");
      expect(result).toBe("Test Site");
    });

    it("updates existing setting (upsert)", async () => {
      await settingsService.set("SITE_NAME", "Original");
      await settingsService.set("SITE_NAME", "Updated");
      const result = await settingsService.get("SITE_NAME");
      expect(result).toBe("Updated");
    });

    it("normalizes legacy timezone values before storing", async () => {
      await settingsService.set("TIME_ZONE", "Beijing");
      const result = await settingsService.get("TIME_ZONE");
      expect(result).toBe("Asia/Shanghai");
    });

    it("preserves runtime-supported IANA zones and fixed offsets", async () => {
      await settingsService.set("TIME_ZONE", "America/Phoenix");
      expect(await settingsService.get("TIME_ZONE")).toBe("America/Phoenix");

      await settingsService.set("TIME_ZONE", "+08");
      expect(await settingsService.get("TIME_ZONE")).toBe("+08:00");
    });

    it("rejects unsupported timezone values", async () => {
      await expect(settingsService.set("TIME_ZONE", "+8")).rejects.toThrowError(
        "Choose a valid time zone.",
      );
    });
  });

  describe("getAll", () => {
    it("returns empty object when no settings exist", async () => {
      const result = await settingsService.getAll();
      expect(result).toEqual({});
    });

    it("returns all settings as key-value pairs", async () => {
      await settingsService.set("SITE_NAME", "My Blog");
      await settingsService.set("SITE_DESCRIPTION", "A cool blog");

      const result = await settingsService.getAll();
      expect(result).toEqual({
        SITE_NAME: "My Blog",
        SITE_DESCRIPTION: "A cool blog",
      });
    });
  });

  describe("setMany", () => {
    it("sets multiple values at once", async () => {
      await settingsService.setMany({
        SITE_NAME: "My Blog",
        SITE_DESCRIPTION: "Description",
      });

      expect(await settingsService.get("SITE_NAME")).toBe("My Blog");
      expect(await settingsService.get("SITE_DESCRIPTION")).toBe("Description");
    });

    it("skips undefined values", async () => {
      await settingsService.set("SITE_NAME", "Original");
      await settingsService.setMany({
        SITE_NAME: undefined,
        SITE_DESCRIPTION: "New",
      });

      expect(await settingsService.get("SITE_NAME")).toBe("Original");
      expect(await settingsService.get("SITE_DESCRIPTION")).toBe("New");
    });

    it("normalizes timezone values in bulk updates", async () => {
      await settingsService.setMany({
        TIME_ZONE: "Beijing",
      });

      expect(await settingsService.get("TIME_ZONE")).toBe("Asia/Shanghai");
    });

    it("trims site identity fields in bulk updates", async () => {
      await settingsService.setMany({
        SITE_NAME: "  My Blog  ",
      });

      expect(await settingsService.get("SITE_NAME")).toBe("My Blog");
    });

    it("rejects site footer values beyond the maximum length", async () => {
      await expect(
        settingsService.setMany({
          SITE_FOOTER: "x".repeat(MAX_SITE_FOOTER_LENGTH + 1),
        }),
      ).rejects.toThrow();
    });

    it("does not call transaction() for bulk updates on sqlite-family backends", async () => {
      const dbWithoutTransaction = db as Database & {
        transaction: () => Promise<never>;
      };
      const originalTransaction = dbWithoutTransaction.transaction.bind(db);
      dbWithoutTransaction.transaction = async () => {
        throw new Error("sqlite setMany() should not call transaction()");
      };

      try {
        await expect(
          settingsService.setMany({
            SITE_NAME: "My Blog",
            SITE_DESCRIPTION: "Description",
          }),
        ).resolves.toBeUndefined();
      } finally {
        dbWithoutTransaction.transaction = originalTransaction;
      }
    });
  });

  describe("remove", () => {
    it("removes a setting", async () => {
      await settingsService.set("SITE_NAME", "Test");
      await settingsService.remove("SITE_NAME");
      const result = await settingsService.get("SITE_NAME");
      expect(result).toBeNull();
    });

    it("does not throw when removing non-existent key", async () => {
      await expect(settingsService.remove("SITE_NAME")).resolves.not.toThrow();
    });
  });

  describe("updateGeneral", () => {
    const defaults = {
      siteName: "",
      siteDescription: "",
      siteFooter: "",
      siteLanguage: "en",
      showJantBrandingOnHome: false,
      mainRssFeed: "featured",
      timeZone: "UTC",
    };

    it("sets non-empty values", async () => {
      await settingsService.updateGeneral(
        { ...defaults, siteName: "My Blog", siteDescription: "A blog" },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(await settingsService.get("SITE_NAME")).toBe("My Blog");
      expect(await settingsService.get("SITE_DESCRIPTION")).toBe("A blog");
    });

    it("removes empty values", async () => {
      await settingsService.set("SITE_NAME", "Old Name");
      await settingsService.updateGeneral(
        { ...defaults, siteName: "" },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(await settingsService.get("SITE_NAME")).toBeNull();
    });

    it("trims whitespace from values", async () => {
      await settingsService.updateGeneral(
        { ...defaults, siteName: "  Trimmed  " },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(await settingsService.get("SITE_NAME")).toBe("Trimmed");
    });

    it("removes MAIN_RSS_FEED when set to default (featured)", async () => {
      await settingsService.set("MAIN_RSS_FEED", "latest");
      await settingsService.updateGeneral(
        { ...defaults, mainRssFeed: "featured" },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(await settingsService.get("MAIN_RSS_FEED")).toBeNull();
    });

    it("stores MAIN_RSS_FEED when set to latest", async () => {
      await settingsService.updateGeneral(
        { ...defaults, mainRssFeed: "latest" },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(await settingsService.get("MAIN_RSS_FEED")).toBe("latest");
    });

    it("removes TIME_ZONE when set to UTC", async () => {
      await settingsService.set("TIME_ZONE", "America/New_York");
      await settingsService.updateGeneral(
        { ...defaults, timeZone: "UTC" },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(await settingsService.get("TIME_ZONE")).toBeNull();
    });

    it("stores TIME_ZONE when non-default", async () => {
      await settingsService.updateGeneral(
        { ...defaults, timeZone: "America/New_York" },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(await settingsService.get("TIME_ZONE")).toBe("America/New_York");
    });

    it("detects language change", async () => {
      const result = await settingsService.updateGeneral(
        { ...defaults, siteLanguage: "zh-Hans" },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(result.languageChanged).toBe(true);
    });

    it("accepts a locale without a shipped catalog (e.g. Swedish)", async () => {
      const result = await settingsService.updateGeneral(
        { ...defaults, siteLanguage: "sv" },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(result.languageChanged).toBe(true);
      expect(await settingsService.get("SITE_LANGUAGE")).toBe("sv");
    });

    it("normalizes BCP 47 casing to canonical form", async () => {
      await settingsService.updateGeneral(
        { ...defaults, siteLanguage: "ZH-hans" },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(await settingsService.get("SITE_LANGUAGE")).toBe("zh-Hans");
    });

    it("rejects values that are not valid BCP 47 tags", async () => {
      await expect(
        settingsService.updateGeneral(
          { ...defaults, siteLanguage: "not a locale!!!" },
          { oldLanguage: "en", fallbackSiteName: "Jant" },
        ),
      ).rejects.toThrow(/BCP 47/i);
    });

    it("returns no language change when same", async () => {
      const result = await settingsService.updateGeneral(defaults, {
        oldLanguage: "en",
        fallbackSiteName: "Jant",
      });

      expect(result.languageChanged).toBe(false);
    });

    it("returns display name from siteName when non-empty", async () => {
      const result = await settingsService.updateGeneral(
        { ...defaults, siteName: "My Blog" },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(result.displayName).toBe("My Blog");
    });

    it("returns fallback display name when siteName is empty", async () => {
      const result = await settingsService.updateGeneral(defaults, {
        oldLanguage: "en",
        fallbackSiteName: "Jant",
      });

      expect(result.displayName).toBe("Jant");
    });

    it("stores footer when non-empty", async () => {
      await settingsService.updateGeneral(
        { ...defaults, siteFooter: "© 2026" },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(await settingsService.get("SITE_FOOTER")).toBe("© 2026");
    });

    it("removes footer when empty", async () => {
      await settingsService.set("SITE_FOOTER", "Old footer");
      await settingsService.updateGeneral(
        { ...defaults, siteFooter: "" },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(await settingsService.get("SITE_FOOTER")).toBeNull();
    });

    it("stores home branding when enabled", async () => {
      await settingsService.updateGeneral(
        { ...defaults, showJantBrandingOnHome: true },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(await settingsService.get("SHOW_JANT_BRANDING_ON_HOME")).toBe(
        "true",
      );
    });

    it("removes home branding when disabled", async () => {
      await settingsService.set("SHOW_JANT_BRANDING_ON_HOME", "true");
      await settingsService.updateGeneral(
        { ...defaults, showJantBrandingOnHome: false },
        { oldLanguage: "en", fallbackSiteName: "Jant" },
      );

      expect(
        await settingsService.get("SHOW_JANT_BRANDING_ON_HOME"),
      ).toBeNull();
    });
  });

  describe("onboarding", () => {
    it("returns false when onboarding is not complete", async () => {
      const result = await settingsService.isOnboardingComplete();
      expect(result).toBe(false);
    });

    it("returns true after completing onboarding", async () => {
      await settingsService.completeOnboarding();
      const result = await settingsService.isOnboardingComplete();
      expect(result).toBe(true);
    });
  });

  describe("grouped settings updates", () => {
    it("updates site fields and reports when the site name changed", async () => {
      const result = await settingsService.updateSiteSettings(
        {
          siteName: "New Name",
          siteDescription: "Updated description",
          siteFooter: "Updated footer",
        },
        {
          oldSiteName: "Old Name",
          fallbackSiteName: "Jant",
        },
      );

      expect(result.displayName).toBe("New Name");
      expect(result.siteNameChanged).toBe(true);
      expect(await settingsService.get("SITE_NAME")).toBe("New Name");
      expect(await settingsService.get("SITE_DESCRIPTION")).toBe(
        "Updated description",
      );
      expect(await settingsService.get("SITE_FOOTER")).toBe("Updated footer");
    });

    it("updates locale fields and reports when the language changed", async () => {
      const result = await settingsService.updateLocaleSettings(
        {
          siteLanguage: "zh-Hans",
          timeZone: "America/New_York",
        },
        {
          oldLanguage: "en",
        },
      );

      expect(result.languageChanged).toBe(true);
      expect(await settingsService.get("SITE_LANGUAGE")).toBe("zh-Hans");
      expect(await settingsService.get("TIME_ZONE")).toBe("America/New_York");
    });

    // The Language and General pages each own part of this group, so an absent
    // field has to mean "leave it alone" rather than "clear it".
    it("leaves out-of-scope fields untouched", async () => {
      await settingsService.set("SITE_LANGUAGE", "ja");
      await settingsService.set("TIME_ZONE", "Asia/Tokyo");

      await settingsService.updateLocaleSettings(
        { timeZone: "America/New_York" },
        { oldLanguage: "ja" },
      );
      expect(await settingsService.get("SITE_LANGUAGE")).toBe("ja");

      await settingsService.updateLocaleSettings(
        { siteLanguage: "en" },
        { oldLanguage: "ja" },
      );
      expect(await settingsService.get("TIME_ZONE")).toBe("America/New_York");
    });

    it("stores the base locale when language input is blank", async () => {
      const result = await settingsService.updateLocaleSettings(
        {
          siteLanguage: "",
          timeZone: "UTC",
        },
        {
          oldLanguage: "sv",
        },
      );

      expect(result.languageChanged).toBe(true);
      expect(await settingsService.get("SITE_LANGUAGE")).toBe("en");
    });

    it("stores a valid dashboard language and reports the change", async () => {
      const result = await settingsService.updateLocaleSettings(
        {
          siteLanguage: "fr",
          dashboardLanguage: "zh-Hant",
          timeZone: "UTC",
        },
        { oldLanguage: "fr", oldDashboardLanguage: "" },
      );

      expect(result.languageChanged).toBe(true);
      expect(await settingsService.get("SITE_LANGUAGE")).toBe("fr");
      expect(await settingsService.get("DASHBOARD_LANGUAGE")).toBe("zh-Hant");
    });

    it("clears DASHBOARD_LANGUAGE when dashboard language is blank", async () => {
      await settingsService.set("DASHBOARD_LANGUAGE", "zh-Hans");
      await settingsService.updateLocaleSettings(
        {
          siteLanguage: "en",
          dashboardLanguage: "",
          timeZone: "UTC",
        },
        { oldLanguage: "en", oldDashboardLanguage: "zh-Hans" },
      );

      expect(await settingsService.get("DASHBOARD_LANGUAGE")).toBeNull();
    });

    it("leaves DASHBOARD_LANGUAGE untouched when not provided", async () => {
      await settingsService.set("DASHBOARD_LANGUAGE", "zh-Hans");
      await settingsService.updateLocaleSettings(
        { siteLanguage: "en", cjkSerifFont: "off", timeZone: "UTC" },
        { oldLanguage: "en" },
      );

      expect(await settingsService.get("DASHBOARD_LANGUAGE")).toBe("zh-Hans");
    });

    it("rejects a dashboard language Jant is not translated into", async () => {
      await expect(
        settingsService.updateLocaleSettings(
          {
            siteLanguage: "en",
            dashboardLanguage: "fr",
            timeZone: "UTC",
          },
          { oldLanguage: "en" },
        ),
      ).rejects.toThrow();
    });

    it("updates grouped feed, home, and search settings independently", async () => {
      await settingsService.updateFeedSettings({ mainRssFeed: "latest" });
      await settingsService.updateHomeBranding(true);
      await settingsService.updateSearchSettings(false, { demoMode: false });

      expect(await settingsService.get("MAIN_RSS_FEED")).toBe("latest");
      expect(await settingsService.get("SHOW_JANT_BRANDING_ON_HOME")).toBe(
        "true",
      );
      expect(await settingsService.get("NOINDEX")).toBe("true");

      await settingsService.updateSearchSettings(true, { demoMode: false });
      expect(await settingsService.get("NOINDEX")).toBeNull();

      await settingsService.updateHomeBranding(false);
      expect(
        await settingsService.get("SHOW_JANT_BRANDING_ON_HOME"),
      ).toBeNull();
    });
  });
});
