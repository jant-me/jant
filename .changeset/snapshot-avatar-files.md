---
"@jant/core": patch
"create-jant": patch
---

A snapshot carries the files the avatar and the Apple touch icon settings name. It restored the settings but took the files only when a media record listed them, so on a site whose avatar predates those records, the restored avatar and icon answered `404` in the new storage.

**Upgrade notes**

- No database migrations.
