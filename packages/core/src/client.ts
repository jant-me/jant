/**
 * Public client entry point.
 *
 * Loaded on every page, so keep it limited to shared interactions used by
 * anonymous pages as well as authenticated ones.
 */

import "./vendor/datastar.js";
import { installPrefixedFetch } from "./client/runtime-paths.js";
import "./client/audio-player.js";
import "./client/feed-video-player.js";
import "./client/media-scroll-hint.js";
import "./client/form-enter-submit.js";
import "./client/copy-field.js";
import "./client/components/jant-media-lightbox.js";
import "./client/components/jant-text-preview.js";
// First-run setup is a signed-out page, so the language picker it shares with
// the settings page has to ship in the public bundle.
import "./client/components/jant-locale-picker.js";
import "./client/toast.js";
import "./client/thread-context.js";
import "./client/note-expand.js";
import "./client/archive-nav.js";
import "./client/site-header-nav.js";
import "./client/collection-sort-menu.js";
import "./client/footnote-rail.js";

declare const __JANT_VERSION__: string;

installPrefixedFetch();
document.documentElement.dataset.jantVersion = __JANT_VERSION__;
