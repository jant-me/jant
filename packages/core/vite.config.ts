import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import swc from "unplugin-swc";
import tailwindcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";

export default defineConfig({
  publicDir: "static",
  server: {
    host: true,
    port: 9019,
    allowedHosts: true,
  },
  preview: {
    host: true,
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
                  useLingui: ["src/i18n/index.ts", "useLingui"],
                  Trans: ["src/i18n/index.ts", "Trans"],
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
      configPath: "./wrangler.toml",
    }),
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
        main: "./src/index.ts",
        styles: "./src/theme/styles/main.css",
        client: "./src/client.ts",
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
