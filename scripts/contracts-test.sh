#!/usr/bin/env bash
# Tests the two gate checks that guard the API contract.
#
#   bash scripts/contracts-test.sh
#
# bin/check-contracts and bin/check-generated exist so a broken contract and a
# forgotten regeneration fail the gate. That is only true if they actually
# report the problem, so each fixture below breaks one rule on purpose and the
# test asserts the diagnostic names what broke -- the file and the path, or the
# schema, or the generated path that changed.
#
# bin/check-generated is exercised over a temporary root with a generator that
# is known to write, rather than over the repository with the real one: the real
# one builds the frontend, and a test that pays for a frontend build to learn
# whether a diff is reported is a test nobody runs.
#
# The last case is about bin/generate rather than about a check: it proves the
# generators come from the repository's pins and not from PATH.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d -p "${TMPDIR:-/tmp}" contracts-test.XXXXXX)"
trap 'rm -rf "$work_dir"' EXIT

failures=0

fail() {
    printf 'contracts-test: FAIL %s\n' "$1" >&2
    failures=$((failures + 1))
}

pass() {
    printf 'contracts-test: ok   %s\n' "$1"
}

# expect_rejected <name> <substring>... -- the command in check_command must exit
# non-zero and its output must name every substring, so a violation is reported
# with the thing that violated it rather than merely failing.
expect_rejected() {
    local name="$1"
    shift
    local output status=0
    output="$("${check_command[@]}" 2>&1)" || status=$?
    if [ "$status" -eq 0 ]; then
        fail "$name: it was accepted"
        return
    fi
    local wanted
    for wanted in "$@"; do
        case "$output" in
            *"$wanted"*) ;;
            *) fail "$name: the failure does not name '$wanted': $output" ;;
        esac
    done
    pass "$name"
}

expect_accepted() {
    local name="$1"
    local output status=0
    output="$("${check_command[@]}" 2>&1)" || status=$?
    if [ "$status" -eq 0 ]; then
        pass "$name"
    else
        fail "$name: it was rejected: $output"
    fi
}

# write_contract <file> <module-and-path-lines> -- a contract file with just
# enough shape for the checks to read: an info block, the paths given, and one
# object schema that obeys the additionalProperties rule so a prefix fixture
# fails for the prefix and nothing else.
write_contract() {
    local file="$1" paths="$2"
    mkdir -p "$(dirname "$file")"
    {
        printf 'openapi: 3.0.3\ninfo:\n  title: fixture\n  version: 0.0.0\npaths:\n'
        printf '%s\n' "$paths"
        printf 'components:\n  schemas:\n    Thing:\n      type: object\n'
        printf '      additionalProperties: false\n      properties:\n        name:\n          type: string\n'
    } > "$file"
}

# one_get <path> -- the smallest operation block a path can carry.
one_get() {
    printf '  %s:\n    get:\n      operationId: fixture\n      responses:\n        "200":\n          description: ok' "$1"
}

### bin/check-contracts: the path prefix

contracts_dir="$work_dir/mis-prefixed"
write_contract "$contracts_dir/core.yaml" "$(one_get /api/library/x)"
check_command=("$repo/bin/check-contracts" "$contracts_dir")
expect_rejected "a module's path in the core file is rejected, naming the file and the path" \
    "core.yaml" "/api/library/x" "/api/core/"

contracts_dir="$work_dir/core-exceptions"
write_contract "$contracts_dir/core.yaml" "$(
    one_get /api/health
    printf '\n'
    one_get /api/config
)"
check_command=("$repo/bin/check-contracts" "$contracts_dir")
expect_accepted "/api/health and /api/config are allowed in the core file"

contracts_dir="$work_dir/health-in-a-module"
write_contract "$contracts_dir/library.yaml" "$(one_get /api/health)"
check_command=("$repo/bin/check-contracts" "$contracts_dir")
expect_rejected "/api/health in a module file is rejected, naming the file and the path" \
    "library.yaml" "/api/health" "/api/library/"

contracts_dir="$work_dir/own-prefix"
write_contract "$contracts_dir/library.yaml" "$(one_get /api/library/books)"
check_command=("$repo/bin/check-contracts" "$contracts_dir")
expect_accepted "a module file keeping to its own prefix is accepted"

### bin/check-contracts: additionalProperties

contracts_dir="$work_dir/open-schema"
write_contract "$contracts_dir/library.yaml" "$(one_get /api/library/books)"
cat >> "$contracts_dir/library.yaml" << 'YAML'
    Book:
      type: object
      properties:
        title:
          type: string
YAML
check_command=("$repo/bin/check-contracts" "$contracts_dir")
expect_rejected "an object schema without additionalProperties is rejected, naming the schema" \
    "library.yaml" "components.schemas.Book" "additionalProperties"

check_command=("$repo/bin/check-contracts" "$repo/api/openapi")
expect_accepted "the committed contracts obey both rules"

### bin/check-generated

# fixture_root <name> -- a tree shaped like the repository's generated paths,
# with one file in each, so a generator that writes has something to change.
fixture_root() {
    local root="$work_dir/$1"
    mkdir -p "$root/server/gen/api/core" "$root/server/internal/core/db" "$root/web/src/api"
    printf 'package coreapi\n' > "$root/server/gen/api/core/core.gen.go"
    printf 'package db\n' > "$root/server/internal/core/db/db.go"
    printf 'export type paths = never\n' > "$root/web/src/api/core.d.ts"
    printf '%s' "$root"
}

