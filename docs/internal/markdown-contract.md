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
- `[^1]: Inline footnote body`
- `[^1]:`
  followed by indented continuation blocks

HTML rendering behavior:

- References render as Tufte-style margin sidenotes, not a trailing footnote section
- Each reference emits the trio `label.margin-toggle.sidenote-number.footref` + `input.margin-toggle.footref-toggle` + `span.sidenote`, with the definition body inlined into the `span.sidenote`
- The visible number is supplied by a CSS counter (`sidenote-counter`), so it is not present in the DOM text
- The `footref` / `footref-toggle` classes carry no styling of their own. They exist so HTML-to-Markdown readers (Defuddle, which powers Obsidian Web Clipper) recognize the trio as Org-mode-style CSS sidenotes and recover `[^n]` footnotes. Without them, Defuddle treats a standalone `span.sidenote` as a duplicate and deletes it, dropping the footnote entirely. Keep both classes whenever this markup changes.

Serialization behavior:

- Single-paragraph definitions serialize inline as `[^1]: text`
- Multi-block definitions serialize as an indented body under `[^1]:`

Current editor behavior:

- Footnotes are preserved structurally in TipTap JSON
- Pasted/imported Markdown footnotes parse into footnote nodes
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
- Footnote definitions are excluded from summary block extraction
- `moreBreak`, images, and horizontal rules remain structural and non-searchable unless explicitly handled elsewhere

This is intentional: footnotes should be discoverable in search, but they should not leak into feed excerpts by default.

## Clipboard Contract

Compose preserves the destination-friendly clipboard behavior expected from a
rich-text editor while making a complete document easy to take elsewhere:

- A partial selection uses readable plain text for `text/plain` and preserves
  rich formatting in `text/html`.
- A complete document selection uses this canonical Markdown serializer for
  `text/plain` and still preserves rich formatting in `text/html`.
- Copy serialization never changes the editor document or creates an undo step.

Do not add a second selection serializer for clipboard Markdown. Full-document
copy must use the same shared manager as export and all other Markdown consumers.

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
