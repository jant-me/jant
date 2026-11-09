/**
 * View Confirmation Route
 *
 * `POST /_/seen` takes the view token a page carried (`lib/view-token.ts`)
 * back from the browser that kept the page in view, and counts the view.
 * The token says which page and where the reader came from; this route
 * adds when. It answers 204 whatever it thinks of the token: a forger
 * learns nothing, and a reader's browser has already moved on.
 */

import { Hono } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { getEnvString } from "../lib/env.js";
import { now } from "../lib/time.js";
import { viewBuffer, type ViewBuffer } from "../lib/view-buffer.js";
import { formatDayKey, formatHourKey } from "../lib/view-counting.js";
import { verifyViewToken } from "../lib/view-token.js";
import { viewSinkFor } from "../middleware/view-counter.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * The confirmation route, mounted under `/_`.
 *
 * @param buffer - The buffer confirmed hits go to; tests pass their own
 * @returns A Hono app with `POST /seen`
 * @example
 * app.route("/_", createViewConfirmRoutes());
 */
export function createViewConfirmRoutes(buffer: ViewBuffer = viewBuffer) {
  const routes = new Hono<Env>();

  routes.post("/seen", async (c) => {
    const { appConfig } = c.var;
    const secret = getEnvString(c.env, "AUTH_SECRET");
    if (appConfig.stats.enabled && !c.var.isAuthenticated && secret) {
      const at = now();
      const claims = await verifyViewToken(
        secret,
        (await c.req.text()).trim(),
        at,
      );
      if (claims && claims.siteId === c.var.currentSite.id) {
        buffer.add(
          {
            siteId: claims.siteId,
            day: formatDayKey(at, appConfig.timeZone),
            hour: formatHourKey(at, appConfig.timeZone),
            page: claims.page,
            referrer: claims.referrer,
          },
          viewSinkFor(c),
        );
      }
    }
    return c.body(null, 204);
  });

  return routes;
}

export const viewConfirmRoutes = createViewConfirmRoutes();
