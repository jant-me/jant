# Compose: quiet the toolbar and the add-to-thread row

Reported (with a threads.com screenshot): our compose toolbar and the
"Add to thread" affordance shout compared to threads.com, where both sit almost
at the edge of visibility. Asked for: drop the add-to-thread icon, weaken the
toolbar's active state, and quiet the toolbar overall.

Reference read of threads.com's composer: outline icons in a light gray, no
separator rules, no chip behind a tool that is on, and "Add to thread" as plain
gray text next to the rail slot — no plus glyph.

## Tasks

- [x] Drop the `⊕` from both add-to-thread renderers (thread row + single-post
      trigger); the rail's dashed dot already marks the slot
- [x] Toolbar ink: new `--compose-tool-ink` a step back from
      `--site-text-secondary`, hover/active step it forward instead of lighting
      a chip
- [x] Active state: no `--compose-control-bg-strong` chip — the tool inks up to
      the row's old weight and the panel it opened carries the state
- [x] Add `aria-pressed` to the emoji and rate toggles, now that the visual
      state is colour only
- [x] Separator hairline → air (`.compose-tool-sep` → `.compose-tool-gap`)
- [x] One stroke weight for every toolbar icon, set in CSS, thinner than 1.55
- [x] Labelled tool (`Add more`) keeps text weight — the faded ink is under the
      4.5:1 floor for reading matter
- [x] Verify: contrast of the new ink in light and dark, browser pass over
      single / thread / `/new` page compose, `check-tests` + `check-lint` +
      `check-format`

## Follow-up: the composer opens too tall

Same report, second round: threads.com's composer opens at roughly one line and
ours reserved four. Proposed note ≈ 60px, quote textarea ≈ 120px.

- [x] Editor floor 120px → two lines, stated as `calc(--type-body-leading * 2em)`
- [x] Quote textarea `9rem` / `9.5rem` → four lines, `calc(--compose-quote-input-leading * 4em)`;
      `rows` follows (5 → 4) so the two stop disagreeing
- [x] One floor for every editor: delete `.compose-tiptap-thoughts` (72px) and
      `.compose-tiptap-thoughts-quote` (56px) and their classes
- [x] Reply layout stops restating `min-height: 6.5rem` twice — the shared floor
      already reads its leading and type size
- [x] Blank body forwards a click to the editor, so the surfaces that reserve
      height don't leave dead paper
- [ ] Open question for the user: `/new` still reserves `clamp(16rem, 36vh, 24rem)`
      (295px measured) via `.compose-page-shell .compose-dialog-inner-page
.compose-body`, so on that surface the two-line floor is invisible

## Review

**Ink.** `--compose-tool-ink` is `--site-text-secondary` mixed 72% toward
`--compose-paper-bg`. Measured against the tools row's own background: 7.14:1 →
3.61:1 in light, 5.25:1 → 3.28:1 in dark. One mix ratio clears the 3:1 non-text
floor in both because it fades _toward the paper the row sits on_, so it tracks
whatever the theme sets rather than naming a grey. The two places that carry
words — the `Add more` label on a tool that has attachments, and
`Add to thread` — stay at `--site-text-secondary`, since 3.61:1 is under the
4.5:1 text floor. That split is the rule now: glyphs fade, words don't.

**Active.** The chip is gone; a tool that is on just returns to the row's old
weight (3.6 → 7.1 in light). This is a real loss of a channel, so the emoji and
rate toggles now carry `aria-pressed` alongside title's, which already had it —
otherwise the state existed only as a colour. Hover keeps its background: the
`:hover` rule outranks `.compose-tool-btn-active` on specificity, so an active
button still lights up under the cursor. Verified in the browser un-hovered —
the active star reads darker with no chip.

**Weight.** The stroke was stated three times (svg attribute 1.55, rate 1.6,
fullscreen 1.48) and `.compose-tool-icon` carried a dead `--icon-stroke: 1.46`
that nothing read. All four are now one live `stroke-width: 1.42` on
`.compose-tool-icon`. The `title` glyph is the only filled icon in the row and
its 2.05 crossbar read bold beside a 1.42 stroke; its three bars are cut to
1.72 / 2.02 / 0.95 so it sits at the same weight as its neighbours.

