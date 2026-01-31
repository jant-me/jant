/**
 * Jant - A microblog system
 *
 * @packageDocumentation
 */

import { createApp } from "./app.js";

// Export for programmatic use
export { createApp } from "./app.js";
export type { App } from "./app.js";
export * from "./types.js";

// Default export for Cloudflare Workers
export default createApp();
