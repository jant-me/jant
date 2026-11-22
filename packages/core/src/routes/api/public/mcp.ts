/**
 * Public Read-Only MCP Route
 *
 * Exposes read-only MCP tools for browsing threads, reading full threads,
 * listing Collections, and searching public posts without authentication,
 * gated by `PUBLIC_API_ENABLED`.
 */

import { Hono } from "hono";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";
import { requirePublicApiEnabled } from "../../../middleware/public-content-access.js";
import { handlePublicMcpHttpRequest } from "../../../services/mcp.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const publicMcpApiRoutes = new Hono<Env>();

publicMcpApiRoutes.use("*", requirePublicApiEnabled());

publicMcpApiRoutes.post("/", async (c) => {
  const response = await handlePublicMcpHttpRequest(
    {
      bodyText: await c.req.text(),
      protocolVersionHeader: c.req.header("MCP-Protocol-Version"),
    },
    {
      appConfig: c.var.appConfig,
      env: c.env,
      services: c.var.services,
      storage: c.var.storage,
    },
  );

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});
