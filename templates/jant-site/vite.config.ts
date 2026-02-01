import { defineConfig, type Plugin } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import swc from "unplugin-swc";
import tailwindcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";
import { copyFileSync, existsSync } from "fs";
import { resolve } from "path";

// Copy manifest.json to accessible location (Cloudflare may not serve .vite directory)
function copyManifest(): Plugin {
  return {
    name: "copy-manifest",
    apply: "build",
    closeBundle() {
      const src = resolve("dist/client/.vite/manifest.json");
      const dest = resolve("dist/client/manifest.json");
      if (existsSync(src)) {
        copyFileSync(src, dest);
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
    copyManifest(),
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
