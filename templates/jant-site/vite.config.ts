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
    hotUpdate({ modules, server }) {
      if (this.environment.name !== "client" && modules.length > 0) {
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
    const manifestPath = resolve(
      process.cwd(),
      clientOutDir,
      ".vite/manifest.json",
    );
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
      clientOutDir =
        (config as any).environments?.client?.build?.outDir ?? "dist/client";
    },

    // 1. Try during transform (works when previous client build exists on disk)
    transform(code, _id, options) {
      if (!options?.ssr) return;
      if (!code.includes("__VITE_MANIFEST_CONTENT__")) return;

      const manifestContent = readManifest();
      if (!manifestContent) return;

      const newCode = code.replace(
        /"__VITE_MANIFEST_CONTENT__"/g,
        buildReplacement(manifestContent),
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

  // Exclude @lingui/react from dependency optimization
  // Why: Source code uses `@lingui/react/macro` (for Lingui SWC plugin recognition),
  // but SWC rewrites imports to `@jant/core/i18n` at compile time (see runtimeModules config).
  // Vite's dependency scanner sees the source imports and warns about missing @lingui/react.
  // This is harmless but causes multiple reloads. Excluding prevents the warning.
  optimizeDeps: {
    exclude: ["@lingui/react"],
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
                runtimeModules: {
                  useLingui: ["@jant/core/i18n", "useLingui"],
                  trans: ["@jant/core/i18n", "Trans"],
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
      // Disable inspector in Claude Code remote containers.
      // The proxy intercepts miniflare's localhost inspector connection causing startup failure.
      ...(process.env.CLAUDE_CODE_REMOTE ? { inspectorPort: false } : {}),
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

  // @create-jant: @remove-start
  resolve: {
    alias: {
      // Monorepo development aliases
      // - @lingui/react/macro: Prevents Vite dependency scan error. Source code imports
      //   from @lingui/react/macro (for SWC plugin), but we use Hono JSX. SWC rewrites
      //   these at compile time, but Vite scans before SWC runs.
      // - @jant/core: Points to source for HMR during development.
      // Note: User projects don't need @lingui/react/macro alias because they use
      //   node_modules/@jant/core/dist/ (already compiled by SWC, imports rewritten).
      "@lingui/react/macro": resolve(
        __dirname,
        "../../packages/core/src/i18n/index.ts",
      ),
      "@jant/core": resolve(__dirname, "../../packages/core/src"),
    },
  },
  // @create-jant: @remove-end
});
