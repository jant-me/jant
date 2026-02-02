import { defineConfig, type Plugin } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import swc from "unplugin-swc";
import tailwindcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { resolve, join } from "path";

/**
 * Dev asset paths
 * CSS link prevents FOUC (Flash of Unstyled Content) in dev mode
 */
const JANT_DEV_ASSETS = {
  styles: "/src/style.css",
  client: "/src/client.ts",
  datastar: "/node_modules/@jant/core/static/assets/datastar.min.js",
  imageProcessor: "/node_modules/@jant/core/static/assets/image-processor.js",
};

/**
 * Post-build: Extract asset paths from manifest and patch worker bundle
 */
function patchWorkerAssets(): Plugin {
  return {
    name: "patch-worker-assets",
    apply: "build",
    closeBundle() {
      const manifestPath = resolve("dist/client/.vite/manifest.json");
      if (!existsSync(manifestPath)) return;

      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

      // Find asset paths in manifest
      let stylesPath = "";
      let clientPath = "";
      let datastarPath = "";
      let imageProcessorPath = "";

      for (const [key, entry] of Object.entries(manifest) as [string, { file: string; css?: string[] }][]) {
        if (key.includes("client")) {
          clientPath = `/${entry.file}`;
          // CSS is extracted from client entry
          if (entry.css?.[0]) {
            stylesPath = `/${entry.css[0]}`;
          }
        } else if (key.includes("datastar")) {
          datastarPath = `/${entry.file}`;
        } else if (key.includes("image-processor")) {
          imageProcessorPath = `/${entry.file}`;
        }
      }

      // Patch worker entry files with actual paths
      const workerDirs = readdirSync("dist").filter(
        (d) => d !== "client" && existsSync(join("dist", d, "assets"))
      );

      for (const dir of workerDirs) {
        const assetsDir = join("dist", dir, "assets");
        const files = readdirSync(assetsDir).filter((f) => f.startsWith("worker-entry"));

        for (const file of files) {
          const filePath = join(assetsDir, file);
          let content = readFileSync(filePath, "utf-8");

          content = content.replace(/__JANT_ASSET_STYLES__/g, stylesPath);
          content = content.replace(/__JANT_ASSET_CLIENT__/g, clientPath);
          content = content.replace(/__JANT_ASSET_DATASTAR__/g, datastarPath);
          content = content.replace(/__JANT_ASSET_IMAGE_PROCESSOR__/g, imageProcessorPath);

          writeFileSync(filePath, content);
        }
      }
    },
  };
}

export default defineConfig({
  publicDir: false,

  // Inject dev asset paths (used by @jant/core's getAssets())
  define: {
    __JANT_DEV_STYLES__: JSON.stringify(JANT_DEV_ASSETS.styles),
    __JANT_DEV_CLIENT__: JSON.stringify(JANT_DEV_ASSETS.client),
    __JANT_DEV_DATASTAR__: JSON.stringify(JANT_DEV_ASSETS.datastar),
    __JANT_DEV_IMAGE_PROCESSOR__: JSON.stringify(JANT_DEV_ASSETS.imageProcessor),
  },

  server: {
    port: 9019,
    host: true,
    allowedHosts: true,
  },

  preview: {
    port: 9019,
  },

  // Process @jant/core through Vite (don't treat as external)
  ssr: {
    noExternal: ["@jant/core", "basecoat-css"],
  },

  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: "typescript", tsx: true },
        transform: {
          react: { runtime: "automatic", importSource: "hono/jsx" },
        },
        target: "es2022",
        experimental: {
          plugins: [
            [
              "@lingui/swc-plugin",
              {
                runtimeConfigModule: {
                  useLingui: ["@jant/core/src/i18n/index.ts", "useLingui"],
                  Trans: ["@jant/core/src/i18n/index.ts", "Trans"],
                },
              },
            ],
          ],
        },
      },
      module: { type: "es6" },
    }),
    cloudflare({
      configPath: process.env.WRANGLER_CONFIG || "./wrangler.toml",
    }),
    patchWorkerAssets(),
  ],

  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer],
    },
  },

  build: {
    target: "esnext",
    minify: false,
    manifest: true,
    rollupOptions: {
      input: {
        client: "src/client.ts",
        datastar: "@jant/core/static/assets/datastar.min.js",
        "image-processor": "@jant/core/static/assets/image-processor.js",
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
      external: ["cloudflare:*", "__STATIC_CONTENT_MANIFEST"],
    },
  },

  resolve: {
    alias: {
      "@": "/src",
      // Monorepo: use source files directly for HMR (npm users don't have this alias)
      "@jant/core": resolve(__dirname, "../../packages/core/src"),
    },
  },
});
