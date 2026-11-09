#!/bin/bash
# Build the review-registry release wasm and record its sha256.
#
# Deploy and the local runner use the committed res/review_registry.wasm and do not
# need Rust when that file and its sha256 are present. This script is the builder
# step that produces those files. Host only; the review sandbox never runs it.
# Run from the repository root:
#
#   bash contracts/review-registry/scripts/build-wasm.sh
#
# Same flags as test-sandbox.sh. Needs the wasm32-unknown-unknown target
# (`rustup target add wasm32-unknown-unknown`). Honors CARGO_TARGET_DIR.
set -euo pipefail

manifest="contracts/review-registry/Cargo.toml"
if ! rustup target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown; then
  echo "missing target: rustup target add wasm32-unknown-unknown" >&2
  exit 2
fi
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="--cfg near" \
  cargo build --manifest-path "$manifest" --target wasm32-unknown-unknown --release

if [ -n "${CARGO_TARGET_DIR:-}" ]; then
  target_dir="${CARGO_TARGET_DIR%/}"
else
  target_dir="contracts/review-registry/target"
fi
built="${target_dir}/wasm32-unknown-unknown/release/review_registry.wasm"
if [ ! -f "$built" ]; then
  echo "built wasm not found: ${built}" >&2
  exit 1
fi

dest_dir="contracts/review-registry/res"
dest="${dest_dir}/review_registry.wasm"
mkdir -p "$dest_dir"
cp "$built" "$dest"
sha_file="${dest}.sha256"
shasum -a 256 "$dest" > "$sha_file"
cat "$sha_file"
shasum -a 256 -c "$sha_file"
