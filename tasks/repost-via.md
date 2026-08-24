> **Status: shelved (2026-08-24). Not scheduled.**
>
> Deferred after a design review — not because the design is wrong, but because
> the value is lopsided between its two halves and the frequency that would
> justify the expensive half is unknown:
>
> - **The fetch + prefill half (Phase 2) is the real value** and does not need
>   the `via_url` column at all. It can fill `quoteText` / `url` / `title` and
>   leave the author to type the attribution line into the body — which is what
>   Daring Fireball and kottke.org have done by hand for 20+ years, and what
>   WordPress's Press This bookmarklet did for a decade.
> - **The `via_url` column (Phase 1) is the expensive half**: dual schema, dual
>   migrations, ~18 files of threading, Hugo front-matter round-trip (silent
>   data loss if missed), two export templates, chip UI, three locales, glossary,
>   docs page. What it buys over a hand-typed line is consistent placement plus
>   machine-readable `u-repost-of`, whose consumers today are ≈ zero unless
>   Phase 4 (Webmention) ships and the other side implements it too.
>
> Prior art confirms the two-URL relation is real — Tumblr's API carries both
> `source_url`/`source_title` (the original) and `parent_post_url` (who you
> reblogged from), exactly this doc's `url` vs `via_url`. But Tumblr **needed**
> the field because reblogging is frictionless and machine-driven, with no human
> in the loop to write anything. §3 of this doc deliberately keeps the human in
> the loop ("effort is the filter"), which removes the field's main job.
>
> **Reopen when**: after the fetch/prefill flow has been in use for a month, the
> author has hand-written a "via …" line often enough (~10+ times) that a
> dedicated field earns itself. Adding a nullable column later is a cheap
> append-only migration — the same argument this doc uses to reject `via_name`
> in §4, applied to `via_url` itself.
>
> **Decisions made in the review that supersede the text below** (record them
> here so they are not re-litigated):
>
> 1. **`via_url` never belongs to Note.** Its meaning comes from contrasting
>    with a primary URL; Note has none, so via would silently become the post's
>    only external link — that is a Link post. Note is also the one format
>    defined by having no `url` field, and its 5th toolbar slot is already
>    Title. Restricting via to Link/Quote also gives all three formats a
>    5-tool row. If a non-empty Note composer attaches a source, convert the
>    format to Link (lossless — Note's fields are a subset of Link's).
> 2. **Placement: the footer meta row (`PostFooter.tsx`), not three cards.**
>    §5 never said where the via line goes. Putting it in `post-footer-meta`
>    next to the date collapses 5–6 insertion points to 1, covers compact mode
>    for free, and mirrors the Hugo export theme's identical footer structure
>    (`post-card.html`, `reply.html`). Remember to add `|| !!viaUrl` to
>    `showCollectionSeparator`.
> 3. **Drop the write-time dedupe (§4).** It destroys information at write time
>    to save one comparison at render time — the wrong half to economize on.
>    Store `via_url` as given; render the via line only when
>    `viaUrl !== url`. Do **not** try to emit `u-repost-of` in the equal case:
>    URL equality cannot distinguish "reposted a post" (Note→Quote) from
>    "quoted a page" (selection / og fallback), and a bit recording which one
>    it was is a separate, cheap, later decision.
> 4. **SSRF: reuse `assertPublicHttpUrl` in `src/lib/url-fetch.ts`**, which
>    already covers protocol, credentials, localhost and private/loopback/CGNAT
>    /metadata IP literals with per-hop re-validation. Add a
>    `fetchTextDocument()` beside `fetchImageBytes()` sharing that guard; the
>    only new piece is the truncate-don't-fail reader. **Drop the undici
>    connect-time `lookup`** from scope: it needs a new dependency and Node-only
>    code behind the `src/node/` split, it cannot work on Workers at all, and
>    the repo has already made this exact call — see the module docstring at
>    `url-fetch.ts:11-14`. If DNS-rebinding hardening is ever wanted it should
>    upgrade every server-side fetch at once, not just this path.
> 5. **§5's feed insertion point is wrong**: the via line goes at the end of
>    each post's content (inside `buildSinglePostContent`), not at the end of
>    the feed item — a thread item concatenates several posts.
> 6. **Drop the rule "via never appears as a feature name in UI" (§2).** Too
>    strict; error copy may say "The via link is saved."
> 7. **Chinese term: `Repost`, untranslated** (precedent: `slug` in
>    `glossary.zh-Hans.yml`). Add a glossary entry when this is reopened.
>
> **Errors in the text below, found by checking it against the code** (fix
> before implementing, do not trust these passages):
>
> - `sanitizeUrl` (§4) does not canonicalize and accepts relative paths and
>   `mailto:` — the "store the canonical string" and "equal after
>   normalization" steps need a normalizer that does not exist in `lib/url.ts`.
> - Quote posts use `sourceUrl` / `sourceName` at the API layer, not
>   `url` / `title` (`lib/schemas.ts:505-514` rejects the latter) — §6's
>   mapping table and §7's prefill object use DB column names.
> - §5 says the QuoteCard attribution link "keeps `u-url`" — it has none today.
> - `/api/compose/via` (§7) contradicts the route layout: compose routes are
>   mounted at `/compose` (`app.tsx:569`) and already authed.
> - Feeds escape with `escapeXml`, not `escapeHtml` (§5).
> - §12's "existing link-preview pipeline, zero new code" is YouTube-only
>   (`services/post.ts:1052`); other targets get no thumbnail.
> - The threading surface is wider than §4 lists: `services/mcp.ts`,
>   `services/github-sync.ts`, `lib/post-meta.ts`, `lib/api-posts.ts`,
>   `routes/api/public/posts.ts`. In particular `lib/hugo-markdown.ts`
>   front-matter is **bidirectional** (`github-sync.ts:665` writes it back), so
>   a missing key silently wipes the column on a sync round trip.
> - §11 Phase 1 omits the Hugo export theme, which renders its own cards
>   (`export-theme/layouts/partials/post-card.html`, `reply.html`).
>
> The mf2 markup-correctness items from §5 (`u-bookmark-of`, `h-cite`, and the
> incorrect `u-url` on LinkCard's outbound link) were **split out** into
> `tasks/todos/2026-08-24-1709-post-microformats-fixes.md` — they are real bugs
> today and stand on their own.

# Repost (via) — cross-domain reblog for Jant

Design doc distilled from a full design discussion (2026-08-07). Written to be
directly implementable by an AI agent. Every decision below was deliberated;
the "Why" notes exist so future changes don't accidentally re-litigate or
silently break the reasoning.

## 1. Summary

Let a Jant author repost a post they saw on another blog (Jant or any
IndieWeb site) onto their own blog, with provenance. No federation, no
accounts across sites, no social mechanics. The entire cross-domain story
reduces to: **open your own composer with `?via=<url>`; your server fetches
and prefills; you edit and publish a normal post that carries a `via_url`.**

Two blogs never talk to each other directly. Worst case degrades to the user
pasting a URL into their own composer — the feature still works.

## 2. Terminology (fixed — do not drift)

| Layer                                      | Term                                    | Why                                                                                   |
| ------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------- |
| UI action (toolbar tool, settings section) | **Repost**                              | IndieWeb canonical post-type name; max standards alignment                            |
| Rendered attribution line                  | **via b.example**                       | Decades-old blogging convention (hat-tip); reader-facing copy, not a term             |
| HTML markup                                | **`u-repost-of`** class on the via link | The only layer interop cares about; mf2 vocabulary is fixed                           |
| DB column                                  | **`via_url`**                           | Internal name; accurately covers the superset (true reposts _and_ chip-only hat-tips) |

"via" never appears as a feature name in UI. The action is Repost; via is
only the preposition in the attribution line.

## 3. Design guardrails (philosophy — these are red lines)

Jant is "stripped of all social mechanics" (Jantelagen). This feature stays
on the right side of that line only because of these constraints:

- **Zero public affordances.** No repost button on public pages, ever. The
  capability lives entirely with the person doing the reposting (bookmarklet,
  own composer). Public pages show only the passive via line.
- **One-directional.** Publishing a repost notifies nobody and renders
  nothing on the source site. No counts anywhere.
- **Pull, never push.** Anything the author can learn (future webmention
  stats) is data sitting on a page they visit. No notifications, no unread
  badges, no toasts announcing mentions.
- **Effort is the filter.** Repost always goes through the composer and
  invites commentary. This is why `like` is permanently out of scope: a
  contentless signal whose only purpose is the validation loop. `reply`
  cross-site is deferred indefinitely — quote-with-commentary already serves
  it in blog-native form.
- **Excerpt + pointer, not mirror.** Prefill quotes an excerpt, never the
  full body. Media is never carried (see §12).

## 4. Data model

Add one nullable column to `post`:

- `via_url` — text, nullable. The URL of the post/page the author found this
  through. No new TypeID, no new table.

Requirements (repo hard constraints):

- Update **both** `packages/core/src/db/schema.ts` (SQLite/D1) and
  `packages/core/src/db/pg/schema.ts` (Postgres).
- Append-only migrations in both `src/db/migrations/` (via
  `mise run db-schema-generate`) and `src/db/migrations/pg/` (via
  `mise run db-schema-generate-pg`; write manually + update
  `meta/_journal.json` if generation reports no changes).
- Thread the field through service create/update paths, viewmodels, export,
  seed/import SQL (which must declare columns explicitly), and the API
  schemas. Sanitize with the existing URL validation (`sanitizeUrl` in
  `src/lib/url.ts`) at the boundary; store the canonical string.
- **Write-time dedupe:** after normalization, if `via_url` equals the post's
  `url` (typical for Note→Quote reposts where the quote source _is_ the
  via), store NULL instead — the format's own `url` field already carries
  the pointer, so Jant's native Quote/Link semantics suffice and rendering
  needs no comparison logic anywhere (§5). The prefill service (§7) still
  returns `viaUrl` (the chip shows in the composer); the drop happens in
  post create/update. Consequence recorded in §13: webmention sending must
  derive targets from all referenced URLs, never from `via_url` alone.

Explicitly rejected (do not add):

- **`via_name`** — domain _is_ identity in the IndieWeb world;
  `extractDisplayDomain` covers display; "who said it" belongs to the Quote
  format's `title` (attribution) field, which already has the fallback chain
  `title || extractDisplayDomain(url) || url` in `QuoteCard`. Adding a name
  column later is a cheap append-only migration; adding it now is permanent
  surface (dual schema, chip editing UI, blank-label normalization, i18n).
- A second `repost_of_url` column — one field covers the superset; markup
  layer handles repost semantics (§5).

## 5. Rendering

**Via line** on all three card types (`NoteCard`, `LinkCard`, `QuoteCard` in
`src/ui/feed/`), feed + detail modes:

- Small, quiet attribution line: `via b.example`, where the label is
  `extractDisplayDomain(viaUrl)`, linking to `via_url` with
  `target="_blank" rel="noopener noreferrer"`.
- The anchor carries class **`u-repost-of`** so IndieWeb consumers parse the
  post as a repost. (Deliberate mild overclaim for chip-only hat-tips —
  acceptable; the ecosystem itself blurs repost-with-commentary. The precise
  hat-tip vocabulary — experimental `u-via`, Atom's `rel="via"` — has
  effectively no consumers, so we speak the dialect that gets parsed.)
  Note the concepts stay distinct on a Link repost: `u-bookmark-of` points
  at the shared _article_, `u-repost-of` at the reposted _post_ — standard
  mf2 handles both on one h-entry with different targets.
- **No dedupe logic in cards:** write-time dedupe (§4) guarantees a stored
  `via_url` differs from the post's `url`, so cards render the via line iff
  the field is present. (A Note→Quote repost therefore renders as a plain
  quote post with no `u-repost-of` — accepted: Jant's own Quote semantics
  already carry the pointer, and declaring "repost" there adds nothing.)
- Via label is interpolated copy: use Lingui `msg` with `values: { domain }`,
  normalize blank/whitespace domain to the raw host before it reaches the UI.

**Feeds:** RSS/Atom item content carries the same attribution, appended at
the end of the item HTML: `<p><a href="{via_url}">via {domain}</a></p>` —
plain HTML, both values through `escapeHtml()`. No mf2 classes there (feed
readers strip class attributes; the line is for human readers). Feed readers
are a primary reading surface — provenance that only exists on the website
is provenance half the audience never sees.

**Markup completeness (Phase 1 — prerequisite for standard-only format
detection in §6):** Jant's own cards must express all three formats in
standard mf2 vocabulary, so consumers (including our own fetch parser) never
need Jant-specific signals:

- `LinkCard` (approved): add `u-bookmark-of` class to the outbound target
  link (the existing link to `post.url`) — the standard property for
  bookmark/link posts.
- `QuoteCard`: mark the quotation as an embedded **`h-cite`** — blockquote
  gets `h-cite`, quote text gets `p-content`, the attribution link keeps
  `u-url` + gains `p-name` on its label. The author's commentary (not the
  quote) carries the h-entry's `e-content`. Maps 1:1 onto the existing
  `quoteText`/`url`/`title` fields.
