# AGENTS.md

Norte is a learning and life-projects app with a Portuguese UI. The repo is a monorepo:
`web/` is the Vue 3 frontend, ported from a design-tool prototype, and `server/` will be
the Go backend that serves the built frontend and the API from one binary. There is no
backend yet: every screen runs on mock data.

- Frontend stack (`web/`): Vue 3, Vite, TypeScript, Vue Router, Vitest. Package manager: npm.
- Backend stack (`server/`, not started): Go, SQLite via `modernc.org/sqlite` (no CGO),
  `sqlc` for queries, `goose` for migrations. The API contract is an `openapi.yaml` that
  generates both the Go types (`oapi-codegen`) and the TypeScript types
  (`openapi-typescript`); change the contract, never the generated code.
- Design system: `design/system/`. Tokens are in `tokens.css`/`tokens.json`, component
  docs in `components/<Name>/README.md`, props in `components/index.d.ts`, fonts in
  `fonts/`.
- Prototypes: `design/prototypes/` is git-ignored and exists only in the main checkout.
  Open `Norte - <Screen> (standalone).html` in a browser to see a screen. Read
  `<Screen>/template.html` for its markup, styles and behaviour.
- The repo is public. Never copy the prototypes' mock content into code; write neutral
  invented data instead.
- UI strings are Portuguese. Code, comments and commits are English.
- Work is tracked in `br` (beads_rust): `br ready` lists what can be picked up.
- Gate: `npm run build && npm test` in `web/` must pass before a commit.
