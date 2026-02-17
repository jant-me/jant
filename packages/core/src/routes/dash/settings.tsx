/**
 * Dashboard Settings Routes
 *
 * Sub-pages: General, Appearance, Account
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../ui/layouts/DashLayout.js";
import { sse, dsRedirect, dsToast } from "../../lib/sse.js";
import { arrayBufferToBase64 } from "../../lib/favicon.js";
import {
  getSiteLanguage,
  getSiteName,
  getHomeDefaultView,
  getTimeZone,
  getSiteFooter,
  isNoIndex,
  getConfigFallback,
} from "../../lib/config.js";
import { SETTINGS_KEYS } from "../../lib/constants.js";
import { getAvailableThemes } from "../../lib/theme.js";
import { getMediaUrl, getPublicUrlForProvider } from "../../lib/image.js";
import { TIMEZONES } from "../../lib/timezones.js";
import { BUILTIN_FONT_THEMES } from "../../ui/font-themes.js";
import { GeneralContent } from "../../ui/dash/settings/GeneralContent.js";
import { AppearanceContent } from "../../ui/dash/settings/AppearanceContent.js";
import { AccountContent } from "../../ui/dash/settings/AccountContent.js";

/** Escape HTML special characters for safe insertion into HTML strings */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Env = { Bindings: Bindings; Variables: AppVariables };

export const settingsRoutes = new Hono<Env>();

// ===========================================================================
// General settings
// ===========================================================================

/** Resolve the avatar storage key to a URL */
async function resolveAvatarUrl(c: {
  var: { services: AppVariables["services"] };
  env: Bindings;
}): Promise<string> {
  const avatarKey = await c.var.services.settings.get("SITE_AVATAR");
  if (!avatarKey) return "";
  const publicUrl = getPublicUrlForProvider(
    c.env.STORAGE_DRIVER || "r2",
    c.env.R2_PUBLIC_URL,
    c.env.S3_PUBLIC_URL,
  );
  return getMediaUrl(avatarKey, publicUrl);
}

settingsRoutes.get("/", async (c) => {
  const { settings } = c.var.services;

  const dbSiteName = await settings.get("SITE_NAME");
  const dbSiteDescription = await settings.get("SITE_DESCRIPTION");
  const [siteLanguage, homeDefaultView, timeZone, siteFooter, noindex] =
    await Promise.all([
      getSiteLanguage(c),
      getHomeDefaultView(c),
      getTimeZone(c),
      getSiteFooter(c),
      isNoIndex(c),
    ]);

  const siteNameFallback = getConfigFallback(c, "SITE_NAME");
  const siteDescriptionFallback = getConfigFallback(c, "SITE_DESCRIPTION");

  const siteAvatarUrl = await resolveAvatarUrl(c);
  const showHeaderAvatar =
    (await settings.get("SHOW_HEADER_AVATAR")) === "true";

  const saved = c.req.query("saved") !== undefined;

  return c.html(
    <DashLayout
      c={c}
      title="Settings"
      siteName={dbSiteName || siteNameFallback}
      currentPath="/dash/settings"
      toast={saved ? { message: "Settings saved successfully." } : undefined}
    >
      <GeneralContent
        siteName={dbSiteName || ""}
        siteDescription={dbSiteDescription || ""}
        siteLanguage={siteLanguage}
        homeDefaultView={homeDefaultView}
        siteNameFallback={siteNameFallback}
        siteDescriptionFallback={siteDescriptionFallback}
        siteAvatarUrl={siteAvatarUrl}
        showHeaderAvatar={showHeaderAvatar}
        timeZone={timeZone}
        siteFooter={siteFooter}
        noindex={noindex}
        timezones={TIMEZONES}
      />
    </DashLayout>,
  );
});

