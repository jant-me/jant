---
"@jant/core": patch
"create-jant": patch
---

On a demo site, saving custom CSS or code injection, changing the password, revoking a session, or deleting the account now shows why it was refused, such as "Custom CSS is off in demo mode. Every visitor shares the demo site." The refusal used to be silent: the form did nothing.

**Upgrade notes**

- No database migrations.
