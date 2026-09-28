/**
 * Datastar response utilities for v1.0.4
 *
 * Provides both SSE (multi-event) and plain HTTP (single-event) response helpers.
 *
 * **Non-SSE helpers** (preferred for single operations):
 * - `dsRedirect(url)` — redirect via text/html
 * - `dsToast(message, type)` — toast notification via text/html
 * - `dsSignals(signals)` — signal patch via application/json
 *
 * **SSE** (for multiple operations in one response):
 * - `sse(c, handler)` — streaming SSE with full stream API
 *
 * Datastar auto-detects response type by Content-Type:
 * - `text/html` → dispatches as `datastar-patch-elements`
 * - `application/json` → dispatches as `datastar-patch-signals`
 *
 * @see https://data-star.dev/
 */

import type { Context } from "hono";

/**
 * Patch modes for DOM element updates
 *
 * @see https://data-star.dev/reference/action_plugins/backend/sse
 */
export type PatchMode =
  | "outer"
  | "inner"
  | "replace"
  | "prepend"
  | "append"
  | "before"
  | "after"
  | "remove";

/**
 * SSE stream writer for Datastar events
 */
export interface SSEStream {
  /**
   * Update reactive signals on the client
   *
   * @param signals - Object containing signal values to update
   * @param options - Optional settings (e.g. onlyIfMissing)
   *
   * @example
   * ```ts
   * await stream.patchSignals({ count: 42, loading: false });
   * ```
   */
  patchSignals(
    signals: Record<string, unknown>,
    options?: { onlyIfMissing?: boolean },
  ): void;

  /**
   * Update DOM elements via patching
   *
   * @param html - HTML content (must include element with id for targeting)
   * @param options - Optional patch mode, selector, and view transition
   *
   * @example
   * ```ts
   * // Outer patch element with matching id (default)
   * await stream.patchElements('<div id="content">New content</div>');
   *
   * // Append to a container
   * await stream.patchElements('<div>New item</div>', {
   *   mode: 'append',
   *   selector: '#list'
   * });
   * ```
   */
  patchElements(
    html: string,
    options?: {
      mode?: PatchMode;
      selector?: string;
      useViewTransition?: boolean;
    },
  ): void;

  /**
   * Redirect the client to a new URL
   *
   * Uses patchElements internally to inject a script that navigates the client.
   *
   * @param url - The URL to redirect to
   *
   * @example
   * ```ts
   * await stream.redirect('/settings');
   * ```
   */
  redirect(url: string): void;

  /**
   * Remove elements matching a CSS selector
   *
   * @param selector - CSS selector for elements to remove
   *
   * @example
   * ```ts
   * await stream.remove('#placeholder');
   * ```
   */
  remove(selector: string): void;

  /**
   * Show a toast notification
   *
   * Appends a toast element to `#toast-container` with auto-dismiss after 3s.
   *
   * @param message - The message to display
   * @param type - Toast type: "success" (default) or "error"
   *
   * @example
   * ```ts
   * await stream.toast("Settings saved successfully.");
   * await stream.toast("Something went wrong.", "error");
   * ```
   */
  toast(message: string, type?: "success" | "error"): void;
}

// ---------------------------------------------------------------------------
// Shared internal helpers (used by both SSE and non-SSE response builders)
// ---------------------------------------------------------------------------

/** Build the redirect script tag for Datastar patch-elements */
function buildRedirectScript(url: string): string {
  const escapedUrl = url.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `<div data-init="window.location.href='${escapedUrl}'; el.remove()"></div>`;
}