settingsRoutes.post("/", async (c) => {
  const body = await c.req.json<{
    siteName: string;
    siteDescription: string;
    siteLanguage: string;
    homeDefaultView: string;
    timeZone: string;
  }>();

  const { settings } = c.var.services;

  const oldLanguage = (await settings.get("SITE_LANGUAGE")) ?? "en";

  if (body.siteName.trim()) {
    await settings.set("SITE_NAME", body.siteName.trim());
  } else {
    await settings.remove("SITE_NAME");
  }

  if (body.siteDescription.trim()) {
    await settings.set("SITE_DESCRIPTION", body.siteDescription.trim());
  } else {
    await settings.remove("SITE_DESCRIPTION");
  }

  await settings.set("SITE_LANGUAGE", body.siteLanguage);

  // Save homepage default view (only store if non-default)
  if (body.homeDefaultView === "featured") {
    await settings.set("HOME_DEFAULT_VIEW", body.homeDefaultView);
  } else {
    await settings.remove("HOME_DEFAULT_VIEW");
  }

  // Timezone
  if (body.timeZone && body.timeZone !== "UTC") {
    await settings.set("TIME_ZONE", body.timeZone);
  } else {
    await settings.remove("TIME_ZONE");
  }

  const languageChanged = oldLanguage !== body.siteLanguage;
  const displayName = body.siteName.trim() || getConfigFallback(c, "SITE_NAME");

  return sse(c, async (stream) => {
    if (languageChanged) {
      await stream.redirect("/dash/settings?saved");
    } else {
      const escaped = escapeHtml(displayName);
      await stream.patchElements(
        `<a id="site-name" href="/dash" class="font-semibold">${escaped}</a>`,
      );
      await stream.patchElements(`Settings - ${escaped}`, {
        mode: "inner",
        selector: "title",
      });
      await stream.toast("Settings saved successfully.");
      await stream.patchSignals({
        _orig_siteName: body.siteName,
        _orig_siteDescription: body.siteDescription,
        _orig_siteLanguage: body.siteLanguage,
        _orig_homeDefaultView: body.homeDefaultView,
        _orig_timeZone: body.timeZone,
        _generalDirty: false,
      });
    }
  });
});

settingsRoutes.post("/footer", async (c) => {
  const body = await c.req.json<{ siteFooter: string }>();
  const { settings } = c.var.services;

  if (body.siteFooter?.trim()) {
    await settings.set("SITE_FOOTER", body.siteFooter.trim());
  } else {
    await settings.remove("SITE_FOOTER");
  }

  return sse(c, async (stream) => {
    await stream.toast("Footer saved successfully.");
    await stream.patchSignals({
      _orig_siteFooter: body.siteFooter,
      _footerDirty: false,
    });
  });
});

settingsRoutes.post("/seo", async (c) => {
  const body = await c.req.json<{ noindex: string }>();
  const { settings } = c.var.services;

  // Checkbox "noindex" is the allow-indexing signal:
  // checked (value "true") = indexing allowed -> remove NOINDEX
  // unchecked (value "") = indexing blocked -> set NOINDEX=true
  if (body.noindex === "true") {
    await settings.remove("NOINDEX");
  } else {
    await settings.set("NOINDEX", "true");
  }

  return sse(c, async (stream) => {
    await stream.toast("SEO settings saved successfully.");
    await stream.patchSignals({
      _orig_noindex: body.noindex,
      _seoDirty: false,
    });
  });
});

// ===========================================================================
// Avatar upload & removal
// ===========================================================================

settingsRoutes.post("/avatar", async (c) => {
  const storage = c.var.storage;
  if (!storage) {
    return dsToast("Storage not configured.", "error");
  }

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return dsToast("No file provided.", "error");
  }

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ];
  if (!allowedTypes.includes(file.type)) {
    return dsToast("File type not allowed.", "error");
  }

  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    return dsToast("File too large (max 10MB).", "error");
  }

  const { uuidv7 } = await import("uuidv7");
  const ext = file.name.split(".").pop() || "bin";
  const id = uuidv7();
  const date = new Date();
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const filename = `${id}.${ext}`;
  const storageKey = `media/${year}/${month}/${filename}`;

  try {
    await storage.put(storageKey, file.stream(), {
      contentType: file.type,
    });

    await c.var.services.media.create({
      id,
      filename,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      storageKey,
      provider: c.env.STORAGE_DRIVER || "r2",
    });

    await c.var.services.settings.set("SITE_AVATAR", storageKey);

    // Store favicon variants as base64 in settings (small files, accessed every page load)
    const faviconFile = formData.get("favicon") as File | null;
    const appleTouchFile = formData.get("appleTouch") as File | null;

    if (faviconFile) {
      const b64 = arrayBufferToBase64(await faviconFile.arrayBuffer());
      await c.var.services.settings.set("SITE_FAVICON_ICO", b64);
    }

    if (appleTouchFile) {
      const b64 = arrayBufferToBase64(await appleTouchFile.arrayBuffer());
      await c.var.services.settings.set("SITE_FAVICON_APPLE_TOUCH", b64);
    }

    return dsRedirect("/dash/settings?saved");
  } catch {
    return dsToast("Upload failed. Please try again.", "error");
  }
});

settingsRoutes.post("/avatar/remove", async (c) => {
  await c.var.services.settings.remove("SITE_AVATAR");
  await c.var.services.settings.remove("SITE_FAVICON_ICO");
  await c.var.services.settings.remove("SITE_FAVICON_APPLE_TOUCH");
  return dsRedirect("/dash/settings?saved");
});

