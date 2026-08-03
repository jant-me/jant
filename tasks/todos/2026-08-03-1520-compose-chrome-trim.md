# Compose chrome trim

Reported: the thread rail's dots are too heavy, the collection trigger is too
big and carries a redundant chevron, and the dialog header row (Cancel / title /
Drafts) is pure chrome. Reference: the "Jant Compose — 最终形态" artifact.

Follow-up: with the header gone the action row looked oversized, the single
drafts entry was doing two jobs, the collection popover was still desktop-large,
and the missing title needed somewhere free to live.

## Tasks

- [x] Thread rail: small flat dots (7px, no surface border, no ring) in compose
      only; `.thread-group` in the feed keeps its current markers
- [x] Collection trigger: the artifact's layers glyph, no chevron, no round icon
      chip, one step smaller
- [x] Delete the dialog header row (`_renderHeader`) and its four title labels
- [x] Cancel → a persistent `×` at the right of the post header row (single /
      reply / edit; not thread, not page mode)
- [x] Drafts → a row in the post options panel, plus a "Close compose" row so a
      thread always has a visible exit
- [x] Action row: Publish / options / collection step down 2.4 / 2.2 / 1.95rem
      on a cursor, old sizes restored on touch
- [x] Split the drafts entry: "Save as draft" (action) above "Drafts" (place),
      only once there is something to save
- [x] "Editing" marker in the free `1/3` slot; dialog `aria-label` for the name
      the title bar used to carry
- [x] Collection popover one step tighter on desktop, roomier set kept on touch
- [x] Drop the accent tint from "Editing" — it sits in the position marker's
      slot and should carry that slot's weight
- [x] Fix reply numbering: a reply continues an existing chain, so replying to
      the 2nd post of a thread is `3/3` (new `posts.getThreadPosition`)
- [x] Fix `/new` page: the format row kept the dialog's gutter and sat 16px
      right of the title field under it
- [ ] "Done" vs "Post" button size — measured identical on every surface; needs
      a pointer to where they diverge
- [x] Verify: `mise run check-tests`, `check-lint`, `check-format`, browser pass
      over single / reply / thread / fullscreen / page compose

## Review

**Rail dots** — `--site-thread-marker-*` was one token block shared by
`.thread-group` and `.compose-thread-layout`; it is now split, and compose's
marker goes 10px + 2px surface border + 2px ring → a flat 7px dot with neither.
The old ring alone was wider than the whole dot is now. The feed's markers are
untouched: a read view has to mark where each post starts in a wall of text,
while compose already has a card edge, a format selector and a `1/3` per post.
`.compose-editor-row .compose-thread-dot` no longer shares a rule with
`.thread-group-preview .thread-item-hero::before` (that rule also carried a
`left:` built from `--site-thread-rail-*`, which compose never defines, so it
resolved to `auto` — a no-op that only looked meaningful).

To resize the marker without moving the rail, the dependency is now inverted:
`--compose-thread-dot-center` is stated per row context and the dot derives
`margin-top` from it, instead of both restating the same sum (the old comment
said "keep the two in step", which is the smell). Measured in the browser: dot
centres land at 26.75px in thread compose and 14.75 / 36px in reply compose —
the same numbers the previous pass verified — and the rail's trimmed ends match
them exactly. Fullscreen's two `margin-top` overrides are gone; they were the
source of the 0.75px drift noted last time, and it now lands exact.

**Header row** — deleted. It held a title that restated what an empty composer
already says, and `Update` on the Publish button already covers the one case
("Edit") where the title carried information. Its two controls moved to where
they are used:

- Cancel → a `×` at the end of the post header row, next to the date/permalink
  pill. Always visible, unlike the per-post remove `×` which fades in on hover —
  this is the way out. It is passed through the editor's existing `headerExtra`
  slot rather than adding a prop, so the dialog keeps ownership of it. Not
  rendered in page mode (where the old Cancel was already `display: none`) or in
  a thread, where each post spends that slot on removing itself.
- Drafts → the options panel (see below).
- A "Close compose" row joins them in thread mode only, so a thread on a phone —
  no Escape key, no backdrop — still has a visible exit. It routes through
  `requestClose`, so the "Save to drafts?" prompt is unchanged.

The edit-loading state gets its own close row for the same reason: the post
header it normally rides on has not rendered yet.

The top gutter the header provided moved to `.compose-dialog-inner`
(`padding-top: 10px`, `+ env(safe-area-inset-top)` on phones, `0` in page mode).
It cannot sit on the first row: single-post mode's wrapper is `display: contents`
and generates no box to pad.

**What replaced the title** — nothing visible, in three of four modes, because
nothing was missing: a reply shows its parent, a thread shows `2/3`, and Publish
reads "Update" when editing. Only "Editing" says something unreadable off the
composer — this post is already live — so that one word goes in the position
marker's slot, which single-post mode leaves empty (new `badgeLabel` prop on the
editor). It carries the marker's own weight rather than an accent tint: it is
sitting in that marker's slot, and everything in that row except the format
selector is deliberately quiet. There is deliberately no "New post" counterpart
— a marker that is always present is the header row again, only smaller, and
absence is what makes this one worth reading. The dialog's _accessible_ name did
go missing with the title, so it moves to an `aria-label` on the host
`<dialog>`, which costs no pixels.

