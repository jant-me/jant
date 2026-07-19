# Markdown Contract

This document defines the supported Markdown behavior in `jant-core`.

The goal is one contract across:

- Markdown import
- TipTap JSON storage
- Markdown serialization
- HTML rendering
- Export consumers such as navigation footer and text-attachment previews

The implementation lives in:

- `/Users/green/project/jant/main/packages/core/src/lib/markdown-manager.ts`
- `/Users/green/project/jant/main/packages/core/src/lib/tiptap-render.ts`
- `/Users/green/project/jant/main/packages/core/src/lib/markdown.ts`

## Source Of Truth

`markdown-manager.ts` is the schema boundary.

Markdown always follows this pipeline:

1. Parse Markdown into TipTap JSON with the shared `MarkdownManager`
2. Store or transform TipTap JSON
3. Serialize TipTap JSON back to Markdown with the same manager
4. Render HTML from TipTap JSON with `tiptap-render.ts`

Do not add Markdown-only behavior in one consumer without updating the shared manager and renderer.

## Supported Markdown

The shared schema supports:

- Paragraphs
- Headings `#` through `###`
- Bold, italic, strike, inline code
- Links
- Bullet lists and ordered lists
- Blockquotes
- Fenced code blocks
- Horizontal rules
- Hard breaks from trailing double spaces
- GFM tables
- Images
- Footnotes using `[^label]` references plus `[^label]: ...` definitions
- Obsidian/Pandoc-style inline footnotes using `^[inline note]`

## Jant-Specific Markdown Extensions

Jant adds two non-standard structures on top of the normal Markdown set.

### Read More Break

Supported source forms:

- `<!--more-->`
- `Read More ↓`
- `Read More`

Stored as the `moreBreak` TipTap node and serialized back to `<!--more-->`.

### Rich Image Figure

Supported source form:

- `<figure data-jant-node="image" ...>...</figure>`

This is the only raw HTML block intentionally parsed as structured content.

Stored as the `image` TipTap node with Jant image attrs and serialized back to:

- Standard Markdown image syntax for simple images
- Jant `<figure data-jant-node="image">...</figure>` HTML for rich figures with caption, layout, or link metadata

## Footnote Contract

The MVP footnote model is structural, not regex-only text.

TipTap nodes:

- `footnoteReference`
- `footnoteDefinition`

Supported source forms:

- `Body copy[^1]`
- `Body copy^[Inline footnote body]`
- `[^1]: Inline footnote body`
- `[^1]:`
  followed by indented continuation blocks

HTML rendering behavior:

- Public HTML uses real `sup > a[role="doc-noteref"]` references followed by a
  single `section[role="doc-endnotes"] > ol` containing one `li` per
  definition. It does not use the deprecated `doc-endnote` role.
- Reference and definition IDs use a deterministic compact 64-bit scope derived
  from the immutable content entity ID, plus the first-reference ordinal. Full
  TypeIDs and mutable slugs never appear in fragment IDs.
- Definitions follow all authored body blocks in source order. The stored HTML
  contains no rail wrappers, row styles, split lists, or private footnote data
  attributes. On a detail page or public timeline item whose actual container
  is at least `56rem` wide, a small progressive client enhancer positions the
  existing list beside each definition's first reference and resolves
  collisions. Each timeline item is measured independently. Narrow or overly
  dense rails, missing browser primitives, print, external feeds, readers, and
  no-JavaScript clients retain ordinary bottom endnotes.
- Rich definitions keep their paragraphs, lists, quotes, and code blocks inside
  the list item; they are never flattened into an inline `span`.
- A definition ending in a paragraph places its backlink group in that final
  paragraph, so the text and backlink stay together without CSS. Definitions
  ending in another block use a final backlink paragraph.
- A repeated label emits one definition, a unique ID for every reference, and a
  `role="doc-backlink"` link back to each occurrence.
- A reference without a definition renders as a non-link superscript rather
  than a dead fragment link. Definitions with no reference are not published.

The public structure is intentionally different from the private TipTap editor
DOM. Do not reuse editor `data-*` parsing as the interchange contract.

### Stored HTML projection