/** Build a toast notification HTML element */
function buildToastHtml(message: string, type: "success" | "error"): string {
  const cls = type === "error" ? "toast-error" : "toast-success";
  const icon =
    type === "error"
      ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
  const closeBtn = `<button class="toast-close" data-on:click="el.closest('.toast').classList.add('toast-out'); el.closest('.toast').addEventListener('animationend', () => el.closest('.toast').remove())"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`;
  const escapedMessage = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div class="toast ${cls}" data-init="el.closest('[popover]')?.showPopover(); setTimeout(() => { el.classList.add('toast-out'); el.addEventListener('animationend', () => el.remove()) }, 3000)">${icon}<span>${escapedMessage}</span>${closeBtn}</div>`;
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

/**
 * Format a single SSE event string
 *
 * @param eventType - The Datastar event type (e.g. "datastar-patch-elements")
 * @param dataLines - Array of "key value" data lines
 * @returns Formatted SSE event string
 */
function formatEvent(eventType: string, dataLines: readonly string[]): string {
  let event = `event: ${eventType}\n`;
  for (const line of dataLines) {
    event += `data: ${line}\n`;
  }
  event += "\n";
  return event;
}

/**
 * Create an SSE response for Datastar
 *
 * @param c - Hono context
 * @param handler - Async function that writes to the SSE stream
 * @param options - Optional response options (e.g. headers for cookie forwarding)
 * @returns Response with SSE content-type
 *
 * @example
 * ```ts
 * app.post("/api/upload", (c) => {
 *   return sse(c, async (stream) => {
 *     await stream.patchSignals({ uploading: false });
 *     await stream.patchElements('<div id="new-item">...</div>', {
 *       mode: 'append',
 *       selector: '#items'
 *     });
 *   });
 * });
 *
 * // With cookie forwarding (for auth)
 * app.post("/signin", (c) => {
 *   return sse(c, async (stream) => {
 *     await stream.redirect('/settings');
 *   }, { headers: { 'Set-Cookie': cookieValue } });
 * });
 * ```
 */
export function sse(
  c: Context,
  handler: (stream: SSEStream) => Promise<void>,
  options?: { headers?: Record<string, string> },
): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream({
    async start(controller) {
      const stream: SSEStream = {
        patchSignals(signals, opts) {
          const dataLines: string[] = [`signals ${JSON.stringify(signals)}`];
          if (opts?.onlyIfMissing) {
            dataLines.push("onlyIfMissing true");
          }
          controller.enqueue(
            encoder.encode(formatEvent("datastar-patch-signals", dataLines)),
          );
        },

        patchElements(html, opts) {
          const dataLines: string[] = [];
          // Each line of HTML gets its own "elements <line>" data line
          for (const line of html.split("\n")) {
            dataLines.push(`elements ${line}`);
          }
          if (opts?.mode) {
            dataLines.push(`mode ${opts.mode}`);
          }
          if (opts?.selector) {
            dataLines.push(`selector ${opts.selector}`);
          }
          if (opts?.useViewTransition) {
            dataLines.push("useViewTransition true");
          }
          controller.enqueue(
            encoder.encode(formatEvent("datastar-patch-elements", dataLines)),
          );
        },

        redirect(url) {
          const dataLines: string[] = [
            `elements ${buildRedirectScript(url)}`,
            "mode append",
            "selector body",
          ];
          controller.enqueue(
            encoder.encode(formatEvent("datastar-patch-elements", dataLines)),
          );
        },

        remove(selector) {
          controller.enqueue(
            encoder.encode(
              formatEvent("datastar-patch-elements", [
                "elements ",
                `mode remove`,
                `selector ${selector}`,
              ]),
            ),
          );
        },

        toast(message, type = "success") {
          const dataLines: string[] = [
            `elements ${buildToastHtml(message, type)}`,
            "mode append",
            "selector #toast-container",
          ];
          controller.enqueue(
            encoder.encode(formatEvent("datastar-patch-elements", dataLines)),
          );
        },
      };

      await handler(stream);
      controller.close();
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...options?.headers,
  };

  return new Response(body, { headers });
}

// ---------------------------------------------------------------------------
// Non-SSE Datastar helpers (for single-operation responses)
// ---------------------------------------------------------------------------

/**
 * Datastar redirect via text/html
 *
 * Returns a plain HTML response that Datastar dispatches as `datastar-patch-elements`.
 * Use instead of `sse()` when the only action is a redirect.
 *
 * @param url - The URL to redirect to
 * @param options - Optional extra headers (accepts any `HeadersInit`)
 * @returns Response with text/html content-type
 *
 * @example
 * ```ts
 * return dsRedirect("/settings");
 *
 * // With cookie forwarding (for auth)
 * return dsRedirect("/settings", { headers: authResponse.headers });
 * ```
 */
export function dsRedirect(
  url: string,
  options?: { headers?: Headers | Record<string, string> | string[][] },
): Response {
  const headers = options?.headers
    ? new Headers(options.headers)
    : new Headers();
  headers.set("Content-Type", "text/html");
  headers.set("Datastar-Mode", "append");
  headers.set("Datastar-Selector", "body");
  return new Response(buildRedirectScript(url), { headers });
}

/**
 * Datastar toast notification via text/html
 *
 * Returns a plain HTML response that Datastar dispatches as `datastar-patch-elements`.
 * Use instead of `sse()` when the only action is showing a toast.
 *
 * @param message - The message to display
 * @param type - Toast type: "success" (default) or "error"
 * @returns Response with text/html content-type
 *
 * @example
 * ```ts
 * return dsToast("Settings saved successfully.");
 * return dsToast("Something went wrong.", "error");
 * ```
 */
export function dsToast(
  message: string,
  type: "success" | "error" = "success",
): Response {
  return new Response(buildToastHtml(message, type), {
    headers: {
      "Content-Type": "text/html",
      "Datastar-Mode": "append",
      "Datastar-Selector": "#toast-container",
    },
  });
}

/**
 * Datastar signal patch via application/json
 *
 * Returns a JSON response that Datastar dispatches as `datastar-patch-signals`.
 * Use instead of `sse()` when the only action is updating signals.
 *
 * @param signals - Object containing signal values to update
 * @returns Response with application/json content-type
 *
 * @example
 * ```ts
 * return dsSignals({ _uploadError: "File too large" });
 * ```
 */
export function dsSignals(signals: Record<string, unknown>): Response {
  return new Response(JSON.stringify(signals), {
    headers: { "Content-Type": "application/json" },
  });
}
