---
"@jant/core": patch
"create-jant": patch
---

`compose.yml` and the Docker guides run `jant migrate` and `jant setup`, the command the image puts on the path, instead of `node bin/jant.js`, which named a file inside the image.

**Upgrade notes**

- No database migrations.
- A `compose.yml` you copied earlier keeps working. To match the current one, change the `jant-migrate` service's command to `["jant", "migrate"]`.
