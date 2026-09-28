import { serve, type ServerType } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import type { HonoApp } from "../types/app-context.js";
import type { Bindings } from "../types/bindings.js";
import {
  createNodeRequestHandler,
  resolveHost,
  resolvePort,
} from "./request-handler.js";
import { registerTelegramPoolWebhooks } from "../lib/telegram-pool-webhooks.js";

export {
  applyNodeRuntimeEnvDefaults,
  createNodeBindings,
  createNodeRequestHandler,
  migrate,
  resolveDatabasePath,
  resolveNodeAssetRoot,
  resolveNodeDataDir,
  resolveHost,
  resolveNodeMigrationsDir,
  resolvePort,
  resolvePublicRequestUrl,
} from "./request-handler.js";

export interface NodeServerHandle {
  close(): Promise<void>;
  server: ServerType;
  url: string;
}

export async function start(
  env: Bindings = process.env as unknown as Bindings,
  app?: HonoApp,
): Promise<NodeServerHandle> {
  const handler = await createNodeRequestHandler({
    env,
    app: async () => app ?? (await import("../app.js")).createApp(),
  });
  const hostname = resolveHost(env);
  const port = resolvePort(env);

  return new Promise<NodeServerHandle>((resolvePromise, reject) => {
    let didResolve = false;
    const server = serve(
      { fetch: handler.fetch, hostname, port },
      (info: AddressInfo) => {
        didResolve = true;
        server.off("error", onError);

        // Fire-and-forget: self-register managed-pool Telegram webhooks once
        // the server is listening. Never awaited — it must not delay readiness
        // or fail startup. No-ops unless this is a hosted deployment.
        void registerTelegramPoolWebhooks(env);

        let closed = false;
        resolvePromise({
          server,
          url: `http://${info.address}:${info.port}`,
          async close() {
            if (closed) {
              return;
            }
            closed = true;
            await new Promise<void>((resolveClose, rejectClose) => {
              server.close((error?: Error) => {
                if (error) {
                  rejectClose(error);
                  return;
                }
                resolveClose();
              });
            });
            await handler.close();
          },
        });
      },
    );

    function onError(error: Error) {
      if (didResolve) {
        return;
      }
      try {
        void handler.close();
      } catch {
        // ignore cleanup failure
      }
      reject(error);
    }

    server.once("error", onError);
  });
}
