---
"@jant/core": patch
"create-jant": patch
---

On a post whose translation has a custom path, the language switcher, the "Also available in" line and the `hreflang` alternates link that translation at its custom path. They linked `//path`, which browsers and crawlers read as the address of another host. A folded Thread's "N more posts" link had the same fault when the first hidden post had a custom path.

**Upgrade notes**

- No database migrations.
