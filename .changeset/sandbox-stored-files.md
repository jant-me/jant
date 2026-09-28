---
"@jant/core": patch
"create-jant": patch
---

A stored file opened on its own can no longer run scripts on the site. Every file under `/media/` is served with `X-Content-Type-Options: nosniff` and a sandboxing `Content-Security-Policy`, PDFs aside, so an HTML or SVG file opens without the site's session or scripts. Files sent to the Telegram bot now follow the browser upload rules: an image, video, audio file, or PDF shown inline must really be that format, and any other file is stored as a download. It used to keep whatever type the sender's app claimed and open inline.

**Upgrade notes**

- No database migrations.
- Images, video, and audio in posts display as before. Only opening a stored file directly is affected.
