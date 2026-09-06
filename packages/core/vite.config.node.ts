/**
 * Node development server (`vite dev --config vite.config.node.ts --mode node`).
 *
 * Vite owns the HTTP server, client HMR, and SSR module invalidation.
 * Jant's Node runtime is attached as a middleware behind Vite's own handlers.
 */

import { getRequestListener } from "@hono/node-server";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import {
  applyNodeRuntimeEnvDefaults,
  createNodeRequestHandler,
  migrate,
  resolveHost,
  resolvePort,
} from "./src/node/request-handler.js";
import type { Bindings } from "./src/types/bindings.js";
import { buildVersion, swcPlugin } from "./vite.shared";
import { linguiAutoExtract, ssrReload } from "./vite.dev-plugins";

function nodeMiddleware(): Plugin {
  return {
    name: "node-dev-middleware",
    apply: "serve",
    async configureServer(server) {
      const env = process.env as unknown as Bindings;
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
      // Not used in dev (IS_VITE_DEV=true skips these paths), but required for
      // the TypeScript declarations in version.ts to compile.
      __CLIENT_JS_FILE__: JSON.stringify("/_assets/client.js"),
      __CLIENT_AUTH_JS_FILE__: JSON.stringify("/_assets/client-auth.js"),
      __CLIENT_COMPOSE_PRELOAD__: JSON.stringify([]),
      __CLIENT_CSS_FILE__: JSON.stringify("/_assets/client.css"),
      __CLIENT_AUTHOR_CSS_FILE__: JSON.stringify("/_assets/client-author.css"),
      __CLIENT_CJK_CSS_FILE__: JSON.stringify("/_assets/client-cjk.css"),
      __CLIENT_CJK_TC_CSS_FILE__: JSON.stringify("/_assets/client-cjk-tc.css"),
      __CLIENT_CJK_JP_CSS_FILE__: JSON.stringify("/_assets/client-cjk-jp.css"),
      __CLIENT_CJK_KR_CSS_FILE__: JSON.stringify("/_assets/client-cjk-kr.css"),
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