# fake_generator <name> <body> -- an executable standing in for bin/generate.
fake_generator() {
    local path="$work_dir/$1.sh"
    printf '#!/usr/bin/env bash\n%s\n' "$2" > "$path"
    chmod +x "$path"
    printf '%s' "$path"
}

quiet_root="$(fixture_root quiet)"
quiet_generator="$(fake_generator quiet 'exit 0')"
check_command=("$repo/bin/check-generated" --root "$quiet_root" --generate "$quiet_generator")
expect_accepted "a generator that changes nothing leaves the check green"

dirty_root="$(fixture_root dirty)"
dirty_generator="$(fake_generator dirty 'printf "// regenerated\n" >> server/gen/api/core/core.gen.go')"
check_command=("$repo/bin/check-generated" --root "$dirty_root" --generate "$dirty_generator")
expect_rejected "an unregenerated edit is rejected, naming the generated path that changed" \
    "server/gen/api/core/core.gen.go" "bin/generate"

new_root="$(fixture_root new-module)"
new_generator="$(fake_generator new-module '
mkdir -p server/gen/api/library
printf "package libraryapi\n" > server/gen/api/library/library.gen.go
printf "export type paths = never\n" > web/src/api/library.d.ts')"
check_command=("$repo/bin/check-generated" --root "$new_root" --generate "$new_generator")
expect_rejected "a new module with no committed output is rejected, naming the new paths" \
    "server/gen/api/library/library.gen.go" "web/src/api/library.d.ts"

broken_root="$(fixture_root broken)"
broken_generator="$(fake_generator broken 'exit 3')"
check_command=("$repo/bin/check-generated" --root "$broken_root" --generate "$broken_generator")
expect_rejected "a generator that fails is reported as a failure, not as a clean tree" \
    "failed"

# The developer's own tree, mid-change: the contract was edited, bin/generate was
# run, and none of it is committed yet. That has to pass, which is the whole
# reason this check reads content rather than asking git what is dirty.
uncommitted_root="$(fixture_root uncommitted)"
git -C "$uncommitted_root" init -q
git -C "$uncommitted_root" add server web
uncommitted_generator="$(fake_generator uncommitted '
printf "// regenerated\n" >> server/gen/api/core/core.gen.go
printf "export type Added = never\n" >> web/src/api/core.d.ts')"
(cd "$uncommitted_root" && "$uncommitted_generator")
quiet_again="$(fake_generator uncommitted-quiet 'exit 0')"
check_command=("$repo/bin/check-generated" --root "$uncommitted_root" --generate "$quiet_again")
expect_accepted "an uncommitted but correct regeneration is accepted"

### bin/generate: the pins, not PATH

# A generator resolved through PATH is a generator whose version nobody chose:
# it is whatever the machine happens to have installed, and it writes different
# code than CI does. bin/generate therefore calls the Go generators through
# `go tool` and openapi-typescript through `npm exec --no`, none of which
# consults PATH. This proves it by putting a saboteur of each name first on
# PATH: if any of them is ever reached, it leaves a marker behind. Each one
# exits 0 rather than failing, so the verdict is the marker and not an exit
# status that could come from anywhere else in the run.
#
# It runs the real bin/generate, minus the frontend build, over the real tree.
# That is deliberate -- a fixture tree would prove something about a copy -- and
# it is safe because the output is byte for byte what is already committed,
# which is what the `generate` check in the gate asserts separately.
saboteur_bin="$work_dir/saboteur-bin"
marker_dir="$work_dir/markers"
mkdir -p "$saboteur_bin" "$marker_dir"
for name in oapi-codegen openapi-typescript sqlc; do
    cat > "$saboteur_bin/$name" << EOF
#!/usr/bin/env bash
printf 'reached\n' > "$marker_dir/$name"
exit 0
EOF
    chmod +x "$saboteur_bin/$name"
done

generate_status=0
generate_output="$(PATH="$saboteur_bin:$PATH" "$repo/bin/generate" api sqlc 2>&1)" || generate_status=$?
if [ "$generate_status" -ne 0 ]; then
    fail "bin/generate api sqlc failed under a sabotaged PATH: $generate_output"
else
    reached="$(find "$marker_dir" -type f -printf '%f ' 2> /dev/null)"
    if [ -n "$reached" ]; then
        fail "bin/generate resolved a generator through PATH: $reached"
    else
        pass "bin/generate runs the pinned generators, not the ones on PATH"
    fi

    # The order is not cosmetic: the frontend type-checks against the TypeScript
    # types, so openapi-typescript has to have run first, and `web` is last
    # because it copies the built frontend into the server tree. The log lines
    # are the only record of what ran when, so they are what this reads.
    # Only the three generators are ordered here. `npm ci` logs a stage of its
    # own when node_modules is missing, which is every CI run and no warm
    # checkout, so counting it made this pass locally and fail in CI. Each
    # generator runs once per contract file, so repeats collapse to one stage.
    ran="$(printf '%s\n' "$generate_output" | sed -n 's/^==> \(oapi-codegen\|openapi-typescript\|sqlc\)\b.*/\1/p' | uniq | tr '\n' ' ')"
    case "$ran" in
        "oapi-codegen openapi-typescript sqlc "*)
            pass "bin/generate runs oapi-codegen, then openapi-typescript, then sqlc"
            ;;
        *)
            fail "bin/generate ran its stages in the wrong order: $ran"
            ;;
    esac
fi

if [ "$failures" -gt 0 ]; then
    printf 'contracts-test: %d failure(s)\n' "$failures" >&2
    exit 1
fi
printf 'contracts-test: all checks passed\n'
