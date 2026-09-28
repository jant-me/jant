/**
 * Jant - A microblog system
 *
 * The public JavaScript API is `createApp`. A site's entry point is
 * `export default createApp();`, and every setting comes from the
 * environment. Everything else under `src/` is internal and can change in
 * any release; see `docs/compatibility.md`.
 *
 * This file is also where the package's published types come from: the
 * library build writes `dist/index.d.ts` from it alone, so nothing here may
 * name a type from another module. `App` is written out rather than taken
 * from Hono for that reason, and so a site's types never depend on which
 * Hono release Jant bundles.
 *
 * @packageDocumentation
 */

import { createApp as createHonoApp } from "./app.js";

/**
 * A Jant site, in the shape of a Cloudflare Workers module. The Node runtime
 * and Docker image serve the same object.
 */
export interface App {
  /**
   * Answer one request.
   *
   * @param request - The incoming request
   * @param env - The Worker's bindings, or the Node runtime's environment
   * @param executionCtx - The Worker's execution context, when there is one
   * @returns The response
   */
  fetch(
    request: Request,
    env?: unknown,
    executionCtx?: unknown,
  ): Response | Promise<Response>;
}

/**
 * Create a Jant site. It takes no options: every setting comes from the
 * environment the request arrives with.
 *
 * @returns The site, ready to be a Worker's default export
 * @example
 * ```ts
 * import { createApp } from "@jant/core";
 *
 * export default createApp();
 * ```
 */
export function createApp(): App {
  return createHonoApp();
}
