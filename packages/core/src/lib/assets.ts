/**
 * Asset paths for SSR
 *
 * Development: Uses source paths served by Vite dev server
 * Production: Reads from .vite/manifest.json at runtime
 */

interface Assets {
  styles: string;
  client: string;
  datastar: string;
}

interface ViteManifestEntry {
  file: string;
  src?: string;
  isEntry?: boolean;
}

type ViteManifest = Record<string, ViteManifestEntry>;

// Development paths
const DEV_ASSETS: Assets = {
  styles: "/node_modules/@jant/core/src/theme/styles/main.css",
  client: "/node_modules/@jant/core/src/client.ts",
  datastar: "/node_modules/@jant/core/static/assets/datastar.min.js",
};

// Production fallback (used if manifest fails to load)
const FALLBACK_ASSETS: Assets = {
  styles: "/assets/styles.css",
  client: "/assets/client.js",
  datastar: "/assets/datastar.min.js",
};

// Cached production assets
let prodAssets: Assets | null = null;

/**
 * Parse Vite manifest to extract asset paths
 */
function parseManifest(manifest: ViteManifest): Assets {
  const assets = { ...FALLBACK_ASSETS };

  for (const [key, entry] of Object.entries(manifest)) {
    if (key.includes("main.css") || key.includes("styles")) {
      assets.styles = `/${entry.file}`;
    } else if (key.includes("client.ts") || key.includes("client")) {
      assets.client = `/${entry.file}`;
    }
  }

  return assets;
}

/**
 * Load assets from Vite manifest (call once at app startup)
 * @param fetchFn - Function to fetch static assets
 */
export async function loadAssets(
  fetchFn: (url: string) => Promise<Response>
): Promise<Assets> {
  if (prodAssets) return prodAssets;

  try {
    // Try /manifest.json first (copied by vite plugin), fallback to /.vite/manifest.json
    let res = await fetchFn("/manifest.json");
    if (!res.ok) {
      res = await fetchFn("/.vite/manifest.json");
    }
    if (res.ok) {
      const manifest = (await res.json()) as ViteManifest;
      prodAssets = parseManifest(manifest);
      return prodAssets;
    }
  } catch (e) {
    console.warn("Failed to load manifest:", e);
  }

  prodAssets = FALLBACK_ASSETS;
  return prodAssets;
}

/**
 * Get assets (must call loadAssets first in production)
 */
export function getAssets(): Assets {
  // Check for dev mode
  try {
    // @ts-expect-error - import.meta.env injected by Vite
    if (import.meta.env?.DEV) return DEV_ASSETS;
  } catch {}

  return prodAssets ?? FALLBACK_ASSETS;
}

// For static imports (use getAssets() for dynamic)
export const ASSETS = FALLBACK_ASSETS;
