# Compose Reply Attachment Toolbar Clipping

## Plan

- [x] Trace the compose dialog/editor DOM and CSS overflow constraints that clip `.compose-tools-row`.
- [x] Replace attachment-size mitigation with a layout rule that keeps composer controls in the available visible area.
- [x] Add focused regression coverage for reply compose with attached media/text.
- [x] Run proportional verification.

## Review

- Root cause: reply compose puts `jant-compose-editor` inside a horizontal flex row with `align-items: flex-start`, so the editor did not stretch to the row's constrained height. Its own `max-height` plus `overflow: hidden` could clip the trailing `.compose-tools-row`.
- Fix: stretch the editor surface in reply rows, keep `.compose-tools-row` from shrinking, and give the reply attachment dock its own shrinkable scroll boundary.
- Verification: `mise run check-tests` passed; browser-checked a local reply composer with an attached text card on `http://localhost:19020`.
