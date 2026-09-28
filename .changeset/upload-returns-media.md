---
"@jant/core": minor
"create-jant": minor
---

`POST /api/upload` and `POST /api/uploads/:id/complete` answer `201` with the media object, the shape `GET /api/media/:id` and the MCP upload tool return. They answered `200` with their own shape, whose `filename` was the stored name rather than the name the file was uploaded under.

**Upgrade notes**

- No database migrations.
- Read `originalName` for the uploaded name, and `mediaKind`, `width`, `height`, and the other media fields from the same response. `filename` is gone.
- Both endpoints answer `201` instead of `200`.
