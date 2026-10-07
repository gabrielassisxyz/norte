# AGENTS.md

Norte is a learning and life-projects app with a Portuguese UI, used from a desktop browser
and a phone. The repo is a monorepo: `web/` is the Vue 3 frontend, ported from a design-tool
prototype, and `server/` is the Go backend. One binary, `norte`, serves both the API and the
built frontend, so there is one thing to build and one thing to install.

Screens still run on mock data (`web/src/mock/`). Each module moves to real data as its
backend bead lands.

## Layout

- `web/` — Vue 3, Vite, TypeScript, Vue Router, Vitest. Package manager: npm, pinned by
  `web/.node-version`.
- `server/` — Go, one static binary, no CGO. SQLite via `modernc.org/sqlite`, `sqlc` for
  queries, `goose` for migrations. The Go version is pinned by the `toolchain` directive in
  `server/go.mod`. **Every `go` command runs from `server/`**, which is where the module is.
  - `cmd/norte/` — the entry point.
  - `cmd/contractcheck/` — a gate tool, not part of the binary: the two contract rules
    `bin/check-contracts` enforces.
  - `internal/app/` — configuration, the cobra command line, the HTTP server wiring, and
    each module's handlers behind the validator built from its contract.
  - `gen/api/<module>/` — generated from `api/openapi/<module>.yaml`, never edited.
  - `internal/core/` — the always-on part that is not a module: the database handles
    and migrations, ids, the clock and the timestamp format, the item registry and
    links between modules, the content-addressed file store, and the logging and HTTP
    helpers. Its tables carry the `core_` prefix.
  - `internal/webassets/` — the built frontend, embedded. `bin/generate` fills
    `dist/`; only `dist/placeholder.html` is committed, because Go's embed cannot reach
    outside its own package directory and the package has to compile in a fresh clone.
- `api/openapi/<module>.yaml` — one contract per module, not a single file. It generates the
  Go types and the TypeScript types both.
- `design/system/` — the design system. Tokens in `tokens.css`/`tokens.json`, component docs
  in `components/<Name>/README.md`, props in `components/index.d.ts`, fonts in `fonts/`.
- `design/prototypes/` — git-ignored, and exists only in the main checkout. Open
  `Norte - <Screen> (standalone).html` in a browser to see a screen; read
  `<Screen>/template.html` for its markup, styles and behaviour.
- `bin/` — `ci` (the gate), `generate`, `check-pins`, `check-contracts`, `check-generated`,
  `worktree`.
- `docs/tools/ci-checks.md` — every gate check and the command that reruns it alone.

## Generated code is never edited

Everything under `server/gen/api/`, `server/internal/*/db/` and `web/src/api/` is produced by
a generator. Change the contract or the query it came from and regenerate; an edit to the
generated file is erased by the next run of the generator without warning.

`server/internal/*/db/` comes from the `.sql` files in the sibling `queries/` directory:
`cd server && go tool sqlc generate`. The sqlc version is pinned by the `tool` directive in
`server/go.mod`, so no install step is needed and no two machines generate different code.
The gate's `sqlc` check runs `go tool sqlc diff`, which fails when the committed output and
the queries have drifted apart.

`server/gen/api/<module>/` and `web/src/api/<module>.d.ts` come from
`api/openapi/<module>.yaml`: `bin/generate api`. Adding or changing an endpoint starts in
the YAML, because the regenerated Go interface then turns a missing handler into a compile
error, and a handler can only exist for a route the contract names. The generator versions
are pinned the same way — `oapi-codegen` by `server/go.mod`, `openapi-typescript` by
`web/package-lock.json` — and `bin/generate` never calls either by bare name, so nothing
installed on the machine can change what gets generated. The gate's `generate` check
regenerates everything and fails if the result differs from what is committed.

A contract file may only declare paths under `/api/<its own module>/`. The core file carries
two exceptions, `/api/config` and `/api/health`, which a client calls before it knows which
modules exist. Every object schema sets `additionalProperties: false`, which is what makes
the server reject a field the contract never named instead of dropping it in silence. The
gate's `contracts` check enforces both.

## The gate

`bin/ci` is the gate, and `.github/workflows/ci.yml` runs exactly it — so a green local run
and a green CI run mean the same thing. Run it before a commit lands.

A red run prints `FAILED: <name>`. `docs/tools/ci-checks.md` maps every name to the one
command that reruns that check alone, which is how a failure is investigated without paying
for the whole gate again. `bin/ci <name>...` runs only the checks named.

`bin/generate` runs the contract generators, then `sqlc`, then builds the frontend and copies
it into `server/internal/webassets/dist/`, so
`bin/generate && (cd server && go build -o norte ./cmd/norte)` is what produces a binary with
the current UI in it. `bin/generate <stage>...` runs only the stages named — `api`, `sqlc`,
`web` — which is the fast way back after editing one contract.

During development, `npm run dev` in `web/` proxies `/api` to `http://127.0.0.1:8080`, which
is where a locally running `norte serve` listens by default.

## Conventions

- The repo is public. Never copy the prototypes' mock content into code; write neutral
  invented data instead.
- UI strings are Portuguese. Code, comments and commits are English.
- No inline `<script>` in `web/index.html`: the server sends a content security policy with
  no `script-src` exception. The theme bootstrap is served from
  `web/public/theme-bootstrap.js` as a classic script, so it still runs before first paint.
- Configuration lives in one table in `server/internal/app/config.go`. Every setting is
  `NORTE_<NAME>` in the environment and a key in the optional TOML file; non-secret settings
  also get a flag. Secrets get no flag, because a flag is readable by every other process on
  the machine through the process list.
- Work is tracked in `br` (beads_rust): `br ready` lists what can be picked up.
- Work in a worktree of your own, never in the main checkout: `bin/worktree new
  <type>/<kebab-desc>` branches off a fresh `origin/main` into
  `~/repositories/.worktrees/norte/<task>`; `bin/worktree rm <task>` removes it.
- This repo ships itself: an agent opens a pull request for its work, and once the gate is
  green and the review is done it merges that pull request itself and closes the bead.
