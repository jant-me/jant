# Thread tail drafts: one definition, visible, actionable

## Problem

Replying to `/2pazd` always failed with `CONFLICT: This post is no longer the
end of the thread.` even though it visually _was_ the last post.

Root cause: "the tail of a thread" has two contradictory definitions.

| Side                                  | Function                                             | Status filter          | Answer             |
| ------------------------------------- | ---------------------------------------------------- | ---------------------- | ------------------ |
| Read (where the Reply button renders) | `getLastPostIdsByThread` (`services/post.ts:3613`)   | `status = 'published'` | `2pazd`            |
| Write (whether a reply is allowed)    | `getLastLivePostIdInThread` (`services/post.ts:958`) | none                   | the draft after it |

A draft reply (`k298b`) sits at the end of that thread. Drafts never render
publicly, so the UI offered a reply the server was always going to refuse.
10 threads in the local DB are in this state.

## Plan

### 1. One tail definition (service)

- [x] Replace both functions with `getThreadTailIds(threadIds, { includeDrafts })`
      on `PostService`. Batch, one query, status filter driven by the option.
- [x] Reply guard calls it with `includeDrafts: true` (a draft still owns the
      slot — letting a sibling attach would fork the chain).
- [x] Distinct error copy when the blocker is a draft vs. a published post.

### 2. The author sees the real tail

- [x] `assemblePostPageDisplay`: include draft thread members when
      `c.var.isAuthenticated` (not just in `/preview`).
- [x] Keep `socialImage` / `articlePublishedTime` / `articleModifiedTime`
      derived from **published members only** — drafts must not leak into
      og:image or article metadata.
- [x] Reply button follows the array tail, so it lands on the draft bubble.
- [x] Feed: the draft is not rendered there, so carry `draftTailId` on the view
      and resume the draft instead of creating a sibling.
- [x] `openReplyForArticle` — one client rule: replying to a thread whose tail
      is your draft continues that draft.

### 3. Draft bubbles are actionable

- [x] `Draft` status badge (reuses the existing `article[data-*]` badge system).
- [x] Footer actions on a draft bubble: Continue writing / Publish / Discard.
- [x] Discard confirms first; publish and discard refresh the thread in place.

### Deferred (agreed follow-ups)

4. Conflict responses carry `tailId` + `tailStatus` so the composer can recover
   instead of dead-ending.
5. `jant-compose-dialog` thread-draft recovery only triggers for draft _roots_
   (`jant-compose-dialog.ts:2887`); draft replies under a published root are
   unreachable from the composer.

## Verification

- [x] `mise run check-tests`
- [x] `mise run check-lint`
- [x] Manual: reply to `/2pazd` on the local Postgres dev server.

## Results

Items 1–3 are done. Items 4 and 5 remain open (see "Deferred" above).

### What changed

