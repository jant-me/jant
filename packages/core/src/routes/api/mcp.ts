import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { buildMcpWwwAuthenticateHeader } from "../../lib/agent-discovery.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { requireAuthApi } from "../../middleware/auth.js";
import { handleMcpHttpRequest } from "../../services/mcp.js";
import { triggerGitHubSyncInline } from "../../lib/github-sync-trigger.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const mcpApiRoutes = new Hono<Env>();

mcpApiRoutes.use("*", async (c, next) => {
  try {
    await requireAuthApi()(c, next);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return c.json({ error: err.message, code: err.code }, 401, {
        "WWW-Authenticate": buildMcpWwwAuthenticateHeader(c.var.appConfig),
      });
    }
    throw err;
  }
});

mcpApiRoutes.post("/", async (c) => {
  const response = await handleMcpHttpRequest(
    {
      bodyText: await c.req.text(),
      protocolVersionHeader: c.req.header("MCP-Protocol-Version"),
    },
    {
      appConfig: c.var.appConfig,
      env: c.env,
      services: c.var.services,
      storage: c.var.storage,
      // As after the same writes over HTTP (a no-op when sync is off).
      afterPostWrite: () => triggerGitHubSyncInline(c),
    },
  );

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});
