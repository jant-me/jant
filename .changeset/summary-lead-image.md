---
"@jant/core": patch
---

A titled post's excerpt in the timeline keeps one image. Until now the excerpt dropped every image in the body, even one placed before a `<!--more-->` break, so an article that opens with a picture showed only its title and text. The first image ahead of the cut now stays in its place; images further down are left for the post's page, and the card shows **Continue** when it leaves one out. Before a `<!--more-->` break, every image is kept. A post with an image or video attachment keeps a text-only excerpt, since the card already shows those attachments below it.

Untitled notes, the Atom feed's `<summary>`, the Hugo export, and share cards are unchanged.

**Upgrade notes**

- No database migrations.
