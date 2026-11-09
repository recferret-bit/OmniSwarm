#!/bin/bash
# Rebuild the two guard-fixture wasms and their sha256 lines. Host only.
# Run from the repository root:
#
#   bash infra/near-local/fixtures/build.sh
#
# `--cfg near` matches contracts/review-registry/scripts/build-wasm.sh (near-sdk 5.30
# keeps its on-chain panic paths). The committed wasms were built with rustc 1.99.
# `--locked` keeps near-sys 0.4.0: 0.4.1 hides host functions near-sdk 5.30.0 calls.
# Needs the wasm32-unknown-unknown target (`rustup target add wasm32-unknown-unknown`).
set -euo pipefail

if ! rustup target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown; then
  echo "missing target: rustup target add wasm32-unknown-unknown" >&2
  exit 2
fi

manifest="infra/near-local/fixtures/Cargo.toml"
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="--cfg near" \
  cargo build --locked --manifest-path "$manifest" --target wasm32-unknown-unknown --release

if [ -n "${CARGO_TARGET_DIR:-}" ]; then
  target_dir="${CARGO_TARGET_DIR%/}"
else
  target_dir="infra/near-local/fixtures/target"
fi
release="${target_dir}/wasm32-unknown-unknown/release"
out="infra/near-local/fixtures"
cp "${release}/good_dex.wasm" "${out}/good-dex.wasm"
cp "${release}/drained_vault.wasm" "${out}/drained-vault.wasm"
if cmp -s "${out}/good-dex.wasm" "${out}/drained-vault.wasm"; then
  echo "fixture wasms are identical" >&2
  exit 1
fi

shasum -a 256 "${out}/good-dex.wasm" > "${out}/good-dex.wasm.sha256"
shasum -a 256 "${out}/drained-vault.wasm" > "${out}/drained-vault.wasm.sha256"
cat "${out}/good-dex.wasm.sha256" "${out}/drained-vault.wasm.sha256"
shasum -a 256 -c "${out}/good-dex.wasm.sha256" "${out}/drained-vault.wasm.sha256"
