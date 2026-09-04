/**
 * Development server (`vite dev`).
 *
 * Full HMR with Tailwind, SWC (Lingui), and Cloudflare Workers.
 * Production builds use vite.config.worker.ts and vite.config.client.ts.
 */

import { defineConfig, loadEnv } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { parsePortValue } from "./src/lib/env.js";
import {
  buildVersion,
  clientBuildOptions,
  swcPlugin,
  workerBuildOptions,
} from "./vite.shared";
import { linguiAutoExtract, ssrReload } from "./vite.dev-plugins";

interface WorkerDevProcessOptions {
  port: number;
  wranglerConfig: string;
  disableInspector: boolean;
}

export function resolveWorkerDevProcessOptions(
  mode: string,
  envDir = import.meta.dirname,
): WorkerDevProcessOptions {
  // Vite loads .env files after evaluating its config. Load them explicitly
  // for settings that control Vite itself, while preserving shell precedence.
  const env = loadEnv(mode, envDir, "");

  return {
    port: parsePortValue(env.PORT),
    wranglerConfig: env.WRANGLER_CONFIG || "./wrangler.toml",
    disableInspector: Boolean(env.CLAUDE_CODE_REMOTE),
  };
}

export default defineConfig(({ mode }) => {
  const { port, wranglerConfig, disableInspector } =
    resolveWorkerDevProcessOptions(mode);

  return {
    // Vite 8 switched the default transform pipeline from esbuild to Oxc.
    // Keep Oxc disabled anywhere SWC owns the server-side transforms.
    oxc: false,

    server: {
      port,
      host: true,
      allowedHosts: true,
    },

    preview: {
      port,
    },

    define: {
      __JANT_DEV__: "true",
      __JANT_VERSION__: JSON.stringify(buildVersion),
      // Not used in dev (IS_VITE_DEV=true skips these paths), but required for
      // the TypeScript declarations in version.ts to compile.
      __CLIENT_JS_FILE__: JSON.stringify("/_assets/client.js"),
      __CLIENT_AUTH_JS_FILE__: JSON.stringify("/_assets/client-auth.js"),
      __CLIENT_COMPOSE_PRELOAD__: JSON.stringify([]),
      __CLIENT_CSS_FILE__: JSON.stringify("/_assets/client.css"),
      __CLIENT_CJK_CSS_FILE__: JSON.stringify("/_assets/client-cjk.css"),
      __CLIENT_CJK_TC_CSS_FILE__: JSON.stringify("/_assets/client-cjk-tc.css"),
      __CLIENT_CJK_JP_CSS_FILE__: JSON.stringify("/_assets/client-cjk-jp.css"),
      __CLIENT_CJK_KR_CSS_FILE__: JSON.stringify("/_assets/client-cjk-kr.css"),
    },

    environments: {
      client: {
        build: clientBuildOptions,
      },
    },

    worker: workerBuildOptions,

    plugins: [
      tailwindcss(),
      swcPlugin(),
      linguiAutoExtract(),
      ssrReload(),
      cloudflare({
        configPath: wranglerConfig,
        // Disable inspector in Claude Code remote containers.
        ...(disableInspector ? { inspectorPort: false } : {}),
      }),
    ],
  };
});
