---
"@jant/core": minor
"create-jant": minor
---

Jant Discover has two answers, `latest` and `off`. Earlier releases also let a site offer a directory only its featured posts; that choice left the settings some time ago, and sites that made it kept declaring `featured`. A backfill now turns a stored `featured` off, rather than reading it as `latest`, which would let a directory list posts the owner hadn't offered. Feeds declare `latest` or `none`, and the `feed` attribute appears with `latest` only.

**Upgrade notes**

- `jant migrate` runs backfill 0008, which turns a stored `featured` Discover choice off. If your site offered Discover its featured posts, turn Discover on again under Settings → General to be listed; the directory then reads every public post and decides which list each one reaches.
- A directory reading `<jant:discover>` sees `latest` or `none` from this release on.
