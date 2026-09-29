---
"@jant/core": patch
"create-jant": patch
---

Closing a draft opened from Drafts no longer offers to delete it. Opening one just to read it and pressing Escape asked "Save to drafts?", and its "Don't save" deleted the draft and its files. Now a draft with no changes closes without asking, and "Don't save" only drops the changes made since it opened. Delete a draft from the Drafts list.

**Upgrade notes**

- No database migrations.
