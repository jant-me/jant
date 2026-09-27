---
"@jant/core": minor
"create-jant": minor
---

MCP tools follow one naming pattern and fail in one shape.

**Upgrade notes**

- No database migrations.
- `jant_search_posts` is now `jant_posts_search`, and its `query` parameter is `q`, as in `GET /api/search`. `jant_media_update_alt` is now `jant_media_update`.
- A failed tool call's `structuredContent` is the HTTP error shape: `{ error, code }`, with `details` for a validation error. It used to be one of four shapes; `issues` is now `details`, and `statusCode` is gone.
- An unknown tool answers `code: "NOT_FOUND"`, and an unexpected failure `code: "INTERNAL_ERROR"`.
- From 1.0, the compatibility promise covers what MCP tools return as well as their names and parameters.
