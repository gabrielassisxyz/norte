# PageTitle

Opens every path, course, plan, or topic page: the title in `display` with the goal sentence right below.

- Pass `title` (short, no trailing period) and `objective`, written as a capability: "Being able to write a recursive descent parser."
- `meta` takes tags, `ProgressBar`, or `SyncStatus`; `actions` takes at most one primary `Button` and one secondary.
- One per page. Leave `space-16` above and `space-9` below; put nothing above the title (no eyebrow, no chip, no tile icon). A breadcrumb, if present, lives in the app top bar, not attached to the title.
- Below 640px the title drops to the `title` size.
