/**
 * Jant - A microblog system
 *
 * The public JavaScript API is `createApp`. A site's entry point is
 * `export default createApp();`, and every setting comes from the
 * environment. Everything else under `src/` is internal and can change in
 * any release; see `docs/compatibility.md`.
 *
 * @packageDocumentation
 */

export { createApp } from "./app.js";
export type { App } from "./app.js";
