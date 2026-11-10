---
"@jant/core": minor
---

A video uploaded without a poster no longer shows as an empty box. Videos uploaded through the API or MCP can arrive without one, and the timeline only ever painted the poster. Without a poster, the reader's browser now loads the clip's metadata and draws a frame a tenth of the way in, at most one second.

`PUT /api/media/:id/poster` and the `jant_media_set_poster` MCP tool give a video its poster afterwards, or replace the one it has. The body is WebP or PNG bytes, and the response is the updated media object. Opening a post in the editor makes the poster for any video in it that has none and saves it, so share cards and feeds get an image too.

`PUT /api/uploads/:id/poster` and the `poster` field of `POST /api/upload` also take PNG, as they always have; the docs said WebP only. The API reference shows how to take a poster from a clip with ffmpeg.

**Upgrade notes**

- No database migrations.
