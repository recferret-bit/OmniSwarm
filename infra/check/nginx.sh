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
  local label="$1" templates="$2" domain="$3" reports="$4" app_origin="$5" reports_origin="$6" kind="$7"
  local certs="$CHECK_TMP/nginx-$label/tls" acme="$CHECK_TMP/nginx-$label/acme" out="$CHECK_TMP/nginx-$label/rendered.conf"
  mkdir -p "$certs/live/$domain" "$acme" "$CHECK_TMP/nginx-$label/reports"
  printf 'admin:{SHA}2jmj7l5rSw0yVb/vlWAYkK/YBwk=\n' > "$CHECK_TMP/nginx-$label/admin.htpasswd"
  openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=$domain" \
    -keyout "$certs/live/$domain/privkey.pem" -out "$certs/live/$domain/fullchain.pem" 2>/dev/null
  chmod 0644 "$certs/live/$domain/privkey.pem"
  docker run --rm --network none -e NGINX_ENTRYPOINT_QUIET_LOGS=1 \
    -e NGINX_ENVSUBST_FILTER='^OMNI_' -e OMNI_DOMAIN="$domain" -e OMNI_REPORTS_DOMAIN="$reports" \
    -e OMNI_APP_ORIGIN="$app_origin" -e OMNI_REPORTS_ORIGIN="$reports_origin" \
    -v "$INFRA/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
    -v "$templates:/etc/nginx/templates:ro" \
    -v "$INFRA/nginx/snippets:/etc/nginx/snippets:ro" \
    -v "$certs:/etc/letsencrypt:ro" -v "$acme:/var/www/certbot:ro" \
    -v "$CHECK_TMP/nginx-$label/reports:/srv/reports:ro" \
    -v "$CHECK_TMP/nginx-$label/admin.htpasswd:/etc/nginx/admin.htpasswd:ro" \
    --tmpfs /etc/nginx/conf.d \
    "$NGINX_IMAGE" sh -c '/docker-entrypoint.sh nginx -t -q && cat /etc/nginx/conf.d/omniswarm.conf' \
    > "$out" || check_fail "nginx -t rejected the $label config"
  assert_rendered "$label" "$out" "$domain" "$app_origin" "$kind"
  check_log "nginx -t ok ($label: $domain, $reports)"
}

need() { grep -qE "$2" "$1" || check_fail "rendered nginx config ($3) lacks: $4"; }

# shellcheck disable=SC2016 # the patterns match literal nginx $variables
# Locations live in snippets included by both edges. nginx -t loads them;
# the rendered file only has the include, so the assertions read the snippet.
assert_locations() {
  local app="$INFRA/nginx/snippets/app-locations.conf"
  need "$app" 'set \$omni_api api:8787;' "app locations" "per-request resolved api upstream (scaling without reload)"
  need "$app" 'location \^~ /api/admin \{' "app locations" "admin prefix location"
  awk '/location \^~ \/api\/admin \{/ { f = 1 } f && /deny all;/ { ok = 1 } f && /\}/ { exit } END { exit !ok }' "$app" \
    || check_fail "/api/admin is not denied"
  awk '/location ~ \^\/api\/requests\/\[\^\/\]\+\/events\$ \{/ { f = 1 } f { s = s $0 } f && /\}/ { exit } END { exit !(s ~ /proxy_buffering off/ && s ~ /proxy_read_timeout 1h/ && s ~ /gzip off/) }' "$app" \
    || check_fail "SSE location lacks buffering off / 1h read timeout / gzip off"
  need "$app" 'limit_req zone=omni_challenge' "app locations" "rate limit on /api/challenge"
  grep -q 'proxy_pass http://\$omni_api;' "$app" || check_fail "no api proxy"
  grep -qE '^[[:space:]]*upstream ' "$app" "$INFRA/nginx/templates/omniswarm.conf.template" "$INFRA/nginx/templates-http/omniswarm.conf.template" \
    && check_fail "static upstream block: replicas added by --scale would get no traffic"
  grep -q 'X-Forwarded-For \$remote_addr' "$INFRA/nginx/snippets/proxy.conf" \
    || check_fail "proxy.conf must overwrite X-Forwarded-For with \$remote_addr (TRUST_PROXY=true in the api)"
  grep -q 'add_header ' "$app" && check_fail "app-locations.conf sets add_header; that drops the server headers"
  return 0
}
assert_locations

