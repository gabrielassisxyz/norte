# SidePanel

Reader side panel with tabs (Note, Annotations), collapsible to a 48px rail with shortcuts and counters.

- Pass `tabs` (`value`, `label`, `count`, `icon`: `note` or `comment`) and `panels` with the content of each tab. Controlled (`value`, `collapsed`) or uncontrolled (`defaultValue`, `defaultCollapsed`).
- 380px wide, `surface` background, left `line` border. Hidden entirely in Exercises mode.
- The collapsed rail exposes "Open the panel"; the open panel exposes "Collapse the panel".
