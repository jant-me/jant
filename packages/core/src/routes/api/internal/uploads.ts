import { Hono } from "hono";
import { z } from "zod";
import { requireInternalAdminApi } from "../../../middleware/auth.js";
import { getConfiguredStorageDriver } from "../../../lib/env.js";
import { parseValidated } from "../../../lib/schemas.js";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";
import { requireStorage } from "../../../lib/storage.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const CleanupUploadsSchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
});

export const internalUploadsRoutes = new Hono<Env>();

internalUploadsRoutes.post("/cleanup", requireInternalAdminApi(), async (c) => {
  const storage = requireStorage(c.var.storage);

  const contentType = c.req.header("Content-Type") || "";
  const rawBody = contentType.includes("application/json")
    ? await c.req.json().catch(() => ({}))
    : {};
  const body = parseValidated(CleanupUploadsSchema, rawBody);
  // Internal admin routes are mounted before the `withConfig` middleware,
  // so `c.var.appConfig` is undefined in production. Read the driver from env
  // directly — same source `createStorageDriver` used for `c.var.storage`.
  const result = await c.var.services.uploads.cleanupExpired({
    storage,
    storageDriver: getConfiguredStorageDriver(c.env),
    limit: body.limit,
  });

  return c.json(result);
});
