#!/bin/sh
# Single entry point for CI. Delegates to `make ci` so there is one source of
# truth for the check list (ascii-check, backend-syntax, backend-test,
# frontend-test, frontend-build) and the two cannot drift apart.
set -eu

cd "$(dirname "$0")/.."
exec make ci
