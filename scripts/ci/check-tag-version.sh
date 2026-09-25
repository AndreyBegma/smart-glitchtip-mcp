#!/usr/bin/env bash
set -euo pipefail
#
# A v* tag on main must equal the version in package.json (D-15, D-16) —
# otherwise npm and ghcr get published under a name that does not match what
# `git describe` or the release PR says shipped.
#
# Usage: check-tag-version.sh [tag] [package.json path]
#   tag defaults to $CI_COMMIT_TAG (how Woodpecker exposes it on a tag event).
#   package.json path defaults to the repository's own, and is overridable so
#   check-tag-version_test.sh can point it at a fixture.

tag="${1:-${CI_COMMIT_TAG:-}}"
if [[ -z "$tag" ]]; then
  echo "check-tag-version: no tag given (pass it as \$1 or set CI_COMMIT_TAG)" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pkg_json="${2:-${repo_root}/package.json}"
pkg_version="$(node -p "require('${pkg_json}').version")"
tag_version="${tag#v}"

if [[ "$tag_version" != "$pkg_version" ]]; then
  echo "check-tag-version: tag ${tag} does not match package.json version ${pkg_version}" >&2
  exit 1
fi

echo "check-tag-version: ${tag} matches package.json version ${pkg_version}"