# shellcheck disable=SC2016 # the patterns match literal nginx $variables
assert_rendered() {
  local label="$1" f="$2" domain="$3" app_origin="$4" kind="$5"
  grep -vE '^[[:space:]]*#' "$f" | grep -q '\${OMNI_' && check_fail "rendered nginx config ($label) still has an unrendered \${OMNI_*}"
  need "$f" "server_name $domain;" "$label" "app server_name"
  need "$f" 'include /etc/nginx/snippets/app-locations.conf;' "$label" "shared app locations"
  need "$f" 'include /etc/nginx/snippets/reports-locations.conf;' "$label" "shared reports locations"
  need "$f" "frame-ancestors $app_origin;" "$label" "reports CSP frame-ancestors for the app origin"
  if [ "$kind" = tls ]; then
    need "$f" 'return 301 \$omni_https_origin\$request_uri' "$label" "http -> https redirect"
    need "$f" "ssl_certificate +/etc/letsencrypt/live/$domain/fullchain.pem" "$label" "Let's Encrypt certificate path"
    need "$f" 'ssl_reject_handshake on;' "$label" "unknown hostnames rejected at the TLS handshake"
    need "$f" 'include /etc/nginx/snippets/hsts.conf;' "$label" "HSTS on the TLS servers"
    grep -q 'auth_basic' "$f" && check_fail "production TLS config ($label) asks for admin basic auth"
  else
    need "$f" 'listen 80 default_server;' "$label" "plain HTTP listener"
    need "$f" 'include /etc/nginx/snippets/admin-basic.conf;' "$label" "admin basic-auth locations"
    need "$INFRA/nginx/snippets/admin-basic.conf" 'auth_basic "OmniSwarm admin";' "$label" "nginx basic auth on the admin page"
    need "$INFRA/nginx/snippets/admin-basic.conf" 'auth_basic_user_file /etc/nginx/admin.htpasswd;' "$label" "admin htpasswd file"
    need "$INFRA/nginx/snippets/admin-basic.conf" 'location \^~ /admin \{' "$label" "admin page location"
    grep -q 'ssl_certificate' "$f" && check_fail "local HTTP config ($label) references a certificate"
    grep -q 'return 301' "$f" && check_fail "local HTTP config ($label) redirects"
    grep -q 'hsts.conf' "$f" && check_fail "local HTTP config ($label) sends HSTS"
  fi
  return 0
}

# Log hygiene (W12-13): the access log carries no query string, body, header,
# cookie or full client address.
# shellcheck disable=SC2016 # the patterns are literal nginx $variables
assert_log_format() {
  local logfmt bad
  logfmt="$(awk '/log_format omniswarm/ { f = 1 } f { print } f && /;[[:space:]]*$/ { exit }' "$INFRA/nginx/nginx.conf")"
  [ -n "$logfmt" ] || check_fail "nginx.conf has no log_format omniswarm"
  for bad in '$remote_addr' '$request ' '$request_uri' '$args' '$query_string' '$request_body' '$http_' '$cookie_'; do
    case "$logfmt" in *"$bad"*) check_fail "nginx log_format logs $bad" ;; esac
  done
  case "$logfmt" in *'$omni_log_addr'*) ;; *) check_fail 'nginx log_format does not use the truncated $omni_log_addr' ;; esac
  grep -q 'access_log /dev/stdout omniswarm;' "$INFRA/nginx/nginx.conf" || check_fail "nginx access_log does not use log_format omniswarm"
  for level in 'limit_req_log_level notice;' 'limit_conn_log_level notice;' 'error_log /dev/stderr warn;'; do
    grep -qF "$level" "$INFRA/nginx/nginx.conf" || check_fail "nginx.conf lacks '$level' (rate-limit rejections would log full client addresses)"
  done
  grep -q 'proxy_set_header X-Request-ID $request_id;' "$INFRA/nginx/snippets/proxy.conf" \
    || check_fail "proxy.conf must overwrite X-Request-ID (the API logs it as the request id)"
  if grep -rhE '^[[:space:]]*access_log' "$INFRA/nginx/templates" "$INFRA/nginx/templates-http" "$INFRA/nginx/snippets" | grep -vqE 'access_log (off|/dev/stdout omniswarm);'; then
    check_fail "a server or location logs with another format"
  fi
  check_log "nginx access log: truncated client address, path without query, no headers or cookies"
}
assert_log_format

render_and_test prod "$INFRA/nginx/templates" omniswarm.example reports.omniswarm.example \
  https://omniswarm.example https://reports.omniswarm.example tls
render_and_test dev "$INFRA/nginx/templates-http" omniswarm.localhost reports.omniswarm.localhost \
  http://omniswarm.localhost:18480 http://reports.omniswarm.localhost:18480 http
