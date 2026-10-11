# ModuleItem

One syllabus module as an accordion: number, title, duration and count, status on the right.

- Pass `label` ("01", "Final"), `title`, `meta` ("5 weeks · 7 materials, 5 required"), `status` (`done`, `current`, `next`), and `statusText` ("In progress · 1/5").
- The body (`children`) follows this order: intro in `body` / `ink-2` (max 65ch), `MaterialRow`s, instrument (short table), exercises, assessment.
- Only the current module opens by default.