**Alignment.** With the `⊕` gone the label was the only thing left in the
button, so its horizontal padding drops 10 → 8 and the thread row's negative
margin follows. Measured: the label now starts at the composer's text column in
both modes (24px from the dialog edge single-post, 339px in thread compose —
the same x as `.ProseMirror` and the format switcher's label).

**Separator.** `.compose-tool-sep` was a 1px hairline; it is `.compose-tool-gap`
now, 8px of nothing. The two groups still read apart (16px between vs 4px
within) without another edge drawn into the paper.

Verified: `mise run check-tests` (3061 passed), `check-lint`, `check-format`
clean on the changed files; browser pass over single-post, thread, and `/new`
page compose in light and dark.

### Round two: the floors

**Measured before.** Note body 120px against a 28.56px line — 4.2 lines. Quote
textarea `9.5rem` = 142.5px against a 28.51px line — 5.0 lines, and `rows="5"`
computed to exactly 142.5px too, so the attribute and the CSS were the same
sentence written twice and could drift apart silently. The link's "thoughts"
field sat at 72px (2.5 lines) and the quote's at 56px (1.96 lines) — a ladder
of three floors, none of them a whole number of lines.

**After.** Every editor opens at two lines, `calc(var(--type-body-leading) *
2em)` = 57.12px; the quote textarea at four, `calc(var(--compose-quote-input-
leading) * 4em)` = 114px in compose and 101px in a reply. Written as multiples
of the leading, one rule covers both leadings this input takes (1.32 / 1.42)
and both breakpoints, which is why three `min-height` overrides could go:
`.compose-tiptap-thoughts`, `.compose-tiptap-thoughts-quote`, and the reply
layout's duplicated `6.5rem`. The dialog drops 480px → 349px empty, and grows
normally — five paragraphs takes it to 534px.

The user asked for 60px and 120px; two and four lines land at 57 and 114. The
few pixels buy a floor that stays a whole number of lines when the type moves.

**The click target.** `.compose-body`'s own `min-height: 72px` still earns its
keep — the tiptap div is empty until TipTap mounts, so it stops a collapse on
first paint — but it never binds afterwards, so the dialog now shrinks to its
content and there is no dead space to mis-click. The surfaces that _do_ reserve
height are the `/new` page and the phone dialog: on `/new` the body holds 295px
against a 57px editor, which is 171px of paper that did nothing. It forwards to
the editor now. Verified by probing each element in the browser: the section,
`.compose-field-enter` and `.compose-tiptap-wrap` forward; a tool button, the
title input and the ProseMirror itself do not. (Focus itself can't be asserted
in this harness — TipTap defers `view.focus()` to a `requestAnimationFrame`,
which never fires while the automated tab reports `visibilityState: "hidden"`.)

**Test.** `keeps reply compose tools inside the editor's text column` pinned the
reply's `min-height: 6.5rem`; it now asserts the opposite — that the reply rule
carries the lead-in and _no_ height. Added `opens every compose text surface at
a floor stated in lines`.

Verified: `mise run check-tests` (3062 passed), `check-lint`, `check-format`
clean; browser pass over note / link / quote in the dialog, the reply composer,
and the `/new` page.

## Follow-up: the action row

Third round: the Post button vanishes when disabled, and the Collection pill is
now the loudest thing in a composer where everything else went flat.

- [x] Post disabled keeps its shape — an inset ring instead of a fill that
      measured 1.05:1 against the paper
- [x] Collection trigger loses its fill, border, and hover lift
- [x] Add-to-thread row: asked, user chose to keep it as is (threads places it
      the same way — on the composer flow, not in the bottom bar)

### Round three: the action row

**Post.** The disabled fill was `color-mix(--compose-control-bg 88%, paper)` —
measured (248,248,242) against a (255,255,250) paper, **1.05:1**. There was no
border and `box-shadow: none` killed the pill's edge too, so what was left was
a floating label with no button under it. Disabled is now transparent with
`inset 0 0 0 1px` at 48% of the secondary ink: **2.19:1 light, 2.10:1 dark** —
an edge you can see, still plainly off. `--compose-control-border` was the
obvious token to reach for and the wrong one: at 1.25:1 it is a divider, not a
button's edge.

The ring is inset rather than a real border so the box does not gain 2px the
moment the post becomes postable — and it makes the state change legible as
one gesture: an outline that fills with ink once there is something to post.
Enabled is unchanged (solid `--site-text-primary`), which keeps the one strong
primary the composer should have. threads outlines its Post in both states; we
only need it in the state that was broken.

**Collection.** It was the last `border` + `background` pill in the dialog —
after the toolbar, the active chips and the add-to-thread glyph all went flat,
it read as the thing to do next. Fill and edge are gone; hover is the same flat
`--compose-control-bg` wash the tools row uses, with the 1px lift dropped. The
border stays as `1px solid transparent` so the box does not resize on hover.
The label stays at `--site-text-secondary` — it is a word, and the rule from
round one holds: glyphs fade, words don't.

Verified: `check-tests` (3062 passed), `check-lint`, `check-format` clean;
browser pass over disabled/enabled Post and the Collection trigger in light and
dark.

### Noted, not done

- Glyph-only controls outside the tools row — the `⚙` options trigger, the `×`
  close, the date pill — still sit at `--site-text-secondary` while the tools
  faded to `--compose-tool-ink`. By round one's rule they are glyphs and should
  fade too.
- The format switcher is now the only filled control left besides Post: a
  tinted track with a white active chip, top-left, first thing you see.
- Chrome/content on an empty note: 173px of rows under the editor (tools 54 /
  add-to-thread 32 / action 50 / quick-toggles 37) against 123px of body.

### Round four: Post goes outlined in both states

Reported with two threads.com captures: the ring from round three is too thin,
and threads outlines Post in _both_ states — light frame + grey label when
there is nothing to send, same frame + black bold label when there is. Also
noted: threads answers a hover on the disabled button instead of ignoring it.

**Both states, not one.** Round three kept the solid fill for enabled and
outlined only the disabled state. That was half the reference. Enabled is now
transparent with `--site-text-primary` at semibold inside the same ring, so the
frame is the button and the label carries the state. This also settles what the
solid pill had become: after the toolbar, the active chips, and the collection
pill all went flat, it was the one heavy object left in the dialog.

**1.5px, not 1px.** At 1px the ring read as an artefact of the paper rather
than a drawn edge — which is what "太细" was pointing at. Still `inset`, so the
box never changes width between states.

Rings, measured against the paper (light / dark):

| state          | ring                     | label                     |
| -------------- | ------------------------ | ------------------------- |
| disabled       | 40% → 1.89 / 1.82        | `--compose-tool-ink` 3.61 |
| disabled hover | 56% → 2.57 / 2.45        | unchanged                 |
| enabled        | 68% → 3.29 / 3.05        | primary 18.8 / 15.1       |
| enabled hover  | 84% → 4.77 / 4.03 + wash | primary                   |

Enabled sits at 68% rather than 64% so the ring clears 3:1 in dark too, not
just light. Disabled is under the floors on purpose — inactive controls are
exempt from 1.4.3 and 1.4.11, and that exemption is what lets the disabled pair
sit a full step back, the way the reference does.

**Disabled hover.** `cursor: not-allowed` plus a one-step lift on the ring
only. The label stays faded and no wash appears, so the hover acknowledges the
pointer without promising a press it will not accept.

**Dead code.** `.compose-publish-single` appeared in five selectors and no
markup anywhere in the source — it forced two names to be kept in sync for a
button that does not exist. Removed. The wrapper's `box-shadow: 0 1px 3px` went
with the fill: an outlined button should not float.

Verified: `check-tests` (3062 passed), `check-lint`, `check-format` clean; all
four states shot in light and dark.

### Round five: trace the reference

Asked for a 1:1 copy of threads.com's Post button. Rather than eyeball the two
captures, they were decoded and measured pixel by pixel (throwaway PNG decoder
in the session scratchpad — `node:zlib` inflate plus scanline unfiltering, no
dependency added to the repo).

Measured off the reference at 2x, identical in both states:

| property     | reference             | ours now                       |
| ------------ | --------------------- | ------------------------------ |
| box          | 66 x 36               | 68.9 x 36                      |
| border       | 1px                   | 1px inset ring                 |
| radius       | 8px                   | 8px                            |
| side padding | 18 / 17.5             | 18                             |
| label        | ~15px bold, 30.5 wide | 15px `--fw-bold`, 32.9 wide    |
| border off   | `#f4f4f4` — 1.10:1    | 7% → `#f4f3ee` — 1.10:1        |
| border on    | `#d9d9d9` — 1.41:1    | 23% → `#d9d8d3` — 1.41:1       |
| label off    | `#b2b2b2` — 2.12:1    | 46% → `#b4b2ad` — 2.12:1       |
| label on     | `#000000` — 21:1      | `--site-text-primary` — 18.8:1 |

Width is 2.9px over because our face sets "Post" 2.4px wider — the spec numbers
(padding, radius, border, height) are exact. Height is `2.4em` rather than a
rem: the reference's box is 2.4x its own label, so tying it to the font keeps
the ratio if the button's type ever scales.

Colours are stated as a fade of `--site-text-secondary` toward the paper, not
as the measured greys. `#f4f4f4` is only correct on a pure-white page; ours is
warm (`#fffffa`) and inverts in dark. The percentages reproduce the reference's
_contrast ratio_ on our paper, which is why the rendered hexes come out within
two units while keeping our warm cast.

**What this costs.** The reference's disabled frame is 1.10:1 — fainter than
the 1.89:1 it replaces and than round three's 2.19:1, and round three began
with "disabled 有点看不见". This is faithful, not legible; the frame carries
almost nothing and the `#b2b2b2` label does the work. If it reads as invisible
again, the dial is the `7%` in
`.compose-publish-main:disabled` — 20% is 1.35:1, 30% is 1.62:1.

Measuring the live button needs `animation: none` on `.compose-dialog[open]`
first: the automated tab reports `visibilityState: "hidden"`, so the open
animation never advances and every rect comes back through a stuck
`scale(0.97)` — 36px reads as 34.92px.

Verified: `check-tests` (3062 passed), `check-lint`, `check-format` clean; both
states shot in light and dark against the reference captures.

### Round six: height down a step

Disabled colours are settled — kept exactly as traced. Height only: `2.4em` →
`2.2em`, 36px → 33px. Nothing else moved, so the change stays readable as one
variable; padding, radius, border, and both colour pairs are still the
reference's.

That lands Publish level with the options trigger (`2.2rem`, also 33px here),
with the collection pill at 30.5px just under. The two end-of-row controls
sharing a height reads as a pair rather than a 1px mis-step, so it is worth
having rather than something to correct.

Two comments in this block were stale and are now measured: the "step down
2.3 / 2.1 / 1.95rem" ladder had not been true since the sizes moved, and the
"37px is a fine mouse target" note referred to a height the button no longer
has.

Side effect worth knowing: the button is now flatter than the reference's
proportion — 68.9x33 is 2.09:1 against its 66x36 at 1.83:1. Restoring that
means pulling `padding: 0 18px` in to about 14px, which also narrows it to
~61px. Left alone; height was the ask.

Verified: `check-tests` (3062 passed), `check-lint`, `check-format` clean; both
states shot at the new height.

### Round seven: enabled back to solid

Enabled returns to the fill it had before round four — `--site-text-primary`
under a paper-coloured label — inside the traced shape (8px radius, 18px
padding, 33px tall). Disabled is untouched: still the reference's 7% frame and
46% label, which is the part that was working.

So the button now says two different things two different ways: nothing to send
is an empty outline, something to send is a solid block of ink. threads keeps
an outline for both and lets only the label change; we don't, and the reason is
ours and not theirs — after the toolbar, the chips, and the collection pill all
went flat, the composer has room for exactly one solid object and it should be
the send.

`font-weight` and `letter-spacing` deliberately do _not_ change between the two
states. They would re-measure the label and resize the box mid-typing; both
states hold at 68.9x33.

The wrapper's old `box-shadow: 0 1px 3px` stays gone. It lifted the solid pill
off the paper, and a drop shadow under the outlined disabled state reads wrong.

Third instance of the same measuring trap, now understood generally: a
backgrounded tab (`visibilityState: "hidden"`) does not advance animations,
transitions, or `requestAnimationFrame`. Computed styles read back frozen at
the pre-change values — the enabled button reported the disabled colours until
`* { transition: none }` was injected. Anything measured live in this harness
needs animations _and_ transitions killed first.

Verified: `check-tests` (3062 passed), `check-lint`, `check-format` clean; both
states shot in light and dark, and both boxes measured identical.

### Round eight: dark mode has no elevation

Asked whether the dark palette is right — the dialog was hard to tell from the
page behind it. It is not right, and not a compose problem.

**Measured, dark.** Every surface token collapses onto the page:

| token                   | value     | vs page |
| ----------------------- | --------- | ------- |
| `--site-page-bg`        | `#110f0d` | 1:1     |
| `--site-elevated-bg`    | `#110f0d` | 1:1     |
| `--compose-paper-bg`    | `#110f0d` | 1:1     |
| `--compose-floating-bg` | `#12100d` | 1.01:1  |
| `--site-feed-card-bg`   | `#13100e` | 1.01:1  |
| `--site-code-block-bg`  | `#12100d` | 1.01:1  |

All three of the dialog's separators fail at once, and for the same reason —
each is _black over something_: the backdrop is `rgba(0,0,0,.3)`, which over
`#110f0d` composites to `#0c0b09`; the drop shadow is black at 8%; the border
is `#1f1d1b`, 1.14:1 against the paper it sits on. Dialog against its own
backdrop measured **1.03:1**. In light the same construction gives 2.10:1,
because there the page is white and black _does_ separate.

**Why the literal root fix was wrong.** `--site-elevated-bg` is the obvious
token to lift, and lifting it does fix the dialog — it also lifts
`.site-content`, turning the whole reading column into a raised panel, because
~60 rules use that token to mean "the background" rather than "above the
page". Three of them use it as a _text_ colour on a dark button, including the
Post label. The name promises elevation; the call sites have accreted "default
surface". Flipping its meaning underneath them repaints the site.

**What shipped instead.** `--site-raised-bg`: the page colour in light, a
12%-foreground lift in dark, and nothing points at it yet except
`--compose-paper-bg`. Dialog against its backdrop goes **1.03 → 1.27:1**; the
tools row, action row, and `--compose-floating-bg` follow it because they all
derive from compose paper; light mode is byte-identical (verified: every
surface still `#fffffa`). `.compose-page` — the full-page `/new` composer,
which _is_ the page — puts `--compose-paper-bg` back to `--site-page-bg`
locally.

**The ceiling.** 12% is not timid, it is most of the room there is.
`--site-divider` sits 1.36:1 above the page; a surface lifted past it swallows
every hairline drawn on it. Pushing the backdrop from 0.3 to 0.7 alpha only
moves the dialog from 1.27 to 1.32 — on a near-black page there is no
luminance left to take away. Light mode's 2.10:1 is not reachable without a
lighter dark palette.

- [ ] Follow-up: triage the ~60 `--site-elevated-bg` call sites into page vs
      raised, and move the real overlays (media lightbox, post menu, collection
      popover, feed cards) onto `--site-raised-bg`. Rename what is left to
      something that says "default surface".

Verified: `check-tests` (3062 passed), `check-lint`, `check-format` clean; dark
and light shot before and after, and light confirmed unchanged token by token.

### Round nine: how dark UIs actually do it

Still not comfortable after the lift. Looked at what Material 3, GitHub, and
Radix actually ship — and found that the yardstick used in round eight was the
wrong one.

**WCAG ratio is the wrong metric for surface-against-surface.** Its `+0.05`
floor crushes everything near black, so it says almost nothing about whether
two dark surfaces read apart. Proof: deepening the page _lowers_ the ratio
while raising the perceptual step —

| page L | page      | raised    | WCAG   |
| ------ | --------- | --------- | ------ |
| 0.17   | `#110f0d` | `#262421` | 1.24:1 |
| 0.13   | `#090705` | `#1d1b19` | 1.17:1 |
| 0.11   | `#050403` | `#191715` | 1.15:1 |

The metric the reference systems design against is perceptual lightness
(Oklab ΔL). Measured against them:

| step                                 | ΔL        | WCAG   |
| ------------------------------------ | --------- | ------ |
| **ours: page → sheet**               | **0.091** | 1.24:1 |
| M3 surface → surfaceContainer        | 0.057     | 1.14:1 |
| GitHub canvas → overlay              | 0.044     | 1.09:1 |
| Radix gray1 → gray3                  | 0.074     | 1.19:1 |
| **ours: sheet → its border**         | **0.145** | 1.73:1 |
| M3 surface → surfaceContainerHighest | 0.142     | 1.52:1 |
| GitHub overlay → border              | 0.110     | 1.42:1 |
| Radix gray3 → gray6 (border)         | 0.096     | 1.40:1 |

So nobody reaches light mode's 2.10:1 in dark, and none of them try. What they
ship is three cues, none of which is a shadow:

1. a **ladder of surface steps**, ~0.04–0.07 ΔL each (M3 has five named
   containers, Radix spends 12 steps on one grey);
2. a **visible border on every raised layer** — Radix dedicates two of its
   twelve steps to borders alone. In dark this does more work than the fill;
3. **blur plus scrim** for modals (Apple, Linear, Notion), which separates by
   focus when luminance has nothing left to give.

We had none of the three. Now: the fill step from round eight (ΔL 0.091),
plus `--site-raised-border` at ΔL 0.145 above the sheet (the dialog border was
1.14:1 against its own fill — invisible), plus `backdrop-filter: blur(3px)` on
`.compose-dialog::backdrop`. The codebase already blurs in 13 places; the
modal backdrop was not one of them.

Light mode: the border token uses the same formula `--compose-control-border`
did, so the edge is byte-identical. The blur is new in light too — it was
already at 2.10:1 and did not need it, but a modal that blurs in one mode and
not the other is worse than one that does it in both.

- [ ] Still open from round eight: triage the ~60 `--site-elevated-bg` call
      sites; move the other overlays (lightbox, post menu, collection popover)
      onto `--site-raised-bg` + `--site-raised-border`.

Verified: `check-tests` (3062 passed), `check-lint`, `check-format` clean; dark
and light shot; ΔL figures computed from the shipped hexes.
