#!/usr/bin/env bash
# Tests bin/check-pins against workflow fixtures.
#
#   bash scripts/pins-test.sh
#
# The check exists so a drifted toolchain version in the workflow fails the
# gate. That is only true if the check actually reports a mismatch, so each
# fixture below is a workflow that disagrees with the repository in one way.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workflow="$repo/.github/workflows/ci.yml"
work_dir="$(mktemp -d -p "${TMPDIR:-/tmp}" pins-test.XXXXXX)"
trap 'rm -rf "$work_dir"' EXIT

go_pinned="$(sed -nE 's/^[[:space:]]*toolchain[[:space:]]+go([0-9.]+).*$/\1/p' "$repo/server/go.mod" | head -n 1)"
node_pinned="$(tr -d '[:space:]' < "$repo/web/.node-version")"

failures=0

fail() {
    printf 'pins-test: FAIL %s\n' "$1" >&2
    failures=$((failures + 1))
}

# expect_rejected <name> <fixture> <substring>... — the check must exit non-zero
# and its output must name every given substring, so a mismatch is reported with
# both values rather than merely failing.
expect_rejected() {
    local name="$1" fixture="$2"
    shift 2
    local output status=0
    output="$("$repo/bin/check-pins" "$fixture" 2>&1)" || status=$?
    if [ "$status" -eq 0 ]; then
        fail "$name: check-pins accepted it"
        return
    fi
    local wanted
    for wanted in "$@"; do
        case "$output" in
            *"$wanted"*) ;;
            *) fail "$name: the failure does not name '$wanted': $output" ;;
        esac
    done
    printf 'pins-test: ok   %s\n' "$name"
}

expect_accepted() {
    local name="$1" fixture="$2"
    if "$repo/bin/check-pins" "$fixture" >/dev/null 2>&1; then
        printf 'pins-test: ok   %s\n' "$name"
    else
        fail "$name: check-pins rejected a workflow that agrees with the repository"
    fi
}

expect_accepted "the committed workflow agrees with go.mod and .node-version" "$workflow"

sed "s/'$go_pinned'/'1.0.0'/" "$workflow" > "$work_dir/go-mismatch.yml"
expect_rejected "a drifted go-version is reported with both values" \
    "$work_dir/go-mismatch.yml" "$go_pinned" "1.0.0" "go-version"

sed "s/'$node_pinned'/'1.0.0'/" "$workflow" > "$work_dir/node-mismatch.yml"
expect_rejected "a drifted node-version is reported with both values" \
    "$work_dir/node-mismatch.yml" "$node_pinned" "1.0.0" "node-version"

grep -v 'go-version:' "$workflow" > "$work_dir/no-go.yml"
expect_rejected "a workflow that pins no Go version is rejected" \
    "$work_dir/no-go.yml" "$go_pinned" "go-version"

grep -v 'node-version:' "$workflow" > "$work_dir/no-node.yml"
expect_rejected "a workflow that pins no Node version is rejected" \
    "$work_dir/no-node.yml" "$node_pinned" "node-version"

if [ "$failures" -gt 0 ]; then
    printf 'pins-test: %d failure(s)\n' "$failures" >&2
    exit 1
fi
printf 'pins-test: all checks passed\n'
