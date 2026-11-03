#!/bin/bash
# Testnet deploy for the review registry, run by the owner from the repository root.
#
#   --dry-run   print the exact commands (shell-quoted) and exit; touches nothing
#   --execute   run the same commands with near-cli-rs and cargo-near
#
# Without a flag it refuses (exit 2). Keys go to the near-cli keychain; nothing prints a
# secret key. Subcommands and flags were checked against the near-cli-rs 0.30.0 source
# (`--allowance`, `--contract-account-id`, `--function-names`, `fund-myself`,
# `save-to-legacy-keychain`, `with-init-call`), not against a running `near` binary.
#
# Accounts (override through the environment):
#   OWNER     full-access account that pays for and signs everything (also the default treasury)
#   CONTRACT  review-registry.$OWNER, gets the wasm and its own full-access key (upgrade path)
#   OPERATOR  operator.$OWNER, holds the function-call key the API signs with
#   TREASURY  receives withdrawals
set -euo pipefail

mode="${1:-}"
if [ "$mode" != "--dry-run" ] && [ "$mode" != "--execute" ]; then
  echo "usage: bash contracts/review-registry/scripts/deploy-testnet.sh --dry-run|--execute" >&2
  exit 2
fi

OWNER="${OWNER:-owner.testnet}"
CONTRACT="${CONTRACT:-review-registry.${OWNER}}"
OPERATOR="${OPERATOR:-operator.${OWNER}}"
TREASURY="${TREASURY:-${OWNER}}"
PRICE_YOCTO="${PRICE_YOCTO:-1000000000000000000000000}"
OPERATOR_ALLOWANCE="${OPERATOR_ALLOWANCE:-1 NEAR}"
MANIFEST="contracts/review-registry/Cargo.toml"
WASM="${WASM:-contracts/review-registry/target/near/review_registry.wasm}"
# Must equal review_registry::OPERATOR_METHODS (a unit test compares them).
OPERATOR_METHODS="mark_running, attest, refund, report_address"

for value in "$OWNER" "$CONTRACT" "$OPERATOR" "$TREASURY"; do
  if ! [[ "$value" =~ ^[a-z0-9._-]{2,64}$ ]]; then
    echo "invalid account id: $value" >&2
    exit 2
  fi
done
if ! [[ "$PRICE_YOCTO" =~ ^[0-9]{1,39}$ ]]; then
  echo "invalid PRICE_YOCTO: $PRICE_YOCTO" >&2
  exit 2
fi

init_args="{\"owner\":\"${OWNER}\",\"operator\":\"${OPERATOR}\",\"treasury\":\"${TREASURY}\",\"price_yocto\":\"${PRICE_YOCTO}\"}"
network=(network-config testnet)

# Prints a word as-is when it is shell-safe, otherwise single-quoted (' becomes '\'').
quote() {
  if [[ "$1" =~ ^[A-Za-z0-9._/:=@%+-]+$ ]]; then
    printf '%s' "$1"
  else
    printf "'%s'" "${1//\'/\'\\\'\'}"
  fi
}

run() {
  if [ "$mode" = "--execute" ]; then
    "$@"
    return
  fi
  local line="" word
  for word in "$@"; do
    line+="${line:+ }$(quote "$word")"
  done
  printf '%s\n' "$line"
}

# 1. Build the wasm with cargo-near (host only; never inside the review sandbox).
run cargo near build non-reproducible-wasm --manifest-path "$MANIFEST"
# 2. The contract account, funded by the owner. Its full-access key lands in the keychain.
run near account create-account fund-myself "$CONTRACT" '5 NEAR' autogenerate-new-keypair save-to-keychain sign-as "$OWNER" "${network[@]}" sign-with-keychain send
# 3. The operator account. The API never receives this account's full-access key.
run near account create-account fund-myself "$OPERATOR" '1 NEAR' autogenerate-new-keypair save-to-keychain sign-as "$OWNER" "${network[@]}" sign-with-keychain send
# 4. Deploy and initialise in one transaction; `operator` is the account that gets the key below.
run near contract deploy "$CONTRACT" use-file "$WASM" with-init-call new json-args "$init_args" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' "${network[@]}" sign-with-keychain send
# 5. The function-call key on the operator, limited to the registry and the operator methods.
#    Saved to ~/.near-credentials/testnet/$OPERATOR/ for the owner to move into the host env file.
#    A key's method list cannot be edited: when OPERATOR_METHODS changes, add a new key with this
#    command and delete the old one (`near account delete-keys $OPERATOR`).
run near account add-key "$OPERATOR" grant-function-call-access --allowance "$OPERATOR_ALLOWANCE" --contract-account-id "$CONTRACT" --function-names "$OPERATOR_METHODS" autogenerate-new-keypair save-to-legacy-keychain "${network[@]}" sign-with-keychain send
# 6. Read back the price.
run near contract call-function as-read-only "$CONTRACT" get_price json-args '{}' "${network[@]}" now
