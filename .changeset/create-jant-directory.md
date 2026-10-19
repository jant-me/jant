---
"create-jant": minor
---

`create-jant` takes a directory. `npm create jant@latest .` creates the project in the current directory, and a path such as `../sites/blog` creates it there. `package.json`, the Worker, the D1 database, and the R2 bucket are named after the directory, so `jant-0.12` becomes `jant-0-12`. The prompt asks for the directory and offers `.` the same way. In the current directory, the next steps leave out `cd`. Inside an existing git repository, `create-jant` skips `git init`, which used to nest a second repository in it.

A directory that already holds files is refused, and the message lists them. `create-jant` used to offer to empty it, `.git` included. Version control, editor, and OS files and a `LICENSE` don't count.

**Upgrade notes**

- No database migrations.
- `npm create jant@latest My-Site` creates `My-Site`, as typed, where it used to create `my-site`. The project is still named `my-site`.
- To create a project in a directory that holds files, empty it first.
