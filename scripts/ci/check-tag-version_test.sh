#!/usr/bin/env bash
set -euo pipefail
#
# Regression test for check-tag-version.sh (spec acceptance criterion 6): a
# matching tag passes, a mismatching one fails. Uses a throwaway fixture
# package.json rather than the repository's own, so it never has to track
# the real version.
#
# Run it directly:
#
#     scripts/ci/check-tag-version_test.sh
#
# Not wired into `bun run test` — same convention as scripts/orchestrator/*_test.sh.

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="${here}/check-tag-version.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

echo '{"version": "1.2.3"}' > "${fixture}/package.json"

pass=0
fail=0

assert_pass() {
  local tag="$1"
  if "${script}" "${tag}" "${fixture}/package.json" >/dev/null 2>&1; then
    pass=$((pass + 1))
  else
    echo "FAIL: expected ${tag} to pass against version 1.2.3" >&2
    fail=$((fail + 1))
  fi
}

assert_fail() {
  local tag="$1"
  if "${script}" "${tag}" "${fixture}/package.json" >/dev/null 2>&1; then
    echo "FAIL: expected ${tag} to fail against version 1.2.3" >&2
    fail=$((fail + 1))
  else
    pass=$((pass + 1))
  fi
}

assert_pass "v1.2.3"
assert_fail "v1.2.4"
assert_fail "v9.9.9"

if [[ "$fail" -ne 0 ]]; then
  echo "check-tag-version_test: ${fail} of $((pass + fail)) checks failed" >&2
  exit 1
fi

echo "check-tag-version_test: ${pass} checks passed"
