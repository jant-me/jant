/**
 * Composer entry: the editor and everything that only runs while writing.
 *
 * Loaded by `client/lazy-entries.ts` — on first open through
 * `compose-launch.ts`, at once on the compose page — and preloaded by the
 * layout on every signed-in page. Never referenced from a script tag.
 */

import "./client/components/jant-compose-dialog.js";
import "./client/components/jant-compose-editor.js";
import "./client/components/jant-compose-fullscreen.js";
import "./client/compose-bridge.js";
import "./client/slash-discovery-bridge.js";

// Mount the fullscreen overlay at body level to escape the dialog's containing
// block (dialog animation creates a containing block that traps fixed children).
if (!document.querySelector("jant-compose-fullscreen")) {
  document.body.appendChild(document.createElement("jant-compose-fullscreen"));
}
