---
"@jant/core": minor
---

A post's **…** menu has **Share as image**. It draws the post as a picture to save or send: the post in your site's fonts and colors on a mat tinted from your theme, with the site's name and address, and a QR code that opens the post. The picture follows the summary the timeline shows, carries up to four images (a single image keeps its own shape), and lists documents, recordings, and text attachments by name. A post in a Thread shows the Thread's first post above it and the next post below, faded, with its place in the Thread beside the date. The browser draws it, 1620 px wide.

Readers can share too: a signed-out visitor gets **…** on each post, with **Copy link** and **Share as image**. Your own menu has **Copy link** as well, above **Share as image**. **Share as image** is offered for published posts that aren't Private, and **Copy link** for any post that isn't a draft.

For themes: each post's `<article>` carries `data-post-permalink`, and a reader's **…** is a `.post-menu-trigger` with `data-share-menu-trigger`, in the footer where the author's sits.

**Upgrade notes**

- No database migrations.