- `NoteCard`: already complete (`e-content`, `p-name` only when titled).

`data-format` stays a theme-facing attribute only; it is never a parsing
input.

Rejected: appending `#:~:text=` fragments to quote source links — fragile
exact-text matching, long URLs, and it muddies URL comparison (§4's
write-time dedupe and h-cite `u-url` expect clean canonical URLs) for a marginal
click-through nicety.

## 6. Format mapping (repost of a fetched post)

| Source format                  | New post  | Field mapping                                                                                                                                                                                                                                                                                              |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Note                           | **Quote** | `quoteText` = plain-text **excerpt** of the note body (use `getHtmlExcerpt` / text extraction from `src/lib/excerpt.ts`, never full body); `title` (attribution) = note title, else source site/author name; `url` = source post URL; `via_url` = source post URL (then dropped by §4's write-time dedupe) |
| Link                           | **Link**  | `url` = the _article_ the source post links to; `title` = that article's title; body **empty** (the source author's commentary is _their_ words — never carry it); `via_url` = source post URL                                                                                                             |
| Quote                          | **Quote** | `quoteText` = same quote; `title`/`url` = original citation (who said it / where); `via_url` = source post URL                                                                                                                                                                                             |
| Any page + `quote` selection   | **Quote** | `quoteText` = the user's selected text (client-sliced, server-capped); `title` = og/`<title>`/site name; `url` = page URL; `via_url` = page URL (dropped by §4). Works on **any** page — the human picked the passage, no parsing needed                                                                   |
| Unparseable page (og fallback) | **Link**  | `url` = the page itself; `title` = og/`<title>`; `via_url` = same URL (dropped by §4)                                                                                                                                                                                                                      |

