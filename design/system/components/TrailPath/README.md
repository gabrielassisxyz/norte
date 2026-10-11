# TrailPath

A trail as a vertical sequence of steps (courses, modules, or milestones), each with a status.

- Pass `steps`: `{ title, meta?, status }` with `status` set to `done`, `current`, `next`, or `locked`.
- Finished: solid `norte` node with a check; current: `norte` ring plus the word "Now"; locked: dashed node plus the word "Locked". A single `current` per trail. Finished steps also read "Done".
- The thread between steps turns `norte` only along the finished stretch. No cards per step.
