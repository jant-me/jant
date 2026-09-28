---
"@jant/core": minor
"create-jant": minor
---

Media alt text is updated with `PUT /api/media/:id`, as every other resource is updated with `PUT`. `PATCH` is no longer accepted.

**Upgrade notes**

- No database migrations.
- Send `PUT /api/media/:id` in place of `PATCH /api/media/:id`; the body is the same.
