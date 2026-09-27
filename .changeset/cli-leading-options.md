---
"@jant/core": patch
"create-jant": patch
---

`jant` refuses options written before the command instead of dropping them. `jant --remote migrate` used to migrate the local database, and `jant --help deploy` deployed; both now stop with a message saying where the options go.
