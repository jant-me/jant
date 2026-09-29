---
"@jant/core": minor
"create-jant": minor
---

A site avatar is stored as PNG, JPEG, or WebP, and its bytes must match its type. An SVG avatar used to be stored as it was and served from the site's own origin. The settings page now turns an SVG into a PNG before uploading it, as it already did for other formats.

**Upgrade notes**

- No database migrations.
- `POST /api/settings/avatar` refuses an SVG, and a `file` or `appleTouch` whose contents aren't the image type it names, with `400`. An SVG avatar already stored stays as it is.
