#!/bin/bash
# near-workspaces suite (tests/workspaces.rs) against a local near-sandbox node. Host and CI only;
# the review sandbox never runs this. Run from the repository root:
#
#   bash contracts/review-registry/scripts/test-sandbox.sh
#
# Needs the wasm32-unknown-unknown target (`rustup target add wasm32-unknown-unknown`). The first
# run downloads the near-sandbox binary (or set NEAR_SANDBOX_BIN_PATH). Honors CARGO_TARGET_DIR.
#
# `--cfg near` is what cargo-near passes. Without it near-sdk 5.30 compiles its off-chain code
# paths into the wasm: every `env::panic_str` becomes an `unreachable` trap with no message.
set -euo pipefail

manifest="contracts/review-registry/Cargo.toml"
if ! rustup target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown; then
  echo "missing target: rustup target add wasm32-unknown-unknown" >&2
  exit 2
fi
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="--cfg near" \
  cargo build --manifest-path "$manifest" --target wasm32-unknown-unknown --release
cargo test --manifest-path "$manifest" --features sandbox --test workspaces
