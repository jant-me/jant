/**
 * Asset paths for SSR
 *
 * Development: Paths injected via vite.config.ts `define`
 * Production: Paths replaced at build time with hashed filenames
 */

interface Assets {
  /** CSS path */
  styles: string;
  /** Main client bundle (Datastar + BaseCoat + ImageProcessor) */
  client: string;
}

// Injected by vite.config.ts via `define`
declare const __JANT_DEV_STYLES__: string;
declare const __JANT_DEV_CLIENT__: string;

// Production paths - replaced at build time
const PROD_ASSETS: Assets = {
  styles: "__JANT_ASSET_STYLES__",
  client: "__JANT_ASSET_CLIENT__",
};

/**
 * Get assets based on environment
 */
export function getAssets(): Assets {
  try {
    if (import.meta.env?.DEV) {
      return {
        styles: __JANT_DEV_STYLES__,
        client: __JANT_DEV_CLIENT__,
      };
    }
  } catch {
    // import.meta.env may not exist in all environments
  }

  return PROD_ASSETS;
}
