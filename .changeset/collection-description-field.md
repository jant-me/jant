---
"@jant/core": minor
"create-jant": minor
---

A Collection's or Smart Collection's page in a site export names its description `description`, the word its settings use. It was `summary_text`, the name posts use for a summary Jant derives. `jant site import` reads both, so older exports still import.

**Upgrade notes**

- No database migrations.
- A Hugo template of your own that read `.Params.summary_text` on a Collection page reads `.Params.description`.
