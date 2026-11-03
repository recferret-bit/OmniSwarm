#!/bin/bash
# `nginx -t` on the real config: infra/nginx/nginx.conf plus the rendered
# template and snippets, in the pinned nginx image, for the prod and dev
# hostnames, with a throwaway certificate in the Let's Encrypt layout.
# Then asserts the rendered config keeps the properties the stack relies on.
set -euo pipefail
# shellcheck source=infra/check/lib.sh
. "$(dirname "$0")/lib.sh"
: "${CHECK_TMP:?run through infra/check.sh}"

render_and_test() {
  local label="$1" domain="$2" reports="$3" app_origin="$4" reports_origin="$5"
  local certs="$CHECK_TMP/nginx-$label/tls" acme="$CHECK_TMP/nginx-$label/acme" out="$CHECK_TMP/nginx-$label/rendered.conf"
  mkdir -p "$certs/live/$domain" "$acme" "$CHECK_TMP/nginx-$label/reports"
  openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=$domain" \
    -keyout "$certs/live/$domain/privkey.pem" -out "$certs/live/$domain/fullchain.pem" 2>/dev/null
  chmod 0644 "$certs/live/$domain/privkey.pem"
  docker run --rm --network none -e NGINX_ENTRYPOINT_QUIET_LOGS=1 \
    -e NGINX_ENVSUBST_FILTER='^OMNI_' -e OMNI_DOMAIN="$domain" -e OMNI_REPORTS_DOMAIN="$reports" \
    -e OMNI_APP_ORIGIN="$app_origin" -e OMNI_REPORTS_ORIGIN="$reports_origin" \
    -v "$INFRA/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
    -v "$INFRA/nginx/templates:/etc/nginx/templates:ro" \
    -v "$INFRA/nginx/snippets:/etc/nginx/snippets:ro" \
    -v "$certs:/etc/letsencrypt:ro" -v "$acme:/var/www/certbot:ro" \
    -v "$CHECK_TMP/nginx-$label/reports:/srv/reports:ro" \
    --tmpfs /etc/nginx/conf.d \
    "$NGINX_IMAGE" sh -c '/docker-entrypoint.sh nginx -t -q && cat /etc/nginx/conf.d/omniswarm.conf' \
    > "$out" || check_fail "nginx -t rejected the $label config"
  assert_rendered "$label" "$out" "$domain" "$app_origin"
  check_log "nginx -t ok ($label: $domain, $reports)"
}

need() { grep -qE "$2" "$1" || check_fail "rendered nginx config ($3) lacks: $4"; }

# shellcheck disable=SC2016 # the patterns match literal nginx $variables
assert_rendered() {
  local label="$1" f="$2" domain="$3" app_origin="$4"
  grep -vE '^[[:space:]]*#' "$f" | grep -q '\${OMNI_' && check_fail "rendered nginx config ($label) still has an unrendered \${OMNI_*}"
  need "$f" 'return 301 \$omni_https_origin\$request_uri' "$label" "http -> https redirect"
  need "$f" "server_name $domain;" "$label" "app server_name"
  need "$f" "ssl_certificate +/etc/letsencrypt/live/$domain/fullchain.pem" "$label" "Let's Encrypt certificate path"
  need "$f" 'set \$omni_api api:8787;' "$label" "per-request resolved api upstream (scaling without reload)"
  need "$f" 'location \^~ /api/admin \{' "$label" "admin prefix location"
  awk '/location \^~ \/api\/admin \{/ { f = 1 } f && /deny all;/ { ok = 1 } f && /\}/ { exit } END { exit !ok }' "$f" \
    || check_fail "/api/admin is not denied ($label)"
  awk '/location ~ \^\/api\/requests\/\[\^\/\]\+\/events\$ \{/ { f = 1 } f { s = s $0 } f && /\}/ { exit } END { exit !(s ~ /proxy_buffering off/ && s ~ /proxy_read_timeout 1h/ && s ~ /gzip off/) }' "$f" \
    || check_fail "SSE location lacks buffering off / 1h read timeout / gzip off ($label)"
  need "$f" "frame-ancestors $app_origin;" "$label" "reports CSP frame-ancestors for the app origin"
  need "$f" 'limit_req zone=omni_challenge' "$label" "rate limit on /api/challenge"
  grep -q 'proxy_pass http://\$omni_api;' "$f" || check_fail "no api proxy ($label)"
  grep -qE '^[[:space:]]*upstream ' "$f" && check_fail "static upstream block ($label): replicas added by --scale would get no traffic"
  grep -q 'X-Forwarded-For \$remote_addr' "$INFRA/nginx/snippets/proxy.conf" \
    || check_fail "proxy.conf must overwrite X-Forwarded-For with \$remote_addr (TRUST_PROXY=true in the api)"
}

render_and_test prod omniswarm.example reports.omniswarm.example \
  https://omniswarm.example https://reports.omniswarm.example
render_and_test dev omniswarm.localhost reports.omniswarm.localhost \
  https://omniswarm.localhost:18443 https://reports.omniswarm.localhost:18443
