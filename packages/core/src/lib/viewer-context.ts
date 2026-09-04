/**
 * Request-scoped viewer state for Hono JSX renders.
 *
 * Whether the visitor is the signed-in author decides what a Post card should
 * even emit. The post menu trigger, the reply trigger, and three of the four
 * status badges only ever become visible under `body[data-authenticated]` or
 * an article state an anonymous reader cannot reach, so for a logged-out
 * visitor they are markup that can never be seen — several hundred DOM nodes
 * of invisible chrome on a full timeline, paid for in style and layout on
 * every load.
 *
 * The flag is bound once per render, alongside the i18n instance and from the
 * same source (`c.var.isAuthenticated`), rather than threaded through the six
 * component layers between a page and `PostFooter`. It must stay that same
 * flag: `BaseLayout` writes it into `data-authenticated`, and a gate that
 * disagrees with the CSS reveal either hides the author's own controls or
 * brings the dead markup back.
 *
 * Renders are synchronous and single-threaded per request, so a module-level
 * binding is safe here — the same reasoning the i18n context runs on.
 */

/**
 * Whether the current render is for the signed-in author.
 *
 * Defaults to `false` so a render that never bound a viewer emits the reader's
 * markup. That is the safe direction: the author's controls are hidden until
 * something says otherwise, rather than leaking into an anonymous page.
 */
let currentIsAuthor = false;

/**
 * Bind the viewer for the render that is about to run.
 *
 * Called by the render provider, not by components.
 *
 * @param isAuthor - Whether this request carries the author's session
 * @returns Nothing
 *
 * @example
 * ```tsx
 * bindViewer(c.get("isAuthenticated") === true);
 * ```
 */
export function bindViewer(isAuthor: boolean): void {
  currentIsAuthor = isAuthor;
}

/**
 * Read the current render's viewer.
 *
 * @returns `isAuthor` — whether the signed-in author is looking at this page
 *
 * @example
 * ```tsx
 * const { isAuthor } = useViewer();
 * return isAuthor ? <PostMenuTriggerButton /> : null;
 * ```
 */
export function useViewer(): { isAuthor: boolean } {
  return { isAuthor: currentIsAuthor };
}
