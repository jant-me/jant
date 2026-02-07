import { defineConfig, type Plugin } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import swc from "unplugin-swc";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { readFileSync, writeFileSync, readdirSync } from "fs";

/**
 * Trigger full page reload when server/worker code changes.
 * @cloudflare/vite-plugin only hot-updates the worker module,
 * but for SSR apps the browser needs a full reload to see new HTML.
 */
function ssrReload(): Plugin {
  return {
    name: "ssr-reload",
    hotUpdate({ server }) {
      if (this.environment.name !== "client") {
        server.hot.send({ type: "full-reload" });
        return [];
      }
    },
  };
}

/**
 * Inject manifest content into SSR bundle for vite-ssr-components.
 *
 * The worker environment builds before the client environment, so the client
 * manifest may not exist during the worker's transform phase.  We handle both
 * cases:
 *   1. transform hook  – works when a previous client build already exists.
 *   2. writeBundle hook – runs after the client build writes its manifest and
 *      patches the already-emitted worker bundle on disk.
 */
function injectManifest(): Plugin {
  let clientOutDir = "dist/client";

  const sentinel = '"__VITE_MANIFEST_CONTENT__"';

  function readManifest(): string | undefined {
    const manifestPath = resolve(process.cwd(), clientOutDir, ".vite/manifest.json");
    try {
      return readFileSync(manifestPath, "utf-8");
    } catch {
      return undefined;
    }
  }

  function buildReplacement(manifestContent: string): string {
    return `{ "__manifest__": { default: ${manifestContent} } }`;
  }

  return {
    name: "inject-manifest",
    config(config) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientOutDir = (config as any).environments?.client?.build?.outDir ?? "dist/client";
    },

    // 1. Try during transform (works when previous client build exists on disk)
    transform(code, _id, options) {
      if (!options?.ssr) return;
      if (!code.includes("__VITE_MANIFEST_CONTENT__")) return;

      const manifestContent = readManifest();
      if (!manifestContent) return;

      const newCode = code.replace(
        /"__VITE_MANIFEST_CONTENT__"/g,
        buildReplacement(manifestContent)
      );

      if (newCode !== code) {
        return { code: newCode, map: null };
      }
    },

    // 2. After the client build writes the manifest, patch worker output files
    writeBundle() {
      if (this.environment.name !== "client") return;

      const manifestContent = readManifest();
      if (!manifestContent) return;

      const replacement = buildReplacement(manifestContent);
      const distDir = resolve(process.cwd(), "dist");
      const clientDirName = clientOutDir.split("/").pop()!;

      let entries: import("fs").Dirent[];
      try {
        entries = readdirSync(distDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === clientDirName) continue;
        const workerDir = resolve(distDir, entry.name);
        const files = readdirSync(workerDir, { recursive: true }) as string[];
        for (const file of files) {
          if (!String(file).endsWith(".js")) continue;
          const filePath = resolve(workerDir, String(file));
          const content = readFileSync(filePath, "utf-8");
          if (content.includes(sentinel)) {
            writeFileSync(filePath, content.replaceAll(sentinel, replacement));
          }
        }
      }
    },
  };
}

export default defineConfig({
  server: {
    port: 9019,
    host: true,
    allowedHosts: true,
  },

  preview: {
    port: 9019,
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
    ssrReload(),
    swc.vite({
      jsc: {
        parser: { syntax: "typescript", tsx: true },
        transform: {
          react: {
            runtime: "automatic",
            importSource: "hono/jsx",
            throwIfNamespace: false,
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
      // @monorepo-only-start
      "@jant/core": resolve(__dirname, "../../packages/core/src"),
      // @monorepo-only-end
    },
  },
});
