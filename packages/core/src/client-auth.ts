/**
 * Authenticated client entry point.
 *
 * Extends the public bundle with editor, upload, and settings interactions
 * that should not be shipped to anonymous page views.
 */

import "./client.js";
import "./client/image-processor.js";
import "./client/avatar-upload.js";
import { ensureConfirmDialog } from "./client/confirm.js";
import "./client/components/jant-compose-dialog.js";
import "./client/components/jant-compose-editor.js";
import "./client/components/jant-compose-fullscreen.js";
import "./client/compose-bridge.js";
import "./client/compose-discovery-bridge.js";
import "./client/slash-discovery-bridge.js";
import "./client/compose-shortcuts.js";
import "./client/components/jant-settings-general.js";
import "./client/components/jant-settings-language.js";
import "./client/components/jant-settings-avatar.js";
import "./client/components/jant-config-editor.js";
import "./client/settings-bridge.js";
import "./client/components/jant-repo-picker.js";
import "./client/components/jant-collection-form.js";
import "./client/components/jant-collection-directory.js";
import "./client/components/jant-post-form.js";
import "./client/post-form-bridge.js";
import "./client/components/jant-nav-manager.js";
import "./client/components/jant-post-menu.js";
import "./client/collection-page-actions.js";
import "./client/smart-collection-page-actions.js";
import "./client/custom-url-menu.js";
import "./client/components/jant-command-palette.js";
import "./client/palette-shortcuts.js";
import "./client/palette-search-trigger.js";

// Mount fullscreen overlay at body level to escape the dialog's containing
// block (dialog animation creates a containing block that traps fixed children).
if (!document.querySelector("jant-compose-fullscreen")) {
  document.body.appendChild(document.createElement("jant-compose-fullscreen"));
}

ensureConfirmDialog();

// Mount command palette at body level (auth-only)
if (!document.querySelector("jant-command-palette")) {
  document.body.appendChild(document.createElement("jant-command-palette"));
}
