#!/bin/bash
# Prints the owner deploy commands. It does not create accounts, deploy, or sign.
set -euo pipefail
if [ "${1:-}" != "--dry-run" ]; then
  echo "Refusing to deploy. Run: bash contracts/review-registry/scripts/deploy-testnet.sh --dry-run" >&2
  exit 2
fi
OWNER="${OWNER:-owner.testnet}"
CONTRACT="${CONTRACT:-review-registry.${OWNER}}"
OPERATOR="${OPERATOR:-operator.${OWNER}}"
TREASURY="${TREASURY:-treasury.${OWNER}}"
WASM="${WASM:-contracts/review-registry/target/near/review_registry.wasm}"
cat <<EOF
near account create-account sponsor-by-${OWNER} ${CONTRACT} autogenerate-new-keypair print-to-terminal network-config testnet
near contract deploy ${CONTRACT} use-file ${WASM} without-init-call network-config testnet sign-with-keychain send
near contract call-function as-transaction ${CONTRACT} new json-args '{"owner":"${OWNER}","operator":"${OPERATOR}","treasury":"${TREASURY}","price_yocto":"1000000000000000000000000"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as ${CONTRACT} network-config testnet sign-with-keychain send
near account add-key ${CONTRACT} grant-function-call-access --allowance '1 NEAR' --receiver-account-id ${CONTRACT} --method-names 'mark_running,attest,refund,report_address,reviewer_attest' autogenerate-new-keypair print-to-terminal network-config testnet sign-with-keychain send
EOF
