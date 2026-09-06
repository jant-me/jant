// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const loaded = {
  compose: vi.fn(),
  settings: vi.fn(),
  manage: vi.fn(),
};

/**
 * One turn of the event loop — enough for the observer to see a mutation, and
 * all a negative assertion needs. A load that is expected to happen is waited
 * for with `vi.waitFor` instead: a dynamic import can take more than a tick
 * when the whole suite is running.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A fresh module per test: the loaders remember what they have loaded, and a
 * mock's factory runs once per module registry, so both are re-registered.
 */
async function freshLazyEntries() {
  vi.resetModules();
  vi.doMock("../../client-compose.js", () => {
    loaded.compose();
    return {};
  });
  vi.doMock("../../client-settings.js", () => {
    loaded.settings();
    return {};
  });
  vi.doMock("../../client-manage.js", () => {
    loaded.manage();
    return {};
  });
  return import("../lazy-entries.js");
}

describe("lazy entries", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    loaded.compose.mockClear();
    loaded.settings.mockClear();
    loaded.manage.mockClear();
  });

  it("loads an entry once however often it is asked for", async () => {
    const { ensureCompose } = await freshLazyEntries();

    await Promise.all([ensureCompose(), ensureCompose()]);
    await ensureCompose();

    expect(loaded.compose).toHaveBeenCalledTimes(1);
  });

  it("loads the entries whose markup is on the page, and only those", async () => {
    document.body.innerHTML = `
      <jant-compose-dialog></jant-compose-dialog>
      <jant-settings-general></jant-settings-general>`;

    const { loadEntriesForPage } = await freshLazyEntries();
    loadEntriesForPage();

    await vi.waitFor(() => expect(loaded.settings).toHaveBeenCalledTimes(1));
    expect(loaded.manage).not.toHaveBeenCalled();
  });

  it("loads the composer at once on the compose page", async () => {
    document.body.innerHTML = `<section data-page="compose"></section>`;

    const { loadEntriesForPage } = await freshLazyEntries();
    loadEntriesForPage();

    await vi.waitFor(() => expect(loaded.compose).toHaveBeenCalledTimes(1));
  });

  it("keeps watching for markup that arrives after load", async () => {
    const { loadEntriesForPage } = await freshLazyEntries();
    loadEntriesForPage();
    await settle();
    expect(loaded.manage).not.toHaveBeenCalled();

    const hook = document.createElement("div");
    hook.setAttribute("data-collection-page-actions", "");
    document.body.appendChild(hook);

    await vi.waitFor(() => expect(loaded.manage).toHaveBeenCalledTimes(1));
  });
});
