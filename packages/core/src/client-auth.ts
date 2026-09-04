/**
 * Authenticated client entry point: the shell every signed-in page loads.
 *
 * Extends the public bundle with what an author uses on any page — the post
 * menu, the command palette, keyboard shortcuts, the buttons that open the
 * composer — and leaves the rest to `client/lazy-entries.ts`, which loads the
 * editor, settings, and management entries by what the page contains.
 */

import "./client.js";
import { ensureConfirmDialog } from "./client/confirm.js";
import "./client/components/jant-post-menu.js";
// The post menu renders the collection form inline when a post needs a new
// collection, so the form's definition travels with the menu.
import "./client/components/jant-collection-form.js";
import "./client/components/jant-command-palette.js";
import "./client/palette-shortcuts.js";
import "./client/palette-search-trigger.js";
import "./client/compose-triggers.js";
import "./client/compose-shortcuts.js";
import "./client/compose-discovery-bridge.js";
import { loadEntriesForPage } from "./client/lazy-entries.js";

ensureConfirmDialog();

// Mount command palette at body level (auth-only)
if (!document.querySelector("jant-command-palette")) {
  document.body.appendChild(document.createElement("jant-command-palette"));
}

loadEntriesForPage();
