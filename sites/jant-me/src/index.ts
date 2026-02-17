/**
 * Jant Site Entry Point
 *
 * This is the main entry point for your Jant site.
 * Customize with CSS variables, color themes, or custom CSS in the dashboard.
 *
 * Configuration:
 * - Site settings (name, description, language) should be configured via
 *   environment variables in wrangler.toml or .dev.vars
 * - Alternatively, set them in the dashboard (stored in DB)
 */

import { createApp } from "@jant/core";

export default createApp();
