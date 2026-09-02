/**
 * Static site client entry point (Hugo theme).
 *
 * Loaded on exported Hugo sites to enable reading-surface interactions —
 * media lightbox, feed video autoplay, audio waveform, gallery scroll hints,
 * and the thread-context shell. Does NOT include Datastar, auth, toast, or
 * form plumbing; those are runtime-only concerns for the authenticated app.
 */

import "./client/audio-player.js";
import "./client/feed-video-player.js";
import "./client/media-scroll-hint.js";
import "./client/site-header-nav.js";
// A thread preview's ancestor context is server-rendered collapsed, and its
// "Show more" is the only way back out of that. Off-site pages render the same
// shell — the Hugo export's own thread-preview partial had to leave the shell
// out entirely because this was missing — so the reading surface owes them the
// script that makes it work. It binds on DOMContentLoaded to
// `[data-thread-context-toggle]` and does nothing on a page carrying none.
import "./client/thread-context.js";
import "./client/components/jant-media-lightbox.js";
import "./styles/site-media.css";
