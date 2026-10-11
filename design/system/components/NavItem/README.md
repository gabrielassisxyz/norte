# NavItem

One entry of the app sidebar. The sidebar is a 232px column in `sunken` with the brand on top, the navigation entries, and a "Pinned" group.

- Pass `label`, `href`, and, where present, `count` (mono, `muted`). The entry for the current page takes `active`: `norte-soft` background, `norte` text, `aria-current="page"`.
- Short labels in sentence case. No tile icon; in this sidebar, no icon at all.
- Below 900px the sidebar disappears; navigation moves to the top bar.
