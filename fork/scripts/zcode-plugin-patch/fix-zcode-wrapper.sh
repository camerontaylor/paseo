#!/bin/sh
# Add --no-network-family-autoselection to a shell-wrapper zcode launcher.
#
# When `zcode` on PATH is a wrapper script (not the .cjs bundle), the bridge's
# resolve.js passes it through untouched, so the kit's resolve.js patch cannot
# inject the Happy Eyeballs kill switch into the launch argv. Hosts that wrap
# zcode like this run this instead — see apply.sh header for the why.
#
# Usage: fix-zcode-wrapper.sh [wrapper-path]
#        defaults to $(command -v zcode); no-op if it is not the known shape.

set -eu

wrapper=${1:-$(command -v zcode || true)}
if [ -z "$wrapper" ]; then
  echo "no zcode on PATH — pass the wrapper path explicitly" >&2
  exit 1
fi
if [ ! -f "$wrapper" ]; then
  echo "$wrapper is not a regular file (bundle binaries need no wrapper fix)" >&2
  exit 0
fi

if grep -q -- --no-network-family-autoselection "$wrapper"; then
  echo "wrapper already patched: $wrapper"
  exit 0
fi

# Only touch the known shape: an exec line that runs the zcode.cjs bundle via
# a $NODE variable. Anything else (native binary, different layout) bails.
if ! grep -q '^exec "\$NODE"' "$wrapper"; then
  echo "$wrapper does not match the known wrapper shape — patch manually" >&2
  exit 1
fi

cp "$wrapper" "$wrapper.pre-happy-eyeballs"
sed -i.bak 's|^exec "\$NODE" |exec "$NODE" --no-network-family-autoselection |' "$wrapper"
rm -f "$wrapper.bak"
echo "patched: $wrapper (backup at $wrapper.pre-happy-eyeballs)"
