---
"@jant/core": minor
"create-jant": minor
---

A custom URL can redirect to another site, as the Settings form suggests: `toPath` takes a full `http://` or `https://` address and redirects to it as given. A redirect to a path on the site keeps the target's query string. Both were mangled before: `https://Example.com/Page` redirected to `/https:/example.com/page`, and `/archive?format=Note` lost the case of `Note`. An unparseable address is refused with `400`.

**Upgrade notes**

- No schema migrations. `jant migrate` runs a data backfill that restores the `//` after `https:` and `http:` in redirects already saved to another site. Their letter case was lowercased when they were saved and stays lowercase; edit any that need it.
- A site export writes such a redirect's `to` as the full address, without a leading slash.
