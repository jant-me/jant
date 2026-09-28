---
"@jant/core": minor
"create-jant": minor
---

GitHub Sync pushes only published posts that aren't private. Drafts, private posts, and replies in a private Thread used to be written to the repository in full, with `draft: true`, even when the repository was public.

**Upgrade notes**

- No database migrations.
- The next push deletes the files of drafts and private posts from the repository. Their earlier versions stay in the repository's Git history; if the repository is public, remove that history as well.
- A site export (`jant site export`, or the ZIP from Settings) still includes everything.
