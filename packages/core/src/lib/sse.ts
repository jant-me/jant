/**
 * Server-Sent Events (SSE) utilities for Datastar v1.0.0-RC.7
 *
 * Generates SSE events compatible with the Datastar client's expected format.
 *
 * @see https://data-star.dev/
 *
 * @example
 * ```ts
 * app.post("/api/example", (c) => {
 *   return sse(c, async (stream) => {
 *     await stream.patchSignals({ loading: false });
 *     await stream.patchElements('<div id="result">Done!</div>');
 *     await stream.redirect("/success");
 *   });
 * });
 * ```
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
   * await stream.redirect('/dash/posts');
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
}

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
 *     await stream.redirect('/dash');
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
          const escapedUrl = url.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
          const script = `<script data-effect="el.remove()">window.location.href='${escapedUrl}'</script>`;
          const dataLines: string[] = [
            `elements ${script}`,
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
