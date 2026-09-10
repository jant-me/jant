/**
 * Settings Bridge
 *
 * Handles server communication for the Lit settings components.
 * Listens for `jant:settings-save` and `jant:avatar-remove` events,
 * POSTs to the server, and handles the response (toast, DOM updates).
 */

import type {
  SettingsSaveDetail,
  AvatarRemoveDetail,
  SettingsInitialData,
} from "./components/settings-types.js";
import type { JantSettingsGeneral } from "./components/jant-settings-general.js";
import type { JantSettingsAvatar } from "./components/jant-settings-avatar.js";
import { getJsonBoolean, getJsonString, readJsonObject } from "./json.js";
import { showToast } from "./toast.js";

function parseSettingsInitialData(data: unknown): SettingsInitialData | null {
  const siteName = getJsonString(data, "siteName");
  const siteDescription = getJsonString(data, "siteDescription");
  const mainRssFeed = getJsonString(data, "mainRssFeed");
  const timeZone = getJsonString(data, "timeZone");
  const siteFooter = getJsonString(data, "siteFooter");
  const showJantBrandingOnHome = getJsonBoolean(data, "showJantBrandingOnHome");
  const noindex = getJsonBoolean(data, "noindex");
  const discover = getJsonString(data, "discover");

  if (
    siteName === undefined ||
    siteDescription === undefined ||
    mainRssFeed === undefined ||
    timeZone === undefined ||
    siteFooter === undefined ||
    showJantBrandingOnHome === undefined ||
    noindex === undefined ||
    discover === undefined
  ) {
    return null;
  }

  return {
    siteName,
    siteDescription,
    mainRssFeed,
    timeZone,
    siteFooter,
    showJantBrandingOnHome,
    noindex,
    discover,
  };
}

// ── Settings save handler ───────────────────────────────────────────

document.addEventListener("jant:settings-save", async (e: Event) => {
  const event = e as CustomEvent<SettingsSaveDetail>;
  const { endpoint, data, section } = event.detail;

  const generalEl = document.querySelector<JantSettingsGeneral>(
    "jant-settings-general",
  );
  const avatarEl = document.querySelector<JantSettingsAvatar>(
    "jant-settings-avatar",
  );

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await readJsonObject(res);
    const status = getJsonString(json, "status");
    const url = getJsonString(json, "url");
    const toast = getJsonString(json, "toast");

    if (status === "redirect" && url) {
      window.location.href = url;
      return;
    }

    if (toast) {
      showToast(toast);
    }

    // Notify the component that save succeeded
    if (section === "avatar-display") {
      avatarEl?.saved();
    } else {
      generalEl?.sectionSaved(section);
    }
  } catch {
    showToast("Failed to save. Please try again.", "error");

    if (section === "avatar-display") {
      avatarEl?.saveError();
    } else {
      generalEl?.sectionError(section);
    }
  }
});

// ── Avatar remove handler ───────────────────────────────────────────

document.addEventListener("jant:avatar-remove", async (e: Event) => {
  const event = e as CustomEvent<AvatarRemoveDetail>;
  const { endpoint } = event.detail;
  const avatarEl = document.querySelector<JantSettingsAvatar>(
    "jant-settings-avatar",
  );

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await readJsonObject(res);
    const status = getJsonString(json, "status");
    const url = getJsonString(json, "url");

    if (status === "redirect" && url) {
      window.location.href = url;
      return;
    }
  } catch {
    showToast("Failed to remove avatar. Please try again.", "error");
    avatarEl?.removeError();
  }
});

// ── Initialize form data from server-rendered JSON ──────────────────

function initSettingsData() {
  const el = document.querySelector<JantSettingsGeneral>(
    "jant-settings-general",
  );
  if (!el) return;

  const dataEl = document.getElementById("settings-initial-data");
  if (!dataEl?.textContent) return;

  try {
    const data = parseSettingsInitialData(JSON.parse(dataEl.textContent));
    if (data) {
      el.initData(data);
    }
  } catch {
    // Data parsing failed, form will use defaults
  }
}

// Run after Lit components have upgraded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSettingsData);
} else {
  // Use microtask to let custom elements upgrade first
  queueMicrotask(initSettingsData);
}
