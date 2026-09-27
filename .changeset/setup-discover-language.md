---
"@jant/core": patch
"create-jant": patch
---

Setup asks the Jant Discover question only when the content language is Chinese, the one language the jant.me directory lists. For any other language the checkbox stays off screen and setup stores no answer, so the deployment's `DISCOVER` default applies as before. The checkbox follows the language picker on the same screen. The Discover checkbox in Settings is unchanged and shows for every site.
