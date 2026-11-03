# shellcheck shell=bash
# shellcheck disable=SC2034 # the variables below are read by the scripts that source this file
# Shared by infra/check.sh and infra/check/*.sh. Pinned tool images: every
# machine (laptop, CI) runs the same linter versions.
CHECK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA="$(cd "$CHECK_DIR/.." && pwd)"
ROOT="$(cd "$INFRA/.." && pwd)"

SHELLCHECK_IMAGE=koalaman/shellcheck:v0.11.0@sha256:61862eba1fcf09a484ebcc6feea46f1782532571a34ed51fedf90dd25f925a8d
HADOLINT_IMAGE=hadolint/hadolint:v2.15.1@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d
NGINX_IMAGE=nginx:1.30.6-alpine3.24@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949
SYSTEMD_CHECK_IMAGE=omniswarm-infra-check/systemd:trixie-20261027-2
# Bump a tag when its Dockerfile changes, so cached images are rebuilt.
HOSTS_CHECK_IMAGE=omniswarm-infra-check/hosts:trixie-20261027-1

# Scratch space for one check run; removed by check.sh on exit.
CHECK_TMP="${CHECK_TMP:-}"

check_log() { printf '  %s\n' "$*"; }
check_fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }

# A filled copy of stack.env.example: every empty value becomes check-<NAME>.
filled_stack_env() {
  local out="$1"
  awk -F= '/^[A-Z0-9_]+=/ { if ($2 == "") print $1 "=check-" tolower($1); else print; next } { print }' \
    "$INFRA/env/stack.env.example" > "$out"
  printf 'OMNI_RELEASE=check\n' >> "$out"
}

# compose_config <profile> <env-file> [config args...]
# COMPOSE_CHECK_EXTRA=<overlay file> adds one more -f.
compose_config() {
  local profile="$1" env_file="$2"; shift 2
  local files=(-f "$INFRA/compose/compose.yml" -f "$INFRA/compose/compose.$profile.yml")
  [ -n "${COMPOSE_CHECK_EXTRA:-}" ] && files+=(-f "$COMPOSE_CHECK_EXTRA")
  docker compose --project-name omniswarm-infra-check --project-directory "$INFRA/compose" \
    --env-file "$env_file" "${files[@]}" config "$@"
}