settingsRoutes.post("/avatar/display", async (c) => {
  const body = await c.req.json<{ showHeaderAvatar: string }>();
  const { settings } = c.var.services;

  if (body.showHeaderAvatar === "true") {
    await settings.set("SHOW_HEADER_AVATAR", "true");
  } else {
    await settings.remove("SHOW_HEADER_AVATAR");
  }

  return sse(c, async (stream) => {
    await stream.toast("Avatar display setting saved successfully.");
    await stream.patchSignals({
      _orig_showHeaderAvatar: body.showHeaderAvatar,
      _avatarDisplayDirty: false,
    });
  });
});

// ===========================================================================
// Appearance
// ===========================================================================

settingsRoutes.get("/appearance", async (c) => {
  const { settings } = c.var.services;
  const siteName = await getSiteName(c);
  const currentThemeId = (await settings.get(SETTINGS_KEYS.THEME)) ?? "default";
  const currentFontThemeId = (await settings.get("FONT_THEME")) ?? "default";
  const customCSS = (await settings.get(SETTINGS_KEYS.CUSTOM_CSS)) ?? "";
  const themes = getAvailableThemes(c.var.config);
  const saved = c.req.query("saved") !== undefined;

  return c.html(
    <DashLayout
      c={c}
      title="Settings"
      siteName={siteName}
      currentPath="/dash/settings"
      toast={saved ? { message: "Theme saved successfully." } : undefined}
    >
      <AppearanceContent
        themes={themes}
        currentThemeId={currentThemeId}
        fontThemes={BUILTIN_FONT_THEMES}
        currentFontThemeId={currentFontThemeId}
        customCSS={customCSS}
      />
    </DashLayout>,
  );
});

settingsRoutes.post("/appearance", async (c) => {
  const body = await c.req.json<{ theme: string }>();
  const { settings } = c.var.services;
  const themes = getAvailableThemes(c.var.config);

  const validTheme = themes.find((t) => t.id === body.theme);
  if (!validTheme) {
    return dsToast("Invalid theme selected.", "error");
  }

  if (validTheme.id === "default") {
    await settings.remove(SETTINGS_KEYS.THEME);
  } else {
    await settings.set(SETTINGS_KEYS.THEME, validTheme.id);
  }

  return dsRedirect("/dash/settings/appearance?saved");
});

settingsRoutes.post("/font-theme", async (c) => {
  const body = await c.req.json<{ fontTheme: string }>();
  const { settings } = c.var.services;

  const validFont = BUILTIN_FONT_THEMES.find((f) => f.id === body.fontTheme);
  if (!validFont) {
    return dsToast("Invalid font theme selected.", "error");
  }

  if (validFont.id === "default") {
    await settings.remove("FONT_THEME");
  } else {
    await settings.set("FONT_THEME", validFont.id);
  }

  return dsRedirect("/dash/settings/appearance?saved");
});

settingsRoutes.post("/custom-css", async (c) => {
  const body = await c.req.json<{ customCSS: string }>();
  const { settings } = c.var.services;

  const css = body.customCSS?.trim() ?? "";

  if (css) {
    await settings.set(SETTINGS_KEYS.CUSTOM_CSS, css);
  } else {
    await settings.remove(SETTINGS_KEYS.CUSTOM_CSS);
  }

  return dsToast("Custom CSS saved successfully.");
});

// ===========================================================================
// Account
// ===========================================================================

settingsRoutes.get("/account", async (c) => {
  const siteName = await getSiteName(c);
  const session = await c.var.auth.api.getSession({
    headers: c.req.raw.headers,
  });
  const userName = session?.user?.name ?? "";
  const saved = c.req.query("saved") !== undefined;

  return c.html(
    <DashLayout
      c={c}
      title="Settings"
      siteName={siteName}
      currentPath="/dash/settings"
      toast={saved ? { message: "Profile saved successfully." } : undefined}
    >
      <AccountContent userName={userName} />
    </DashLayout>,
  );
});

settingsRoutes.post("/account", async (c) => {
  const body = await c.req.json<{ userName: string }>();
  const name = body.userName?.trim();

  if (!name) {
    return dsToast("Name is required.", "error");
  }

  try {
    await c.var.auth.api.updateUser({
      body: { name },
      headers: c.req.raw.headers,
    });
  } catch {
    return dsToast("Failed to update profile.", "error");
  }

  return dsToast("Profile saved successfully.");
});

settingsRoutes.post("/password", async (c) => {
  const body = await c.req.json<{
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }>();

  if (body.newPassword !== body.confirmPassword) {
    return dsToast("Passwords do not match.", "error");
  }

  try {
    await c.var.auth.api.changePassword({
      body: {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        revokeOtherSessions: false,
      },
      headers: c.req.raw.headers,
    });
  } catch {
    return dsToast("Current password is incorrect.", "error");
  }

  return sse(c, async (stream) => {
    await stream.toast("Password changed successfully.");
    await stream.patchSignals({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
  });
});
