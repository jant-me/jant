---
"@jant/core": minor
"create-jant": minor
---

`jant --version` prints the installed version; it used to print the help. An option a command doesn't take, or one missing its value, is answered with one line naming it and where to find the command's options, instead of a Node stack trace, and exits with status 1.

**Upgrade notes**

- No database migrations.
