# The gate's checks

`bin/ci` is the gate, and `.github/workflows/ci.yml` runs exactly it. A failing
check prints `FAILED: <name>`; this table maps every name to the single command
that reruns that check alone.

Rerunning one check is the point. The slow steps are the frontend build and the
Go suite, so investigating a red run by rerunning the whole gate costs minutes
for an answer one command gives in seconds.

| Check | What it proves | Rerun it alone |
| --- | --- | --- |
| `pins` | The Go and Node versions in the workflow still match `server/go.mod`'s `toolchain` directive and `web/.node-version`. | `bin/check-pins` |
| `pins-test` | `bin/check-pins` actually rejects a drifted version, instead of passing because it reads nothing. | `bash scripts/pins-test.sh` |
| `contracts` | Every `api/openapi/<module>.yaml` keeps to its own `/api/<module>/` prefix, and every object schema in it pins `additionalProperties: false`. Neither generator checks either rule. | `bin/check-contracts` |
| `contracts-test` | `bin/check-contracts` and `bin/check-generated` actually reject a mis-prefixed path, an open schema and a forgotten regeneration, and `bin/generate` runs the pinned generators rather than whatever is on `PATH`. | `bash scripts/contracts-test.sh` |
| `gofmt` | Every Go file is gofmt-clean. `gofmt` exits 0 on unformatted files, so the check reads its output rather than its status. | `cd server && gofmt -l .` |
| `go-vet` | `go vet` finds nothing. | `cd server && go vet ./...` |
| `sqlc` | The committed `server/internal/*/db/` still matches the `queries/` it was generated from, so neither a hand edit nor a changed query without a regenerate can land. Writes nothing. | `cd server && go tool sqlc diff` |
| `generate` | Running the generators changes none of the committed generated code, and the frontend builds and lands in `server/internal/webassets/dist`, which is what the binary embeds. This also covers `npm run build`. | `bin/check-generated` |
| `go-build` | The `norte` binary links, with the embedded frontend in it. Needs `generate` to have run. | `cd server && go build -o norte ./cmd/norte` |
| `go-test` | The Go suite, under a temporary `NORTE_DATA` so nothing touches the real data directory. | `cd server && NORTE_DATA="$(mktemp -d)" go test ./...` |
| `go-test-race` | Two worker loops against one database never run one job twice, under the race detector. | `cd server && go test -race ./internal/core -run TestWorkersDoNotDoubleClaim -count=1` |
| `web-test` | The Vitest suite. Needs `web/node_modules`, which `bin/generate` installs. | `cd web && npm test` |
| `extension-test` | Extension unit tests, permission-free release build and ZIP. Needs `extension/node_modules`, which the check installs when it is missing. | `bin/ci extension-test` |
| `extension-e2e` | Loaded Chromium extension against a cookie-protected fixture and a real temporary Norte server, including extraction and reader display. Builds the server binary, but not the frontend: run `bin/generate web` first when the reader changed. Downloads Chromium into ignored extension artifacts only if no system browser is available. | `bin/ci extension-e2e` |
| `extension-firefox` | `web-ext lint`, then temporary Firefox installation and background startup; prints a skip reason if Firefox is absent, unless `NORTE_REQUIRE_FIREFOX=1` is set (CI sets it), which turns the skip into a failure. | `bin/ci extension-firefox` |
| `web-e2e-csp` | The app under the policy the server sends: an article whose image comes from a local HTTPS listener renders, a style written at runtime applies, and an injected inline script is blocked with a `securitypolicyviolation` reported. Needs `generate` and `go-build`. | `cd web && npx playwright test e2e/csp.spec.ts` |
| `web-e2e-phone` | The first delivery walked at 390x844 with touch and no mouse, plus the same actions at 1440x900. Needs `generate` and `go-build`. | `cd web && npx playwright test e2e/phone-walk.spec.ts` |

`bin/ci --list` prints the names, and `bin/ci <name>...` runs only the ones
given. Every check runs even after one fails, so a single red run names all the
broken checks rather than just the first.

## Narrowing further than a check

Within `go-test`, two tests rerun on their own:

    cd server && go test ./internal/app/ -run TestSIGTERMLetsAnInFlightRequestFinish
    cd server && go test ./internal/library/ -run TestACrashBetweenTheCommitAndThePublishIsReplayed

Both start a second process, which is the only way to exercise what they are
about — a signal handler, and the window between a commit and the publish that
follows it. They are the slowest tests in the suite, and `go test -short ./...`
skips both.

Within `web-test`, one file reruns on its own:

    cd web && npx vitest run src/theme.test.ts

The two `web-e2e-*` checks drive a real `norte serve` on a temporary
`NORTE_DATA`, started by the suite itself, against the binary the `go-build`
check wrote to `server/norte`. Running one of them before `bin/generate` and
that build have run fails saying so. Each also runs `npx playwright install
chromium`, which is a no-op once the pinned browser is on the machine;
`web-e2e-csp` additionally needs `openssl`, which it uses to make the
throwaway certificate its local HTTPS listener presents.

Within `generate`, one stage reruns on its own, which is the fast way back after
editing a contract or a query:

    bin/generate api        # oapi-codegen and openapi-typescript, per contract
    bin/generate sqlc       # the typed query code
    bin/generate web        # the frontend build and the embed swap

`bin/check-generated` runs all three. Regenerating one stage leaves the others
alone, so a partial run still fails the `generate` check until the rest has been
produced too.
