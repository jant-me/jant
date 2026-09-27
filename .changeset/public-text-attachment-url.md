---
"@jant/core": minor
"create-jant": minor
---

A text attachment carries `url`, its Markdown source file, as every other attachment does. Public posts give that instead of `contentUrl`, which pointed readers at an endpoint that needs a session or token and answered them `401`.

**Upgrade notes**

- No database migrations.
- `/api/public/*` text attachments no longer carry `contentUrl`. Read the Markdown from `url`.
- Author API and media responses keep `contentUrl`, and add `url`.