`post.body` TipTap JSON is canonical. `post.body_html` is a materialized,
versioned projection:

- `body_html_version = 1` means the legacy label/input/span sidenote structure.
- `body_html_version = 2` means the short-lived semantic Subgrid structure with
  per-block wrappers, split lists, and inline row metadata.
- `body_html_version = 3` means the canonical single-list structure above.
- `body_html_version = 4` keeps the v3 public structure and additionally
  guarantees that a high-confidence historical `#fn-*` link, separator,
  ordered-list, and `#fnref-*` backlink set has been upgraded to canonical
  TipTap footnote nodes.
- Create and body-update operations write the body, rendered HTML, and current
  version atomically.
- Product reads render stale rows from canonical JSON in memory. A partial
  rebuild therefore cannot expose a mixture of old and current post markup.
- Malformed historical canonical JSON falls back to stored HTML for
  availability and remains stale so maintenance reports it.
- Worker feed cache keys include the current HTML contract version.

The old v1 CSS remains for one compatibility window so an invalid legacy row
or an imported old snapshot stays readable while it is repaired.

Historical rationale: v1 copied the Tufte CSS label/checkbox/span pattern so a
margin note could toggle on small screens without JavaScript. Jant later added
`footref` and `footref-toggle` compatibility classes because Defuddle (used by
Obsidian Web Clipper) otherwise dropped the standalone sidenote while converting
HTML back to Markdown. That made clipping less lossy, but it optimized a visual
CSS convention rather than the document semantics: the reference was not a
real link, the definition was inline-only, and rich/repeated footnotes could not
be represented correctly. V2 introduced real links and DPUB roles, but still
encoded its Subgrid layout as wrappers, split lists, and row metadata in public
HTML. V3 keeps the semantic improvements while moving the optional Tufte rail
entirely into a progressive enhancement for wide public post containers. V4
closes the historical-import gap where older rich-text pastes had already
flattened footnotes into ordinary TipTap links and a trailing list.

Serialization behavior:

- Single-paragraph definitions serialize inline as `[^1]: text`
- Multi-block definitions serialize as an indented body under `[^1]:`
- Inline `^[...]` input is normalized to a generated reference plus definition

Editor HTML behavior:

- `sup[data-footnote-reference]` and `div[data-footnote-definition]` are a
  private TipTap DOM protocol, not Jant's public or interchange HTML
- `data-footnote-label` always stores the normalized raw label (`1`, not
  `[^1]:`); visual punctuation is supplied by the editor UI
- `parseHTML` and `renderHTML` must remain symmetrical so editor HTML can
  round-trip without changing footnote identity

Current editor behavior:

- Footnotes are preserved structurally in TipTap JSON
- Pasted/imported Markdown footnotes parse into footnote nodes
- Obsidian, GitHub/unified, and DPUB-ARIA footnote HTML is normalized into the
  same structural nodes before ProseMirror parses it
- `/footnote` inserts a paired reference and definition with the next numeric label
- Typing `[^label]` followed by a delimiter converts to a reference and auto-appends a missing definition
- Pressing `Enter` at the end of a paragraph after a raw `[^label]` converts it, ensures a definition exists, and moves the cursor into that footnote
- Once the reference has been converted into a footnote node, `Enter` returns to normal paragraph splitting behavior
- Typing `[^label]: ` converts the current paragraph into a definition block
- Typing `[^label]: ` inside an existing footnote definition promotes that paragraph into a sibling definition
- Deleting the last remaining reference also deletes its definition
- Deleting a definition deletes all references that point at it

## Raw HTML Policy

Raw HTML is not a second Markdown language in Jant.

Rules:

- Unsupported raw HTML is treated as text and escaped in rendered HTML
- Only explicitly supported structures may parse as nodes
- Today that allowlist is limited to Jant image figures

Examples:

- `<script>alert(1)</script>` renders as escaped text
- `<figure data-jant-node="image">...</figure>` parses as a rich image node

This keeps Markdown behavior aligned with the stored TipTap schema and avoids `marked`-style passthrough drift.

## Normalization Rules

The shared pipeline applies a few normalization rules at the schema boundary:

