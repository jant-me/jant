import { defineConfig, type Plugin } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import swc from "unplugin-swc";
import tailwindcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { resolve, join } from "path";

// After client build, patch worker bundle with actual asset paths
function patchWorkerAssets(): Plugin {
  return {
    name: "patch-worker-assets",
    apply: "build",
    closeBundle() {
      const manifestPath = resolve("dist/client/.vite/manifest.json");
      if (!existsSync(manifestPath)) return;

      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

      // Extract asset paths from manifest
      let stylesPath = "/assets/styles.css";
      let clientPath = "/assets/client.js";

      for (const [key, entry] of Object.entries(manifest) as [string, { file: string }][]) {
        if (key.includes("main.css") || key.includes("styles")) {
          stylesPath = `/${entry.file}`;
        } else if (key.includes("client.ts") || key.includes("client")) {
          clientPath = `/${entry.file}`;
        }
      }

      // Find and patch worker entry file
      const workerDirs = readdirSync("dist").filter(d => d !== "client" && existsSync(join("dist", d, "assets")));
      for (const dir of workerDirs) {
        const assetsDir = join("dist", dir, "assets");
        const files = readdirSync(assetsDir).filter(f => f.startsWith("worker-entry"));
        for (const file of files) {
          const filePath = join(assetsDir, file);
          let content = readFileSync(filePath, "utf-8");
          // Replace unique placeholders with actual hashed paths
          content = content.replace(/__JANT_ASSET_STYLES__/g, stylesPath);
          content = content.replace(/__JANT_ASSET_CLIENT__/g, clientPath);
          writeFileSync(filePath, content);
        }
      }
    },
  };
}

export default defineConfig({
  publicDir: false,
  server: {
    port: 9019,
    host: true,
    allowedHosts: true,
  },
  preview: {
    port: 9019,
  },
  plugins: [
    swc.vite({
      jsc: {
        parser: {
          syntax: "typescript",
          tsx: true,
        },
        transform: {
          react: {
            runtime: "automatic",
            importSource: "hono/jsx",
          },
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
      module: {
        type: "es6",
      },
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
        styles: "@jant/core/src/theme/styles/main.css",
        client: "@jant/core/src/client.ts",
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
    },
  },
});
