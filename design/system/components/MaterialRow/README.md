# MaterialRow

One material inside the module, in consumption order: status node, title (link to the reader), author, description, type, and link to the original.

- Pass `n`, `title`, `by`, `type` (Book, Paper, Post, Course, Talk...), `optional`, `status` (`done`, `current`, `next`, `skipped`), `description`, `href` (internal reader), and `url` (original).
- Done: filled node in `norte` with ✓. Current: ring plus "Reading now". Skipped: dashed node, `muted` title, and "Skipped". Optional shows in the type ("Book · optional").