Format detection for the fetched source uses **standard vocabulary only** —
no Jant sniffing, one code path for Jant and non-Jant sources alike
(prerequisite: the markup completeness items in §5, which make Jant's own
output say all of this in standard terms):

1. h-entry has `u-bookmark-of` → **Link** (url = the bookmarked target).
2. h-entry contains an `h-cite` (or `u-quotation-of`) → **Quote** (copy the
   cite's `p-content`/`p-name`/`u-url` — note this preserves the _original_
   citation, e.g. the book, not the reposted blog post).
3. Else Post Type Discovery heuristics: no distinct name / name ≈ content →
   note → **Quote**; distinct title / article-shaped / og-only → **Link**.

A repost therefore never lands on Note: the composer may _start_ in Note
(the default), but an empty-composer fetch always switches to Quote or Link
per this table.

Format is prefilled, not locked — the user can switch in the composer (e.g.
turning a Link repost into a Quote of the source author's commentary, citing
their post).

## 7. Fetch service

**Route:** `GET /api/compose/via?url=<encoded>`, plus optional `title` and
`quote` passthroughs from §9 — auth-required, thin
adapter. **Service** (new method, e.g. in `src/services/post.ts` or a small
dedicated service) owns everything: fetch, parse, map, sanitize. Returns a
structured prefill object `{ format, title, url, quoteText, viaUrl,
sourceDomain }` (all plain text, already normalized).

