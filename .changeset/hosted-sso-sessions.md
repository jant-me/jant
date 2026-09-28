---
"@jant/core": patch
"create-jant": patch
---

Opening a hosted site from the provider now records the browser on the session, so the Sessions page names the device instead of showing "Unknown device". Opening it again in a browser that is already signed in as the same person keeps that session rather than adding another. Sessions made before this release keep showing as unknown until they expire or are revoked; the one in the browser you open the site from next gets its device filled in.

**Upgrade notes**

- No database migrations.
