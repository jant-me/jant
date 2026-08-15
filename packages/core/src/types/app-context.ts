/**
 * App Context Types
 *
 * Shared app-level types used across routes, middleware, and lib.
 * Lives here (not in app.tsx) to avoid forbidden upward imports
 * from feature modules to composition roots.
 */

import type { Hono } from "hono";
import type { Services } from "../services/index.js";
import type { HostedHandoffService } from "../services/hosted-handoff.js";
import type { Auth } from "../auth.js";
import type { AppConfig } from "./config.js";
import type { RateLimiter } from "../lib/rate-limit.js";
import type { StorageDriver } from "../lib/storage.js";
import type { Bindings } from "./bindings.js";
import type { Site, SiteDomain } from "./entities.js";

/**
 * Session payload as returned by better-auth's `getSession`.
 * Populated once per request by the `attachSession` middleware.
 */
export type AppSession = Awaited<ReturnType<Auth["api"]["getSession"]>>;

export interface AppVariables {
  services: Services;
  /**
   * Builds a `Services` object scoped to an arbitrary site. Used by
   * host-agnostic handlers (e.g. the Telegram webhook) that resolve the
   * target site from request data rather than the hostname.
   */
  servicesForSite: (siteId: string) => Services;
  hostedHandoff: HostedHandoffService;
  auth: Auth;
  currentSite: Site;
  currentSiteDomain: SiteDomain | null;
  appConfig: AppConfig;
  allSettings: Record<string, string>;
  themeStyle: string;
  storage: StorageDriver | null;
  publicRequestUrl: string;
  publicPath: string;
  /**
   * Cached session for the current request. `null` when unauthenticated or
   * when the session lookup errored. Populated by `attachSession` middleware.
   */
  session: AppSession;
  /** True when `session?.user` is set. Shortcut for the common read. */
  isAuthenticated: boolean;
  /**
   * Runtime-appropriate rate limiter. Populated per-request from the
   * runtime (D1 on Workers, in-memory on Node). Middleware calls
   * `c.var.rateLimiter.check(...)` instead of caring which impl is used.
   */
  rateLimiter: RateLimiter;
  /**
   * Language whose browsing view is being served, set by the language routes
   * when the URL carries a language prefix (`/en/archive`). Undefined on the
   * root view, which shows the primary language — or every language, when
   * multilingual content is off.
   */
  viewLang?: string;
}

export type App = Hono<{ Bindings: Bindings; Variables: AppVariables }>;
