/**
 * Asset paths for SSR
 *
 * Development: Uses source paths served by Vite dev server
 * Production: Uses paths that get patched at build time with actual hashes
 */

interface Assets {
  styles: string;
  client: string;
  datastar: string;
  imageProcessor: string;
}

// Development paths - use source files for HMR
const DEV_ASSETS: Assets = {
  styles: "/node_modules/@jant/core/src/theme/styles/main.css",
  client: "/node_modules/@jant/core/src/client.ts",
  datastar: "/node_modules/@jant/core/static/assets/datastar.min.js",
  imageProcessor: "/node_modules/@jant/core/static/assets/image-processor.js",
};

// Production paths - these unique placeholders get replaced at build time
// Format: __JANT_ASSET_<NAME>__ to avoid accidental matches
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
    // import.meta.env is injected by Vite
    if (import.meta.env?.DEV) return DEV_ASSETS;
  } catch {
    // import.meta.env may not exist in all environments
  }

  return PROD_ASSETS;
}

// For static imports
export const ASSETS = PROD_ASSETS;
