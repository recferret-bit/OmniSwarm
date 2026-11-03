#!/bin/bash
# TLS for OMNI_DOMAIN and OMNI_REPORTS_DOMAIN (one certificate, cert name = OMNI_DOMAIN).
#   certbot.sh issue [--staging] [--dry-run]   first issuance, standalone on :80,
#                                               before nginx owns the port
#   certbot.sh renew [--staging] [--dry-run]   webroot renewal through nginx, then
#                                               reload (omniswarm-certbot-renew.timer)
# --staging (or OMNI_ACME_STAGING=1) uses the Let's Encrypt staging CA.
set -euo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "$0")/lib.sh"

cmd="${1:-}"; shift || true
staging=()
[ "${OMNI_ACME_STAGING:-0}" = 1 ] && staging=(--staging)
while [ "$#" -gt 0 ]; do
  case "$1" in
    --staging) staging=(--staging); shift ;;
    --dry-run) OMNI_DRY_RUN=1; shift ;;
    *) omni_die "unknown option $1" ;;
  esac
done

case "$cmd" in
  issue)
    omni_compose run --rm --no-deps -p 80:80 certbot certonly --standalone \
      --non-interactive --agree-tos --email "$(omni_env_value OMNI_ACME_EMAIL)" \
      --cert-name "$(omni_env_value OMNI_DOMAIN)" \
      -d "$(omni_env_value OMNI_DOMAIN)" -d "$(omni_env_value OMNI_REPORTS_DOMAIN)" \
      ${staging[@]+"${staging[@]}"}
    ;;
  renew)
    omni_compose run --rm --no-deps certbot renew --non-interactive \
      --webroot -w /var/www/certbot ${staging[@]+"${staging[@]}"}
    omni_nginx_reload
    ;;
  *) omni_die "usage: certbot.sh issue|renew [--staging] [--dry-run]" ;;
esac
