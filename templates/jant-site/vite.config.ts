import { defineConfig, type Plugin } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import swc from "unplugin-swc";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { readFileSync } from "fs";

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
  server: {
    port: 9019,
    host: true,
    allowedHosts: true,
    watch: {
      // 允许 Vite 监听 @jant/core 的变化 (默认会忽略 node_modules)
      ignored: ["!**/node_modules/@jant/core/**"],
    },
  },

  preview: {
    port: 9019,
  },

  ssr: {
    // 强制 Vite 处理库内的 CSS 文件
    noExternal: ["@jant/core"],
  },

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
    tailwindcss(),
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
    injectManifest(),
  ],

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
      // Monorepo: use source files directly for HMR
      "@jant/core": resolve(__dirname, "../../packages/core/src"),
    },
  },
});
