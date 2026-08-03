# Compose UI polish

Reported: format selector too small, "Now · Auto" pill too loud + wrong copy,
options icon next to Publish is ugly, replies should not show a title by
default (restore the T toggle), thread rail should stop at the last post's dot.

## Tasks

- [x] Format selector (`.compose-thread-segmented`): one step larger
- [x] Post meta pill: `Now · Auto` → `Now · /…`, drop the link icon, quieter resting state
- [x] Options trigger icon: drop the enclosing rounded box, redraw as sliders
- [x] Restore the note title toggle (`T`): on by default on a root post, off on a
      reply/continuation, user-overridable; persists through drafts + fullscreen
- [x] Thread rail: draw per-row segments so the line ends at the last post's dot
- [x] Bring back the "Hide from Latest" / "Reply quietly" shortcuts under Publish
- [x] Verify: `mise run check-tests`, `check-lint`, `check-format`, browser pass

## Review

**Format selector** — `.compose-thread-segmented` items go from `3px 11px` /
`--type-ui-caption` to `5px 13px` / `--type-ui-hint`; container radius 9 → 11px.
Measured 184×32px; still fits beside the pill and the `1/3` marker at 375px.

**Post meta pill** — `publishSlugSummaryAuto` is now `/…` instead of `Auto`, so
the value reads the same shape as a real permalink (`/my-post`). The link icon
is gone (the slash says it) and the resting state drops its border and
background for `color-mix(--site-text-secondary 62%)`. Hover restores the
outline; `.compose-post-meta-set` (a date or permalink the author chose) keeps
full contrast and gains a paper background so it still reads as a set value.

**Options trigger** — the rounded-square-with-sliders icon became two plain
slider tracks on a 24 grid at 1.35rem. A boxed icon inside a round ghost button
was two competing frames.

**Title toggle** — `_showTitle` is back on the editor, seeded on first update
from a new `titleByDefault` prop: true for a post that opens a thread, false for
a reply or a continuation post (`i === 0 && !isReply`). A post that arrives with
a title always shows the field, so editing a titled reply can't silently drop
it. `convertComposeFormat` only ever forces the toggle open (when a title comes
in from another format), so note → link → note keeps the user's choice. The
local draft now stores the toggle as-is rather than "does a title exist", so
restoring puts back an open-but-empty field. Fullscreen keeps the reveal
placeholder as its way back to a title, since it has no toolbar.

Dropped `showTitle` from `ComposeStateSnapshot`: a hidden title reads back as an
empty one, so the dirty check already sees it in `title`.

**Thread rail** — was one absolutely-positioned strip on `.compose-thread-layout`
running to `bottom: 0`, i.e. down the whole of the last (tallest) row. Now each
row draws its own segment, with `--compose-thread-dot-center` trimming the first
row's to start at its dot and the last post's to stop at its. The add-to-thread
placeholder draws none. Verified the endpoints land on the dot centres exactly
in thread compose (26.75px) and reply compose (14.75 / 36px), and within 0.75px
in fullscreen.

**Quick toggles** — `_renderQuickActionsRow` is back under the action row, with
the same two checkboxes 9602fd0a removed. Both are shortcuts into the options
panel, not a second source of truth: flipping one moves `_visibility` /
`_quietReply` and the panel's radio list and switch follow, as does the Publish
button label ("Post hidden", "Reply quietly"). "Hide from Latest" covers the
public ↔ hidden pair and hides itself once the post is private or the visibility
is locked (a reply, which inherits the root's) — a checkbox can't stand in for a
three-state setting, which is why it was pulled the first time. In page mode the
row takes the page gutter so it lines up under Publish; it is not sticky, so a
scrolled page pins the action row above it, exactly as before the removal.

Verified with `mise run check-tests` (248 files), `check-lint`, `check-format`,
plus a browser pass over single / reply / 3-post thread / fullscreen compose.
`i18n-build` regenerated the three public catalogs (`i18n-check` compares against
HEAD, so it only passes once those are committed).