Parsing chain:

1. **microformats2**: find the `h-entry`, read `p-name`, `e-content`
   (extract _text_, drop markup), `u-url`, `u-bookmark-of`, and any embedded
   `h-cite` (`p-content`/`p-name`/`u-url`) — the exact subset §6's detection
   chain consumes. With §5's markup completeness, Jant↔Jant fidelity is
   exact through this same standard path. Parse with
   **`microformats-parser`** (the community-maintained reference
   implementation; pure-JS dependency chain `microformats-parser` →
   `parse5` → `entities`, runs on Workers and Node alike). Never hand-roll
   regex extraction for mf2: property ownership follows DOM nesting (an
   `h-cite`'s `p-name` belongs to the cite, not the entry) — exactly what
   the detection chain relies on and what regex cannot track.
2. **og metadata — extracted on every fetch, not only on fallback**:
   `og:title` / `og:site_name` / `<title>`. On mf2 miss they drive the Link
   prefill; on mf2 hit they back-fill attribution (§6's note row: title =
   note title, else site name). Missing values stay empty — `QuoteCard`'s
   existing `title || domain || url` chain absorbs blanks.
3. **Failure**: return a result that still carries `viaUrl` — the caller
   keeps the chip and shows the error copy (§8). Partial success is success.

**Caller-supplied fields win.** Anything the entry point already provides
(`quote`, `title` — §9) is authoritative: the fetch fills gaps and supplies
cleaning evidence, it never overwrites. Title precedence:

1. `title` param, cleaned;
2. mf2 `p-name` / fetched `og:title`;
3. fetched `<title>`, cleaned;
4. `sourceDomain`.

**Title cleaning** is one shared server-side normalization for title-shaped
candidates (the `title` param and the fetched `<title>`; `og:title` gets
only the two high-confidence rules). Evidence-anchored, in confidence
order:

1. tail equals fetched `og:site_name` after a separator
   (`|`/`｜`/`-`/`–`/`—`/`·`/`•`/`_`) → strip exactly that; no false
   positives.
2. tail tokens match the source host (e.g. `…_bilibili` on `bilibili.com`)
   → strip.
3. generic separator heuristic, timid: fire only when ≥15 chars remain and
   the stripped tail is ≤40 chars.

Every rule biases toward _not_ stripping: this is prefill into an editable
composer field the author reviews before publishing — a leftover "| 知乎"
costs two keystrokes, an over-stripped title costs trust. That review step
is also what authorizes cleaning caller-supplied titles at all: the
composer is the verbatim court of appeal, so no separate verbatim-title
param exists (§9).

Selection short-circuit: when a non-empty `quote` param accompanies the via
URL (selection captured by the bookmarklet, a non-URL share_target `text` —
see §9 — or an incoming `#:~:text=` fragment parsed out of the via URL
itself), it wins — prefill Quote per the selection row of §6 and use the
fetch only for title/site metadata. Cap the selection server-side (~2k
chars) and treat it as untrusted plain text like everything else.

Hard requirements:

- **Runtime-neutral parsing.** Jant runs on Workers _and_ Node/Postgres.
  Do not use `HTMLRewriter` (Workers-only); the `microformats-parser` /
  `parse5` chain above is pure JS and satisfies this on both runtimes.
- **SSRF guards** (real threat on the Node self-host runtime): http/https
  only; timeout (~5s); text content-types only; at most a few redirect
  hops. Validate the resolved IP **at connect time**: on Node, pass a
  custom `lookup` to the undici agent that rejects loopback/private/
  reserved ranges. One resolution, shared with the connection — this closes
  the DNS-rebinding TOCTOU that a separate resolve→check→fetch sequence
  reopens, and redirect hops re-validate for free because they ride the
  same agent. On Workers the platform already blocks internal fetches; no
  extra code there.
- **Truncate, don't fail.** Stream the body and stop reading at ~1 MB,
  then parse what was read — head metadata and content sit early in the
  document, and parse5 recovers from truncated HTML per the HTML5 error
  model. Never reject a response for size.
- **Everything fetched is untrusted plain text.** `escapeHtml()` before any
  HTML context; never pass fetched strings into `dangerouslySetInnerHTML`.

## 8. Composer UX

A new toolbar tool in the compose editor (Lit components under
`src/client/components/jant-compose-*.ts`, server UI in
`src/ui/compose/ComposeDialog.tsx`), following the existing pattern of
toolbar-toggled fields/panels.

**Tool:** icon button, tooltip **"Repost from URL"** (verb-first per copy
guidelines). Visible in **all three formats**, including Note: the fetch path
is format-agnostic (it _sets_ the format per §6, and the default empty
composer is a Note — hiding it there would hide the main entry), and the
chip-only path is legitimate on a Note (the classic hat-tip: "my own note,
sparked by something I saw at b.example"). `via_url` is format-orthogonal by
design; the button must not appear/disappear as formats switch.

**Panel:** URL input (autofocused, placeholder like "Paste a post URL…") +
Fetch button. `Enter` triggers, `Escape` closes (keyboard-first is a repo
hard rule; handle keydown on the component, not just dialog cancel). Panel
empty state carries one quiet permanent link: "Get the bookmarklet →"
(→ settings section, Phase 3; link to docs until then).

**Context rule — the load-bearing interaction decision.** "Empty" means
body, title, url, and quoteText are all blank after trim; the chosen format
alone never makes the composer non-empty.

- **Composer empty** → fetch & fill: switch format per §6, fill fields, show
  chip. (Same behavior as the `?via=` entry.)
- **Composer has any content** → **chip-only**: attach `via_url`, do NOT
  fetch, do NOT switch format, do NOT touch any field. This is the manual
  attribution path ("I wrote my own post, credit where I found it") and the
  edit-existing-post path (composer is non-empty by definition).
- Fetch failure converges to the same state: chip kept, content untouched,
  inline message per copy rules — tells what happened + what to do, e.g.
  "Couldn't read that page. The via link is saved — write the post
  yourself." (Never blame; never "error".)
- Consequence: fetch can never destroy typed content, and the tool has
  exactly one failure posture.

**Chip:** shows `via <domain>` near the top of the composer. Click = open
original in new tab; `×` (and `Delete`/`Backspace` while focused) = remove
`via_url`, keep all content. Chip must be focusable.

**Discovery:** none beyond the toolbar button itself and the panel's quiet
bookmarklet link. Explicitly rejected: slash-discovery-style timed hints —
too loud for a niche nice-to-have.

All copy: Lingui `msg` descriptors with `@context:` comments, from the local
i18n context (`useLingui` from `../../i18n/context.js`).

## 9. Entry points — everything funnels into `?via=`

`GET /new?via=<url>` (param name: single lowercase word, per URL rules; the
page is authed so shareable-URL param-rename rules don't bind, but comply
anyway). Behavior: as if the user opened the Repost panel, pasted the URL,
and pressed Enter — one implementation, N triggers:

1. **Manual paste** into the panel (universal floor; the mobile path today).
2. **Bookmarklet** (desktop): installed bookmarklets can never be updated,
   so the frozen-code rule is: **the client dumb-captures stable
   primitives; every judgment lives server-side**, where it stays
   updatable. Captured (all APIs stable for 15+ years):
   - `location.href` → `via`;
   - `(document.querySelector('meta[property="og:title"]')||{}).content ||
document.title` → `title` — preferring the authored og value over the
     rendered one is capture, not judgment; and on SPAs, paywalled, or
     bot-walled pages the in-page values beat anything a server fetch can
     see;
   - `String(getSelection())` → `quote`.

   Interpretation — site-suffix stripping, blank normalization, format
   mapping — stays server-side (§7), where bugs can be fixed after
   install. Maintain the bookmarklet as readable source plus a tiny build
   step that emits the `javascript:` URL: the real rule is "frozen once
   installed", not "must be one line". Phase 3's settings section ships
   the built, personalized URL.

   Frozen-code details (deliberated — none of this can be patched after
   install):
   - **Budgets count encoded characters, not source characters** — CJK
     costs 9 encoded chars per character, so source-length caps are
     meaningless. Shrink proportionally until it fits, stripping a
     trailing lone high surrogate after each cut (`encodeURIComponent`
     _throws_ on lone surrogates — in a frozen bookmarklet, silent
     permanent breakage). Budget ≈7000 encoded total, ≈5500 for `quote`
     (≈600 CJK chars) — under the 8K default request-line caps of nginx
     and Apache. The server keeps its own ~2k-char cap (§7) for all entry
     points.
   - **Open with a named `window.open`** (repeat clicks reuse one composer
     window; the reading page keeps its place); on popup block, fall back
     to `location.assign` in place. GET stays mandatory: `/new` sits
     behind auth, and only a GET URL survives the login-redirect round
     trip.

   Select a passage first → Quote prefill of that passage on any page;
   no selection → empty `quote`, ignored, normal flow.

3. **PWA `share_target`** (Android; Phase 3): manifest `share_target`,
   method GET, action `/new`, share fields mapped to `url`/`text`/`title`
   params (Android often delivers the shared URL in `text` rather than
   `url`). Each param has one meaning — `via` (source URL), `quote`
   (selection), `title` (title hint, §7 precedence), `url`/`text` (share
   payload). Resolution: via = the first of `via`/`url`/`text` that parses
   as a URL; title = `title` when present; selection = `quote`,
   else a non-URL `text` when a via was found elsewhere (Android
   select-text-and-share delivers the selection in `text` — Quote reposts
   work from the Android share sheet for free). Requires installed PWA; iOS
   does not support share_target at all.
4. **iOS Shortcuts** (docs only): a share-sheet Shortcut that opens
   `https://YOUR-BLOG.example/new?via=<shared URL>`.

**`title` param semantics — one field, no verbatim twin.** `?via=` is a
documented public contract, so hand-built automations may pass their own
`title`. It wins over every fetched candidate (§7) and receives only the
evidence-anchored cleaning — a deliberate title survives rules keyed to
the source site's own name, and the composer catches the rare misfire.
Explicitly rejected: a second verbatim field (`doctitle` etc.). Deliberate
titles already survive, the composer is the court of appeal, and machine
publishing with exact titles belongs to the posts API, not a prefill URL.
Adding a verbatim param later is a cheap append; adding it now is
permanent surface (a second name to document, a choice at every entry
point) — same logic as rejecting `via_name` (§4).

## 10. Settings & docs (Phase 3)

- New settings section **Repost** following the integration-section pattern
  (`src/ui/dash/settings/`, cf. `TelegramContent.tsx`), plus its
  `SettingsDirectory` entry. Contents: the personalized bookmarklet as a
  drag-to-bookmarks-bar link (the §9 build output, generated with the
  site's URL — this is why it lives in settings, not static docs) + copy
  button; iOS Shortcut steps;
  Android share-target note.
- `docs/` page covering all four entry points, with
  `https://your-blog.example` placeholders and a pointer to settings for the
  generated version.

## 11. Delivery phases

Commit to Phase 1–2 now; Phase 3 when real usage shows up; Phase 4 is a
separate future project whose _decisions_ are recorded here (§13) so they
aren't re-argued. Phases 1 and 2 are consecutive execution stages of one
commitment — the full §14 verification pass runs once, after Phase 2 lands.

- **Phase 1 — field + rendering + manual attribution (no fetch code):**
  schema/migrations ×2 dialects, service/API threading with write-time
  dedupe (§4), via line on three cards + `u-repost-of`, via attribution in
  RSS/Atom item content, markup completeness per §5 (`u-bookmark-of` on
  LinkCard, `h-cite` on QuoteCard), composer chip-only path (add/remove via
  on new and existing posts). Self-contained and useful alone.
- **Phase 2 — fetch & prefill:** via service (`microformats-parser` → og →
  failure chain, caller-fields-win precedence with title cleaning,
  connect-time SSRF guards, truncate-don't-fail body reader,
  runtime-neutral), `/api/compose/via`, full panel interaction with
  context rule, `?via=` entry on `/new`. Author can build their own
  bookmarklet from the documented source.
- **Phase 3 — adoption surface:** settings Repost section + generated
  bookmarklet, `share_target` + manifest, docs page.
- **Phase 4 — out of scope here:** Webmention + stats (see §13).

## 12. Non-goals (decided, with reasons — do not re-open casually)

- **No media transfer.** Neither copy (heaviest mirror behavior; copyright
  and etiquette; binary fetch + storage + cleanup machinery) nor hotlink
  (bandwidth theft, rot on their delete, reader-IP leakage, would require a
  parallel "remote media" concept in the media model). Reposts are
  excerpt + pointer; readers click through for images. Exception that isn't
  one: Link→Link reposts get preview thumbnails via the _existing_
  link-preview pipeline running on the target URL — zero new code.
- **No `like`.** Permanently. Contentless validation signal; contradicts the
  product thesis (see §3, "effort is the filter").
- **No cross-site `reply`.** Deferred indefinitely; Quote+commentary is the
  blog-native response form.
- **No ActivityPub.** Structural complexity (inboxes, follows, signed
  delivery) serving a social model Jant rejects. The IndieWeb stack
  (mf2 + Webmention + optionally Micropub) is the chosen camp.
- **No repost button on public pages; no timed discovery hints; no
  `via_name`; no notifications of any kind.**

## 13. Future track (decisions recorded, not scheduled): Webmention & stats

Recorded so a future stats project inherits conclusions, not debates:

- **Repost works without Webmention entirely.** Ship nothing of it in
  Phases 1–3.
- Stats page, when built: aggregates only, day granularity minimum, computed
  from bounded counter tables (`INSERT … ON CONFLICT count+1` in
  `waitUntil`), never per-event logs. Content: views trend, top posts,
  referrer _domains_ (top-N cap + "other"; excludes own authed visits and
  obvious bots), feed-reader subscriber counts from UA. No uniques (would
  require visitor identification). Plain dual-dialect tables — no
  CF-analytics dependency (Node self-host must work identically).
- Referrer domains already answer "traffic from b.example" for free. Build
  **standard Webmention receiving** (never a proprietary Jant ping) only
  when post-level precision ("their post X linked my post Y") is genuinely
  wanted.
- Receiving design: verify by fetching source (spec-mandated) — kills fake
  pings; async queue + rate limit + same SSRF guards as §7; optionally only
  count sources that parse as `h-entry`. Spam economics are already defused
  because mentions are **private-stats only, never rendered publicly** (the
  trackback death spiral was public display + SEO reward).
- Mention storage: `(source_url, target_post_id, kind, first_seen,
last_seen, source_title)`, unique on (source, target), upsert on re-ping.
  `kind` from mf2 (`u-repost-of` → repost, `in-reply-to` → reply, else
  mention). **Full retention** (a trickle, and it's the blog's relationship
  graph); "recent" is a _display_ window, not a retention policy. Per-post
  "Mentioned by" list on the author-only view is the preferred surface
  (trackback tradition: responses attach to the post, not a central feed).
- Deletion: spec-compliant — a re-ping whose source no longer links (or 410)
  **hard-deletes** the row. No tombstones (withdrawal respect: the record
  derives from their content). No notification of deletions. Aggregate
  numbers are computed on read from the table, so deletion needs zero
  bookkeeping. No background re-crawler for dead sites; a manual hide /
  block-domain button per row covers rot and residual spam.
- Sending (cheap good-citizen half, can ride along whenever): **spec
  behavior, no Jant special-casing** — on publish, collect every external
  URL the post references (`url`, `via_url`, links in the body), dedupe,
  discover each target's webmention endpoint, and POST source+target to
  the ones that have one. Endpoint discovery _is_ the filter: sites that
  don't participate get nothing. (Keying on `via_url` alone would miss
  Note→Quote reposts whose via was dropped at write time, §4.) **On
  edit/delete, re-send to the union of old and new targets** so the other
  side can clean up removed links — which requires remembering what was
  sent: a tiny per-post sent-targets table (target URL, last-sent
  timestamp), upserted per send. Async in `waitUntil`, same SSRF guards
  as §7.

## 14. Verification plan

Behavior change ⇒ `mise run check-tests` + `mise run check-lint` (repo
rule), plus targeted tests:

- Schema: both dialects migrate cleanly on fresh DBs; seed/import SQL still
  validates.
- Service: write-time dedupe (create/update drops `via_url` equal to `url`
  after normalization); via fetch — mf2 happy path per format mapping row,
  og fallback, og attribution back-fill on mf2 hit, title precedence
  (`title` param beats fetched candidates), title cleaning (site-name
  suffix strip, host-token strip, timid generic rule; deliberate titles
  untouched), failure-keeps-via, 1 MB truncation still parses, SSRF
  rejections (loopback/private IPs at connect time, redirect hops,
  non-text), escaping of hostile fetched strings.
- Rendering: via line present iff `via_url` set, `u-repost-of` present,
  `rel="noopener noreferrer"`, `u-bookmark-of` on LinkCard,
  `h-cite`/`p-content` structure on QuoteCard, via attribution appended to
  RSS/Atom item content.
- Composer: context rule (empty → fill; non-empty → chip-only, fields
  untouched), chip remove keeps content, Escape/Enter/focus handling,
  edit-mode attribution.
- Routes: `?via=` resolution (URL-candidate order, `quote`/non-URL-`text`
  selection rule once share_target lands, `title` passthrough), auth still
  required on `/new`.
- Manual: dev login flow (`mise run dev-debug`), create each repost shape
  against a second local Jant, verify cards and feeds.

## 15. Status

- [ ] Phase 1 — `via_url` + rendering + chip-only attribution
- [ ] Phase 2 — fetch service + `?via=` + full panel
- [ ] Phase 3 — settings/bookmarklet/share_target/docs
- [ ] Phase 4 — not scheduled (decisions in §13)
