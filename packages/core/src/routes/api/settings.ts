/**
 * Settings API Routes
 */

import { parseLanguageList } from "../../i18n/locales.js";
import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuthApi } from "../../middleware/auth.js";
import { z } from "zod";
import { now } from "../../lib/time.js";
import { SETTINGS_KEYS } from "../../lib/constants.js";
import { parseValidated, readJsonBody } from "../../lib/schemas.js";
import {
  DomainError,
  ExternalServiceError,
  ValidationError,
} from "../../lib/errors.js";
import { requireStorage } from "../../lib/storage.js";
import { syncHostedControlPlaneSiteAvatar } from "../../lib/hosted-control-plane-sync.js";
import {
  buildApiSettingsResponse,
  demoLockedSettingKeys,
  isResettableConfigEditorKey,
  partitionApiSettingUpdates,
  partitionLanguageSettingUpdates,
} from "../../lib/api-settings.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const settingsApiRoutes = new Hono<Env>();

const UpdateSettingsSchema = z.record(z.string(), z.string());

// Get all settings (requires auth)
settingsApiRoutes.get("/", requireAuthApi(), async (c) => {
  const allSettings = await c.var.services.settings.getAll();
  return c.json({
    settings: buildApiSettingsResponse(
      allSettings,
      c.var.appConfig.demoMode,
      c.env,
    ),
  });
});

// Update settings (requires auth)
settingsApiRoutes.put("/", requireAuthApi(), async (c) => {
  const updates = parseValidated(UpdateSettingsSchema, await readJsonBody(c));
  const { filteredUpdates, rejectedKeys } = partitionApiSettingUpdates(
    updates,
    c.var.appConfig.demoMode,
  );

  if (rejectedKeys.length > 0 && Object.keys(filteredUpdates).length === 0) {
    const message = c.var.appConfig.demoMode
      ? "Demo mode locks these settings"
      : "None of the provided keys are editable";
    throw new ValidationError(message, { rejectedKeys });
  }

  if (Object.keys(filteredUpdates).length > 0) {
    await c.var.services.settings.setMany(filteredUpdates as never);
  }

  // Return updated state
  const allSettings = await c.var.services.settings.getAll();

  return c.json({
    settings: buildApiSettingsResponse(
      allSettings,
      c.var.appConfig.demoMode,
      c.env,
    ),
    ...(rejectedKeys.length > 0 && { rejectedKeys }),
  });
});

// Restore the site's languages from a site export (requires auth). The pair
// is only valid together and against the site's paths, so the language
// service applies it rather than writing it as given.
settingsApiRoutes.put("/import", requireAuthApi(), async (c) => {
  const updates = parseValidated(UpdateSettingsSchema, await readJsonBody(c));
  const { filteredUpdates, rejectedKeys } =
    partitionLanguageSettingUpdates(updates);

  if (Object.keys(filteredUpdates).length === 0) {
    throw new ValidationError("None of the provided keys are importable", {
      rejectedKeys,
    });
  }

  const current = await c.var.services.settings.getAll();
  const additional =
    filteredUpdates.ADDITIONAL_LANGUAGES ?? current.ADDITIONAL_LANGUAGES;
  const enabled =
    filteredUpdates.MULTILINGUAL_ENABLED ?? current.MULTILINGUAL_ENABLED;
  await c.var.services.language.restore({
    additional: parseLanguageList(additional),
    enabled: enabled === "true",
  });

  const allSettings = await c.var.services.settings.getAll();
  return c.json({
    settings: buildApiSettingsResponse(
      allSettings,
      c.var.appConfig.demoMode,
      c.env,
    ),
    ...(rejectedKeys.length > 0 && { rejectedKeys }),
  });
});

