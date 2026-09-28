---
"@jant/core": patch
"create-jant": patch
---

`jant site import` and `jant site pull-media` read only what an export may reach. A media path in front matter must stay inside the export's `static/` directory; `../../.ssh/id_rsa` used to be read and uploaded as a public attachment. A linked file is fetched only from a public http(s) address, checked again at every redirect, so an export can't make the command fetch from the machine's own network.

**Upgrade notes**

- No database migrations.
- Media an export links to on `localhost` or a private address is no longer fetched. Export with media bundled, the default for `jant site export`, to move such files.
