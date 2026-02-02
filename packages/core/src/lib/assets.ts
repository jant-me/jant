/**
 * Asset paths for SSR
 *
 * Development: Paths injected via vite.config.ts `define`
 * Production: Paths replaced at build time with hashed filenames from manifest
 */

interface Assets {
  /** CSS path (prevents FOUC in dev, hashed in prod) */
  styles: string;
  client: string;
  datastar: string;
  imageProcessor: string;
}

// Injected by vite.config.ts via `define`
declare const __JANT_DEV_STYLES__: string;
declare const __JANT_DEV_CLIENT__: string;
declare const __JANT_DEV_DATASTAR__: string;
declare const __JANT_DEV_IMAGE_PROCESSOR__: string;

// Production paths - replaced at build time
const PROD_ASSETS: Assets = {
  styles: "__JANT_ASSET_STYLES__",
  client: "__JANT_ASSET_CLIENT__",
  datastar: "__JANT_ASSET_DATASTAR__",
  imageProcessor: "__JANT_ASSET_IMAGE_PROCESSOR__",
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
        datastar: __JANT_DEV_DATASTAR__,
        imageProcessor: __JANT_DEV_IMAGE_PROCESSOR__,
      };
    }
  } catch {
    // import.meta.env may not exist in all environments
  }

  return PROD_ASSETS;
}

// For static imports
export const ASSETS = PROD_ASSETS;