**Action row** — the collection pill dropping to 1.95rem left a 2.8rem Publish
looking like it came from a different screen. The three controls now step down
2.4 / 2.2 / 1.95rem (35 / 32 / 29.6px measured — this theme's rem is ~14.6px),
so Publish still leads on fill and weight without leading on bulk. The touch
block restores the old 2.8 / 2.5 / 2.5rem: 35px is a fine mouse target and a
poor thumb one. That block also puts the collection trigger back above where the
first pass had left it (2.3rem), which was a touch-target regression.

**Drafts, split** — "Save as draft" is an action on what is in front of you;
"Drafts" is a place to go. One row could not be both, and the old title-bar
button proved it: it read "Save as draft" and then dropped you in the list.
Now, once `_hasContent()`, two rows appear — the action first, saving and
closing with no prompt in the way, then the list, which keeps the existing
"save first?" confirm because it is still abandoning unsaved work. With an empty
composer only "Drafts" shows. The action row has no caret and the destination
does, so the two kinds are distinguishable before reading. No new strings:
`saveAsDraft` and `drafts` both already existed.

**Collection popover** — every dimension was tuned for a thumb and used on a
desktop. Desktop now: 13.5–17rem wide (was 16–20), 2.35rem rows (was 3), 2.25rem
search shell (was 2.8), 12.5rem list (was 15), tighter padding and radii. The
touch block already overrode most of these with the larger set, so it keeps
them; I added the few it was missing (search icon, list height, footer row,
search radius) so the two sizes stay complete rather than half-inherited.
Measured: the popover goes from roughly 260×370 to 222×281 with five
collections.

**Reply numbering (bug)** — the editors were numbered from 1, so `1/2` sat under
a parent that visibly occupied slot 1 on the same rail, and a plain reply got no
marker at all. Counting the parent as one post fixed the rail contradiction but
was still wrong: a reply continues a chain that already exists, so replying to
the second post of a thread makes the _third_, not the second.

Only the parent's own depth can supply that, so it comes from the server. New
`posts.getThreadPosition(id)` returns the 1-based position of a post in the
chain from its thread root: one read for the post, one for its thread, then walk
`replyToId` upward in memory (a chain of N would otherwise be N round trips),
with a `visited` guard so a bad row cannot hang the request. `GET /api/posts/:id`
returns it as `threadPosition`, joining the three reads that route already runs
in parallel.

`openReply` fires that lookup without awaiting it — blocking the composer's open
on a decoration would be a bad trade — and the marker stays hidden until the
number arrives, because a chip that reads `2/2` and then jumps to `3/3` is worse
than one that appears late. A failed lookup simply leaves it hidden.

`_positionLabel` owns the rest: a new thread is unchanged at `1/N`; a lone new
post stays unmarked (not `1/1`); an edit shows none, because the post may have
replies below it that compose cannot see, so any total would be a guess — its
"Editing" marker holds that slot instead. `_renderThreadPost` lost its
now-unused `total` parameter.

Worth recording, found while writing the tests: `create` rejects a reply to
anything but the tail of a thread ("This post is no longer the end of the
thread"), so threads are strict chains, not trees. Depth therefore equals thread
size today. `getThreadPosition` still walks the chain rather than counting
`threadId` members, because a partially built draft chain would break the
shortcut.

**Page-mode alignment (bug)** — `.compose-thread-post-header` kept the dialog's
16px gutter on the `/new` page while the body and tools rows had theirs zeroed,
so the format selector sat 16px right of everything under it. Page mode now
zeroes it too; the selector, the title field and the tools row all start at the
same x.

**"Done" vs "Post"** — could not reproduce, and I do not believe there is a size
difference to fix. There is exactly one publish-button render site, so both
labels are the same element with the same classes; measured at 78.75×36 in every
state (page mode, dialog new-disabled, dialog new-enabled, dialog edit). What
does differ is fill: with an empty composer Post is _disabled_ and renders as a
pale grey pill, while Done in edit mode is enabled and renders solid black, and
a filled pill reads heavier at identical dimensions. Left alone pending a
pointer to the surface where the sizes actually diverge. (`.compose-publish-single`
in the stylesheet is dead — nothing renders it — which is what made this take
longer than it should have.)

Verified with `mise run check-tests` (248 files, 3047 tests), `check-lint`,
`check-format`, and a browser pass over single, reply, 3-post thread, fullscreen
and page compose — rail geometry measured against the previous pass's numbers,
the `×` closing compose, "Save as draft" writing a real draft and closing (the
draft count went 0 → 1), the options panel's rows, the "Editing" marker, and all
five numbering cases (none / `2/2` / `2/3`+`3/3` / `1/2`+`2/2` / none).
The mobile breakpoint was checked by rule inspection only: the browser window
would not resize below 1230px in this session. `i18n-build` regenerated the
three public catalogs; `i18n-check` compares against HEAD, so it only passes
once they are committed.
