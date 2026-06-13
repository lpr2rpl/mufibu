#!/bin/sh
# Fail if any tracked file contains a non-ASCII7 byte (outside 0x00-0x7F).
#
# Rationale: keep all repository artifacts in 7-bit US-ASCII so diffs,
# terminals, and toolchains stay free of encoding ambiguity. Render UI glyphs
# via HTML entities (JSX text) or \uXXXX escapes (JS strings) instead of raw
# Unicode source bytes. See IMPROVEMENTS.md, "ASCII7 Policy".
set -eu

cd "$(dirname "$0")/.."

offenders=""
for f in $(git ls-files); do
    [ -f "$f" ] || continue
    if LC_ALL=C grep -lP '[^\x00-\x7F]' "$f" >/dev/null 2>&1; then
        offenders="${offenders}${f}
"
    fi
done

if [ -n "$offenders" ]; then
    echo "ASCII7 check FAILED: non-ASCII bytes found in:" >&2
    printf '%s' "$offenders" | sed 's/^/  /' >&2
    echo "Replace raw glyphs with HTML entities or \\uXXXX escapes." >&2
    exit 1
fi

echo "ASCII7 check passed: all tracked files are 7-bit US-ASCII."
