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
| `gofmt` | Every Go file is gofmt-clean. `gofmt` exits 0 on unformatted files, so the check reads its output rather than its status. | `cd server && gofmt -l .` |
| `go-vet` | `go vet` finds nothing. | `cd server && go vet ./...` |
| `generate` | The frontend builds and lands in `server/internal/webassets/dist`, which is what the binary embeds. This also covers `npm run build`. | `bin/generate` |
| `go-build` | The `norte` binary links, with the embedded frontend in it. Needs `generate` to have run. | `cd server && go build -o norte ./cmd/norte` |
| `go-test` | The Go suite, under a temporary `NORTE_DATA` so nothing touches the real data directory. | `cd server && NORTE_DATA="$(mktemp -d)" go test ./...` |
| `web-test` | The Vitest suite. Needs `web/node_modules`, which `bin/generate` installs. | `cd web && npm test` |

`bin/ci --list` prints the names, and `bin/ci <name>...` runs only the ones
given. Every check runs even after one fails, so a single red run names all the
broken checks rather than just the first.

## Narrowing further than a check

Within `go-test`, one test reruns on its own:

    cd server && go test ./internal/app/ -run TestSIGTERMLetsAnInFlightRequestFinish

That one builds and starts the binary, so it is the slowest test in the suite;
`go test -short ./...` skips it.

Within `web-test`, one file reruns on its own:

    cd web && npx vitest run src/theme.test.ts
