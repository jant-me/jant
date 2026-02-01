/**
 * Jant - A microblog system
 *
 * @packageDocumentation
 */

import { createApp as _createApp } from "./app.js";

// Main app factory
export { createApp } from "./app.js";
export type { App, AppVariables } from "./app.js";

// Types (excluding component props to avoid conflicts with theme exports)
export type {
  PostType,
  Visibility,
  Bindings,
  Post,
  Media,
  Collection,
  PostCollection,
  Redirect,
  Setting,
  CreatePost,
  UpdatePost,
  JantConfig,
  JantTheme,
  SiteConfig,
  FeatureConfig,
  ThemeComponents,
} from "./types.js";

export { POST_TYPES, VISIBILITY_LEVELS } from "./types.js";

// Utilities (for theme authors)
export * as time from "./lib/time.js";
export * as sqid from "./lib/sqid.js";
export * as url from "./lib/url.js";
export * as markdown from "./lib/markdown.js";

// Default export for running core directly (e.g., for development)
export default _createApp();
