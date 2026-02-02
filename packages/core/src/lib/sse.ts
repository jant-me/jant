/**
 * Server-Sent Events (SSE) utilities for Datastar
 *
 * Provides helpers for streaming SSE responses that Datastar can consume.
 * Datastar uses SSE for real-time UI updates without page reloads.
 *
 * @see https://data-star.dev/
 *
 * @example
 * ```ts
 * app.post("/api/example", (c) => {
 *   return sse(c, async (stream) => {
 *     await stream.patchSignals({ loading: false });
 *     await stream.patchElements("#result", "<div>Done!</div>");
 *   });
 * });
 * ```
 */

import type { Context } from "hono";

/**
 * Patch modes for DOM updates
 */
export type PatchMode = "morph" | "inner" | "outer" | "append" | "prepend" | "remove";

/**
 * SSE stream writer for Datastar events
 */
export interface SSEStream {
  /**
   * Update reactive signals on the client
   *
   * @param signals - Object containing signal values to update
   *
   * @example
   * ```ts
   * await stream.patchSignals({ count: 42, loading: false });
   * ```
   */
  patchSignals(signals: Record<string, unknown>): Promise<void>;

  /**
   * Update DOM elements
   *
   * @param html - HTML content (must include element with id for targeting)
   * @param options - Optional mode and selector
   *
   * @example
   * ```ts
   * // Replace element with matching id (default: morph)
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
    options?: { mode?: PatchMode; selector?: string }
  ): Promise<void>;

  /**
   * Execute JavaScript on the client
   *
   * @param script - JavaScript code to execute
   *
   * @example
   * ```ts
   * await stream.executeScript('console.log("Hello from server")');
   * ```
   */
  executeScript(script: string): Promise<void>;
}

/**
 * Create an SSE response for Datastar
 *
 * @param c - Hono context
 * @param handler - Async function that writes to the SSE stream
 * @returns Response with SSE content-type
 *
 * @example
 * ```ts
 * app.post("/api/upload", (c) => {
 *   return sse(c, async (stream) => {
 *     // Process upload...
 *     await stream.patchSignals({ uploading: false });
 *     await stream.patchElements('<div id="new-item">...</div>', {
 *       mode: 'append',
 *       selector: '#items'
 *     });
 *   });
 * });
 * ```
 */
export function sse(
  c: Context,
  handler: (stream: SSEStream) => Promise<void>
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const write = (data: string) => {
        controller.enqueue(encoder.encode(data));
      };

      const sseStream: SSEStream = {
        async patchSignals(signals) {
          write(`event: datastar-patch-signals\n`);
          write(`data: signals ${JSON.stringify(signals)}\n\n`);
        },

        async patchElements(html, options = {}) {
          write(`event: datastar-patch-elements\n`);
          if (options.mode) {
            write(`data: mode ${options.mode}\n`);
          }
          if (options.selector) {
            write(`data: selector ${options.selector}\n`);
          }
          // Escape newlines in HTML for SSE format
          const escapedHtml = html.replace(/\n/g, "\ndata: ");
          write(`data: elements ${escapedHtml}\n\n`);
        },

        async executeScript(script) {
          write(`event: datastar-execute-script\n`);
          write(`data: script ${script}\n\n`);
        },
      };

      try {
        await handler(sseStream);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
