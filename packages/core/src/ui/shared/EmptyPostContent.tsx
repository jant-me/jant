/**
 * Empty Post Content
 *
 * The microformats floor for a card that renders neither a name nor any
 * content of its own.
 *
 * A microformats2 parser invents an h-entry's `name` from its text content
 * whenever the entry carries no explicit `p-name`, no `e-*` property, and no
 * nested microformat. The author's card ships every `PostStatusBadges` badge in
 * the DOM and hides the inapplicable ones with CSS — which a parser does not
 * run — so a card with nothing else in it publishes a title of
 * "PinnedPinnedPrivateDraft" followed by its own date.
 *
 * An explicit empty `e-content` states what is true, that this entry has no
 * text content, and that is enough to stop the guess.
 *
 * It carries neither `prose` nor `data-post-body` on purpose: the body-width
 * CSS and the client scripts that look up a post's body must not see it.
 */

import type { FC } from "hono/jsx";

export const EmptyPostContent: FC = () => <div class="e-content"></div>;
