import { defineConfig, type Plugin } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import swc from "unplugin-swc";
import tailwindcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Inject manifest content into SSR bundle for vite-ssr-components
 */
function injectManifest(): Plugin {
  let clientOutDir = "dist/client";

  return {
    name: "inject-manifest",
    config(config) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientOutDir = (config as any).environments?.client?.build?.outDir ?? "dist/client";
    },
    transform(code, _id, options) {
      if (!options?.ssr) return;
      if (!code.includes("__VITE_MANIFEST_CONTENT__")) return;

      const manifestPath = resolve(process.cwd(), clientOutDir, ".vite/manifest.json");
      let manifestContent: string;
      try {
        manifestContent = readFileSync(manifestPath, "utf-8");
      } catch {
        return;
      }

      const newCode = code.replace(
        /"__VITE_MANIFEST_CONTENT__"/g,
        `{ "__manifest__": { default: ${manifestContent} } }`
      );

      if (newCode !== code) {
        return { code: newCode, map: null };
      }
    },
  };
}

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
  // ssr.noExternal not needed - @cloudflare/vite-plugin bundles all dependencies
  environments: {
    client: {
      build: {
        outDir: "dist/client",
        manifest: true,
        rollupOptions: {
          input: ["/src/client.ts", "/src/style.css"],
        },
      },
    },
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
    injectManifest(),
  ],
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer],
    },
  },
  build: {
    target: "esnext",
    minify: false,
    rollupOptions: {
      external: ["cloudflare:*", "__STATIC_CONTENT_MANIFEST"],
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