settingsApiRoutes.post(
  "/discovery/compose-open-shortcut",
  requireAuthApi(),
  async (c) => {
    const existing = await c.var.services.settings.get(
      SETTINGS_KEYS.DISCOVERY_COMPOSE_OPEN_SHORTCUT_AT,
    );

    if (!existing) {
      await c.var.services.settings.set(
        SETTINGS_KEYS.DISCOVERY_COMPOSE_OPEN_SHORTCUT_AT,
        String(now()),
      );
    }

    return c.json({ learned: true }, existing ? 200 : 201);
  },
);

settingsApiRoutes.post(
  "/discovery/slash-command",
  requireAuthApi(),
  async (c) => {
    const existing = await c.var.services.settings.get(
      SETTINGS_KEYS.DISCOVERY_SLASH_COMMAND_AT,
    );

    if (!existing) {
      await c.var.services.settings.set(
        SETTINGS_KEYS.DISCOVERY_SLASH_COMMAND_AT,
        String(now()),
      );
    }

    return c.json({ learned: true }, existing ? 200 : 201);
  },
);

// Upload site avatar (requires auth)
settingsApiRoutes.post("/avatar", requireAuthApi(), async (c) => {
  const storage = requireStorage(c.var.storage);

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    throw new ValidationError("No file selected. Choose a file to upload.");
  }

  const faviconFile = formData.get("favicon") as File | null;
  const appleTouchFile = formData.get("appleTouch") as File | null;

  try {
    await c.var.services.settings.uploadAvatar(
      {
        file,
        faviconIco: faviconFile ? await faviconFile.arrayBuffer() : undefined,
        appleTouchIcon: appleTouchFile
          ? await appleTouchFile.arrayBuffer()
          : undefined,
      },
      {
        media: c.var.services.media,
        storage,
        storageProvider: c.var.appConfig.storageDriver,
        maxFileSizeMB: c.var.appConfig.uploadMaxFileSize,
      },
    );
    try {
      await syncHostedControlPlaneSiteAvatar({
        appConfig: c.var.appConfig,
        env: c.env,
        settings: c.var.services.settings,
        siteId: c.var.currentSite.id,
      });
    } catch (error) {
      // eslint-disable-next-line no-console -- Error logging is intentional
      console.error(
        "[Jant] Failed to sync hosted control plane avatar metadata:",
        error,
      );
    }

    return c.json({ success: true }, 201);
  } catch (error) {
    // Validation and quota errors reach the client as they are; anything else
    // is a failed write.
    if (error instanceof DomainError) throw error;
    // eslint-disable-next-line no-console -- Error logging is intentional
    console.error("[Jant] Avatar upload failed:", error);
    throw new ExternalServiceError(
      "Upload didn't go through. Try again in a moment.",
    );
  }
});

// Remove site avatar (requires auth)
settingsApiRoutes.delete("/avatar", requireAuthApi(), async (c) => {
  await c.var.services.settings.removeAvatar({
    storage: c.var.storage,
    media: c.var.services.media,
    storageProvider: c.var.appConfig.storageDriver,
  });
  try {
    await syncHostedControlPlaneSiteAvatar({
      appConfig: c.var.appConfig,
      env: c.env,
      settings: c.var.services.settings,
      siteId: c.var.currentSite.id,
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- Error logging is intentional
    console.error(
      "[Jant] Failed to sync hosted control plane avatar metadata:",
      error,
    );
  }
  return c.json({ success: true });
});

// Remove one runtime override so the environment/default fallback applies.
// Registered after the concrete avatar route so `DELETE /avatar` remains
// unambiguous.
settingsApiRoutes.delete("/:key", requireAuthApi(), async (c) => {
  const key = c.req.param("key");
  const demoMode = c.var.appConfig.demoMode;

  if (
    !isResettableConfigEditorKey(key) ||
    (demoMode && demoLockedSettingKeys.has(key))
  ) {
    throw new ValidationError("This setting can't be reset.", {
      rejectedKeys: [key],
    });
  }

  await c.var.services.settings.remove(key);
  const allSettings = await c.var.services.settings.getAll();

  return c.json({
    settings: buildApiSettingsResponse(allSettings, demoMode, c.env),
  });
});
