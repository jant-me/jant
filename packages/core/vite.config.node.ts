/**
 * Node development server (`vite dev --config vite.config.node.ts --mode node`).
 *
 * Vite owns the HTTP server, client HMR, and SSR module invalidation.
 * Jant's Node runtime is attached as a middleware behind Vite's own handlers.
 */

import { getRequestListener } from "@hono/node-server";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig, loadEnv, runnerImport, type Plugin } from "vite";
import type { Bindings } from "./src/types/bindings.js";
import {
  buildVersion,
  swcPlugin,
  unbuiltClientAssetDefine,
} from "./vite.shared";
import { linguiAutoExtract, ssrReload } from "./vite.dev-plugins";

type NodeRuntime = typeof import("./src/node/request-handler.js");

const REQUEST_HANDLER = "/src/node/request-handler.ts";

/**
 * Load the Node runtime through Vite, the way every other `src/` module runs.
 *
 * Vite bundles this config with plain esbuild, so a static import of `src/`
 * here would skip the SWC Lingui transform and the `define` globals. The
 * request handler reaches `lib/filter-dimensions.ts` through its settings
 * validation, and that module calls `msg` at the top level: under Lingui 6 the
 * untransformed macro fails to load at all, and the server never started.
 */
async function importNodeRuntime(): Promise<NodeRuntime> {
  // `runnerImport` never reads a config file, so the transform and globals
  // `vite.config.script.ts` would supply are passed here.
  const { module } = await runnerImport<NodeRuntime>(
    resolve(import.meta.dirname, `.${REQUEST_HANDLER}`),
    {
      root: import.meta.dirname,
      logLevel: "warn",
      oxc: false,
      define: {
        __JANT_VERSION__: JSON.stringify(buildVersion),
        ...unbuiltClientAssetDefine,
      },
      plugins: [swcPlugin()],
    },
  );
  return module;
}

function nodeMiddleware(): Plugin {
  return {
    name: "node-dev-middleware",
    apply: "serve",
    async configureServer(server) {
      const env = process.env as unknown as Bindings;
      // The dev server's own graph, so the handler and the app it loads share
      // one copy of every module.
      const { createNodeRequestHandler, resolveHost } =
        (await server.ssrLoadModule(REQUEST_HANDLER)) as NodeRuntime;
      const handler = await createNodeRequestHandler({
        env,
        assetRoot: null,
        app: async () => {
          const module = await server.ssrLoadModule("/dev/entry.ts");
          return module.default;
        },
      });
      const requestListener = getRequestListener(
        (request) => handler.fetch(request),
        { hostname: resolveHost(env) },
      );

      server.httpServer?.once("close", () => {
        void handler.close();
      });

      return () => {
        server.middlewares.use(async (incoming, outgoing, next) => {
          if (outgoing.writableEnded) {
            return;
          }

          try {
            await requestListener(incoming, outgoing);
          } catch (error) {
            if (error instanceof Error) {
              server.ssrFixStacktrace(error);
              next(error);
              return;
            }

            next(new Error(String(error)));
            return;
          }

          if (!outgoing.writableEnded) {
            next();
          }
        });
      };
    },
  };
}

export default defineConfig(async ({ command, mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "");
  Object.assign(process.env, env);
  process.env.NODE_ENV ||= "development";

  const bindings = process.env as unknown as Bindings;
  const { applyNodeRuntimeEnvDefaults, migrate, resolveHost, resolvePort } =
    await importNodeRuntime();
  applyNodeRuntimeEnvDefaults(bindings, {
    defaultDataDir: resolve(import.meta.dirname, "data"),
  });

  if (command === "serve") {
    await migrate(bindings);
  }

  return {
    appType: "custom",
    // SWC owns the Node-side transforms; disable Vite 8's default Oxc layer.
    oxc: false,

    server: {
      port: resolvePort(bindings),
      host: resolveHost(bindings),
      allowedHosts: true,
    },

    preview: {
      port: resolvePort(bindings),
      host: resolveHost(bindings),
    },

    define: {
      __JANT_DEV__: "true",
      __JANT_VERSION__: JSON.stringify(buildVersion),
      ...unbuiltClientAssetDefine,
    },

    plugins: [
      tailwindcss(),
      swcPlugin(),
      linguiAutoExtract(),
      ssrReload(),
      nodeMiddleware(),
    ],
  };
});
