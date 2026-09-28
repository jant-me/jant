---
"@jant/core": minor
"create-jant": minor
---

`data-page` is on `<body>`, once per page, so a theme can style a page's header and footer by page as well as its content. It sat on each page's wrapper, and a post page also put `data-page="post"` on every post in the Thread, so a rule meant for the page matched each post again.

**Upgrade notes**

- No database migrations.
- A rule of the form `[data-page="…"] …` keeps working. One that relied on `data-page` sitting on the same element as another attribute, such as `[data-page="collection"][data-collection-mode="smart"]`, needs a space: `[data-page="collection"] [data-collection-mode="smart"]`. One that matched `article[data-page="post"]` should use `[data-page="post"] article[data-post]`.
