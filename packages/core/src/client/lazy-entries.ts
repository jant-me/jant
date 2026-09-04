/**
 * The authenticated bundle, split by what a page needs.
 *
 * `client-auth.ts` is the shell every signed-in page loads: the post menu,
 * command palette, shortcuts, and the triggers that open the composer. The
 * heavier parts ship as their own entries and load through here:
 *
 * - `client-compose.ts` — the editor. Loaded the first time the composer
 *   opens (`compose-launch.ts`), at once on the compose page, and preloaded
 *   by the layout on every signed-in page so that first open costs no
 *   round trip.
 * - `client-settings.ts` — the settings pages' components.
 * - `client-manage.ts` — navigation manager, collection directory, and the
 *   collection page menus.
 *
 * The page decides: {@link loadEntriesForPage} looks for the elements and
 * hooks the server renders only where an entry is needed, and keeps looking
 * as fragments arrive, so a component never has to be registered up front.
 * `docs/internal/lit-guide.md` says which entry a new component belongs in.
 */

function once(load: () => Promise<unknown>): () => Promise<void> {
  let loading: Promise<void> | undefined;
  return () => (loading ??= load().then(() => undefined));
}

/** Load the composer entry; resolves once its elements are defined. */
export const ensureCompose = once(() => import("../client-compose.js"));

/** Load the settings entry; resolves once its elements are defined. */
export const ensureSettings = once(() => import("../client-settings.js"));

/** Load the management entry; resolves once its elements are defined. */
export const ensureManage = once(() => import("../client-manage.js"));

/**
 * Markup the server renders only on pages that need an entry. A selector
 * matching means the page cannot work without that entry, so it loads at
 * once; the composer on an ordinary page is not listed because it loads on
 * first open instead.
 */
const PAGE_ENTRIES: ReadonlyArray<{
  selector: string;
  load: () => Promise<void>;
}> = [
  { selector: '[data-page="compose"]', load: ensureCompose },
  {
    selector: [
      "jant-settings-general",
      "jant-settings-language",
      "jant-settings-avatar",
      "jant-config-editor",
      "jant-repo-picker",
    ].join(", "),
    load: ensureSettings,
  },
  {
    selector: [
      "jant-nav-manager",
      "jant-collections-manager",
      "[data-collection-page-actions]",
      "[data-smart-collection-page-actions]",
      "[data-custom-url-actions]",
    ].join(", "),
    load: ensureManage,
  },
];

/**
 * Load every entry whose markup is on the page, now and as the DOM changes.
 *
 * @example
 * ```ts
 * // client-auth.ts, once the shell is set up
 * loadEntriesForPage();
 * ```
 */
export function loadEntriesForPage(): void {
  const pending = new Set(PAGE_ENTRIES);
  const observer = new globalThis.MutationObserver(check);

  function check(): void {
    for (const entry of pending) {
      if (!document.querySelector(entry.selector)) continue;
      pending.delete(entry);
      void entry.load();
    }
    if (pending.size === 0) observer.disconnect();
  }

  check();
  if (pending.size > 0) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
}
