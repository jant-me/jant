---
"@jant/core": patch
"create-jant": patch
---

The sitemap no longer lists the address of a draft or private translation. A published post's translation alternates included every version in its group, so a draft's or private post's address, usually made from its title, was public.

**Upgrade notes**

- No database migrations.
- A sitemap shard that is full stays cached for up to a day, so an address already listed can take that long to drop out.