| File                                                | Change                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/post.ts`                                  | `getLastPostIdsByThread` + private `getLastLivePostIdInThread` → one `getThreadTailIds(ids, { includeDrafts })`; reply guard uses it and names a draft blocker distinctly |
| `lib/post-display.ts`                               | Draft thread members render for the signed-in author; page metadata derived from published members only                                                                   |
| `lib/timeline.ts`                                   | Feed carries `draftTailId` for the author (both the latest reply and a bare root)                                                                                         |
| `lib/view.ts`                                       | `resolveDraftTailId` — a trailing draft is exactly where the two tail answers disagree                                                                                    |
| `types/views.ts`, `types/props.ts`                  | `PostView.draftTailId`, `PostFooterDisplayOptions.showDraftActions`                                                                                                       |
| `ui/shared/post-article-attributes.ts`              | `data-post-draft`, `data-thread-draft-tail-id`                                                                                                                            |
| `ui/feed/PostStatusBadges.tsx`                      | Draft badge; component converted to Lingui (it was hardcoding English)                                                                                                    |
| `ui/shared/PostFooter.tsx`, `ui/pages/PostPage.tsx` | Draft bubbles get Continue writing / Publish / Discard instead of a timestamp and Reply                                                                                   |
| `client/compose-launch.ts`                          | One rule: replying to a thread whose tail is your draft resumes that draft                                                                                                |
| `client/compose-bridge.ts`                          | Delegated handlers for the three draft actions + in-place refresh                                                                                                         |
| `styles/ui.css`                                     | Draft badge visibility, quieted draft bubble, draft action row                                                                                                            |

### Verification

- `mise run check-tests` — 3070 passed (248 files), including 3 new cases:
  trailing draft skipped by default, returned with `includeDrafts`, and the
  draft-specific conflict message.
- `mise run check-lint` + `prettier --check` — clean.
- Manual, against local Postgres on `1-jant.localtest.me`:
  - `/2pazd` signed in: 5 thread items, the draft carrying a Draft badge and
    the three actions. Signed out: 4 items, zero draft markers.
  - `article:modified_time` and `og:image` identical signed in vs. out — the
    draft does not reach page metadata.
  - `POST /api/posts` replying to `2pazd` now returns the draft-specific
    message instead of the misleading "reply to the latest post".
  - Probe thread: draft tail blocks the reply → publishing it unblocks →
    replying succeeds. Probe data deleted afterwards.
  - Browser: "Continue writing" opens the draft in the composer; "Discard"
    confirms, deletes, toasts, and refreshes the thread in place; the feed's
    Reply on a draft-tailed thread opens the hidden draft with a toast rather
    than failing.

### Revision: drafts are ordinary posts

Follow-up round after review. The bespoke three-button row was replaced with
the normal footer (Reply + `...`), with draft actions folded into the post
menu. Doing that surfaced a chain invariant that had to be enforced first:

- **A reply never outranks its parent.** Replying to a draft used to produce a
  `published` post behind an unpublished one — a hole readers see as a jump.
  Now continuing after a draft keeps drafting, which is what makes a
  multi-post draft tail a legitimate state rather than a bug.
- **Publishing a reply publishes the drafts before it.** The same invariant
  from the other side, enforced in `update` so it holds for every caller.
- `client/post-refresh.ts` — the in-place refresh helpers moved out of
  `compose-bridge` so the post menu can reuse them instead of reimplementing.
- The Draft badge is a button: hover, focus ring, click opens the editor.
- Draft rail dots are hollow — the rail reaches them, but they read as empty
  slots rather than published stops.
- Draft timestamps are back (hiding them silently removed the permalink the
  draft-preview page navigates by — caught by `preview.test.ts`). The tooltip
  now reads "Last edited on …" for drafts instead of claiming publication.

### Revision 2: featured, and what Reply means on a draft

- **Nothing unpublished can be featured.** Featured surfaces filter to
  `published`, so featuring a draft wrote a flag that showed nowhere. Now
  refused in `create` and `update`, and the menu item is hidden on drafts. An
  existing flag still survives a trip back to draft and takes effect again on
  republish — only turning it _on_ is guarded.
- **Reply on a visible draft is an ordinary reply again.** Revision 1's
  "resume the trailing draft" rule was too broad: it fired on the thread page
  where the draft is right there with its own Edit. Now only surfaces that
  _hide_ the draft (the feed, via `data-thread-draft-tail-id`) redirect to it.

### Revision 3 (superseded) and 4: the cascades came back out

Revision 3 added two status cascades plus a create-side downgrade, to make
"drafts only live at the tail" true. Revision 4 removed all three. They were
enforcing an invariant nothing needed:

- The public thread already filters drafts, so a draft between two published
  posts renders as a continuous 1-2-4. There is no gap for a reader to see —
  the "hole" only ever existed in the author's mental model.
- The invariant existed to support editing the draft run as one unit. With
  that idea dropped in favour of "middle post = edit, tail = reply", its
  premise went with it.
- Each cascade was doing something the user did not ask for: Publish on one
  post published three; unpublishing one post silently pulled later ones out
  of public view; replying to a draft produced a draft.

Current rules, all local to the post you act on:

| Action  | Effect                                                                                     |
| ------- | ------------------------------------------------------------------------------------------ |
| Reply   | Ordinary reply. Takes the thread root's status, so replying past a parked draft publishes. |
| Edit    | Edits that post.                                                                           |
| Publish | Publishes that post only.                                                                  |
| Discard | Deletes that post; children re-parent onto its parent.                                     |

`published → draft → published` is a legal, expected shape. A middle draft is
not the thread tail, so it gets no Reply button — which is exactly "middle
post = edit, tail = reply" falling out of the existing `isLastInThread` logic
rather than needing its own rule.

The one guard that stays is the original one: you cannot reply to a post that
is not the end of the chain, drafts included.

### Note for follow-up

The local DB still has ~9 other threads ending in a draft. They are now
visible and actionable rather than silently blocking, so no data migration is
needed — but they are worth a pass by hand.