- Link marks default to `target="_blank"` when rendered
- Empty attr bags are removed from JSON output
- Code blocks omit `language` when it is unset
- Empty documents normalize to a single empty paragraph
- Footnote labels are trimmed and internal whitespace is collapsed

## Search And Summary

Search indexing and excerpt generation do not treat every node the same.

- Footnote definitions are included in searchable plain-text extraction
- Footnote definitions do not count toward summary block/character limits
- A definition referenced by a selected summary block is rendered with that
  block so the excerpt never contains a dead footnote link
- `moreBreak`, images, and horizontal rules remain structural and non-searchable unless explicitly handled elsewhere

This is intentional: definitions remain discoverable in search, while a feed
excerpt includes only the definitions required by references that are actually
visible in that excerpt.

## Clipboard Contract

Compose preserves the destination-friendly clipboard behavior expected from a
rich-text editor while making a complete document easy to take elsewhere:

- A non-empty `text/markdown` flavor is parsed as Markdown even when HTML is
  also present.
- Obsidian 1.12+ editor HTML carrying `<!-- obsidian -->` uses its accompanying
  `text/plain` Markdown, preserving source labels that rendered HTML has lost.
- Generic rich HTML remains preferred over its plain fallback. Recognized
  rendered footnotes are normalized structurally; generated navigation
  backlinks are not imported as definition content.
- A partial selection uses readable plain text for `text/plain` and preserves
  rich formatting in `text/html`.
- A complete document selection uses this canonical Markdown serializer for
  `text/plain` and still preserves rich formatting in `text/html`.
- Copy serialization never changes the editor document or creates an undo step.

Do not add a second selection serializer for clipboard Markdown. Full-document
copy must use the same shared manager as export and all other Markdown consumers.

## Body HTML v4 rollout

The schema migration and projection rebuild are deliberately separate:

1. Run `jant migrate`. The new non-null column defaults every historical and
   imported row to v1; it does not rewrite content.
2. Deploy the v4 reader/writer and let the previous application version drain.
   Do not materialize v4 while an old writer can still edit posts.
3. Dry-run every target site. Self-hosted/current-site example:
   `jant posts rebuild-html --url <site-url> --dry-run`.
4. Re-run without `--dry-run`. The command is cursor-paginated and idempotent.
   It always refreshes `body_html` and `body_html_version`. For a structurally
   complete historical footnote set it also atomically upgrades `body`,
   `body_text`, and the stored summary. Dry-run and final output report these as
   `wouldUpgradeFootnotes` and `upgradedFootnotes` separately from projection
   rebuilds.
5. Hosted orchestration must enumerate the complete tenant population in the
   control plane and call the explicit-site endpoint for each site. For one
   managed site, use
   `jant posts rebuild-html --url <cell-core-url> --site <site-id> --dry-run`,
   then repeat without `--dry-run`. This calls
   `POST /api/internal/sites/:siteId/posts/body-html/rebuild`; core does not
   provide an implicit all-sites mode.
6. Investigate every `failed` row and rerun every `conflicted` row after active
   edits settle. Completion means every intended site reports zero failures
   and conflicts on a final dry run.

The rebuild recognizes legacy footnotes from parsed canonical TipTap structure,
never from SQL string manipulation or the stored legacy HTML. Conversion is
all-or-nothing: every reference, trailing definition item, and backlink must
form a complete set, so ordinary fragment links and numbered lists remain
authored content. It does not modify `updated_at`, `published_at`, or slugs.
Both internal endpoints require `INTERNAL_ADMIN_TOKEN`; pass it through
`--token` or the environment variable of the same name.

## Change Checklist

When adding or changing Markdown behavior:

1. Update `markdown-manager.ts`
2. Update `tiptap-render.ts` if HTML output changes
3. Update `summary.ts` if search or excerpt behavior should change
4. Add round-trip tests:
   Markdown -> TipTap JSON
   TipTap JSON -> Markdown
   Markdown -> HTML
5. Add or update consumer tests if the behavior is used by:
   navigation footer
   export service
   import/export commands

If a change does not update those layers together, the contract is incomplete.
