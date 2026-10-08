# Planted violations

Nothing imports these files, and nothing should. Each one does, on purpose,
exactly what one of the guard tests exists to reject, so that the guard is
exercised against a file that really breaks the rule rather than against a
string written inside the test.

A guard that has never been shown to fail is not a guard: it passes as readily
over a tree that keeps the rule as over one that does not, and nothing in its
green run tells the two apart.

- `mockStoreImport.fixture.ts` — a screen reading the mock store directly,
  which `src/dataSeam.test.ts` rejects.
- `legacyDateSymbols.fixture.ts` — the five date constants the app used to
  carry, which `src/appClock.test.ts` rejects.
- `mockRecordDate.fixture.ts` — a mock record timestamped by a literal.
- `viewDueDate.fixture.vue` — a screen deriving "today" and a due date from
  literals, in both the ISO and the compact spelling.
- `moduleHomeBlock.fixture.vue` and `moduleDataLayer.fixture.ts` — a date
  literal in the two places of a module that are neither a view nor mock data.

They are named `*.fixture.*` because that is what every scan excludes from the
production set: a fixture under `src/` is still compiled and still type-checked,
so a planted violation cannot quietly stop being valid code.
