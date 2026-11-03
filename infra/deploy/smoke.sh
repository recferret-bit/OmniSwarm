#!/bin/bash
# Smoke test of a running stack, from outside it.
#   smoke.sh [options] <domain[:https-port]> [reports-domain]
#     --dry-run            print the requests, send nothing
#     --cacert FILE        trust this CA (local self-signed stack)
#     --resolve IP         send both hostnames to IP (curl --resolve)
#     --http-port N        port of the http->https redirect (default 80)
#     --network NAME       /api/health must report this network
#     --report PATH        reports-origin path to check (default /sample/report.html)
#     --min-cert-days N    certificates must be valid for N more days (default 14)
#     --no-burst           skip the /api/challenge rate-limit burst
# Prints one "ok <check>" or "FAIL <check>: <why>" line per check and exits 1
# if any check failed. reports-domain defaults to reports.<domain>.
set -euo pipefail

dry=0; cacert=""; resolve_ip=""; http_port=80; network=""; report_path=/sample/report.html
min_days=14; burst=1; target=""; reports=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1; shift ;;
    --cacert) cacert="$2"; shift 2 ;;
    --resolve) resolve_ip="$2"; shift 2 ;;
    --http-port) http_port="$2"; shift 2 ;;
    --network) network="$2"; shift 2 ;;
    --report) report_path="$2"; shift 2 ;;
    --min-cert-days) min_days="$2"; shift 2 ;;
    --no-burst) burst=0; shift ;;
    -h | --help) sed -n '2,14p' "$0"; exit 0 ;;
    -*) echo "smoke.sh: unknown option $1" >&2; exit 64 ;;
    *) if [ -z "$target" ]; then target="$1"; else reports="$1"; fi; shift ;;
  esac
done
[ -n "$target" ] || { echo "usage: smoke.sh [options] <domain[:https-port]> [reports-domain]" >&2; exit 64; }

domain="${target%%:*}"
port=443
[ "$target" != "$domain" ] && port="${target#*:}"
reports="${reports:-reports.$domain}"
suffix=""; [ "$port" != 443 ] && suffix=":$port"
APP="https://$domain$suffix"
REPORTS="https://$reports$suffix"

curl_opts=(--silent --show-error --max-time 10 --proto '=https,http')
[ -n "$cacert" ] && curl_opts+=(--cacert "$cacert")
if [ -n "$resolve_ip" ]; then
  for h in "$domain" "$reports"; do curl_opts+=(--resolve "$h:$port:$resolve_ip" --resolve "$h:$http_port:$resolve_ip"); done
fi

failures=0
ok() { echo "ok   $1"; }
fail() { echo "FAIL $1: $2"; failures=$((failures + 1)); }
# verdict <name> <problem>: ok when <problem> is empty.
verdict() { if [ -z "$2" ]; then ok "$1"; else fail "$1" "$2"; fi; }

# req <name> <curl args...>: response headers+body in $out, or a dry-run line.
req() {
  local name="$1"; shift
  if [ "$dry" = 1 ]; then
    printf '+ [%s] curl' "$name"; printf ' %q' "${curl_opts[@]}" "$@"; printf '\n'
    return 1
  fi
  out="$(curl "${curl_opts[@]}" --include "$@" 2>&1)" || { fail "$name" "request failed: ${out##*$'\n'}"; return 1; }
}
status() { printf '%s\n' "$out" | awk 'toupper($1) ~ /^HTTP\// { code = $2 } END { print code }'; }
header() { printf '%s\n' "$out" | tr -d '\r' | awk -v h="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" 'BEGIN { FS = ": " } tolower($1) == h { sub(/^[^:]*: /, ""); print; exit }'; }
body() { printf '%s\n' "$out" | tr -d '\r' | awk 'f { print } /^$/ { f = 1 }'; }

check_cert() {
  local name="$1" host="$2" connect="${resolve_ip:-$2}" seconds=$((min_days * 86400))
  if [ "$dry" = 1 ]; then printf '+ [%s] openssl s_client -connect %s:%s -servername %s | openssl x509 -checkend %s\n' "$name" "$connect" "$port" "$host" "$seconds"; return; fi
  if openssl s_client -connect "$connect:$port" -servername "$host" </dev/null 2>/dev/null | openssl x509 -noout -checkend "$seconds" >/dev/null 2>&1; then
    ok "$name"
  else
    fail "$name" "certificate for $host missing or expiring within $min_days days"
  fi
}

check_cert tls-app "$domain"
check_cert tls-reports "$reports"

if req http-redirect "http://$domain:$http_port/api/health"; then
  loc="$(header location)"
  case "$(status)" in
    301 | 308) verdict http-redirect "$( [ "$loc" = "$APP/api/health" ] || echo "Location is '$loc', want $APP/api/health")" ;;
    *) fail http-redirect "status $(status), want 301" ;;
  esac
fi

if req health "$APP/api/health"; then
  b="$(body)"
  if [ "$(status)" != 200 ]; then fail health "status $(status)"
  elif ! printf '%s' "$b" | grep -q '"ok":true'; then fail health "body has no \"ok\":true: $b"
  elif [ -n "$network" ] && ! printf '%s' "$b" | grep -q "\"network\":\"$network\""; then fail health "network is not $network: $b"
  else ok health; fi
fi

if req ready "$APP/api/ready"; then
  verdict ready "$( [ "$(status)" = 200 ] || echo "status $(status)")"
fi

if req web-root "$APP/"; then
  if [ "$(status)" != 200 ]; then fail web-root "status $(status)"
  else case "$(header content-type)" in text/html*) ok web-root ;; *) fail web-root "content-type $(header content-type)" ;; esac; fi
fi

if req app-headers "$APP/api/health"; then
  missing=""
  for h in strict-transport-security x-content-type-options content-security-policy; do
    [ -n "$(header "$h")" ] || missing="$missing $h"
  done
  verdict app-headers "${missing:+missing:$missing}"
fi

if req admin-blocked -X POST "$APP/api/admin/requests/00000000-0000-4000-8000-000000000000/refund"; then
  verdict admin-blocked "$( [ "$(status)" = 403 ] || echo "status $(status), want 403")"
fi

if req reports-csp --head "$REPORTS$report_path"; then
  csp="$(header content-security-policy)"
  if [ "$(status)" != 200 ]; then fail reports-csp "status $(status) for $report_path"
  else case "$csp" in *"frame-ancestors $APP"*"sandbox"*) ok reports-csp ;; *) fail reports-csp "CSP is '$csp'" ;; esac; fi
fi

if [ "$burst" = 1 ]; then
  if [ "$dry" = 1 ]; then
    req rate-limit -X POST -H 'content-type: application/json' --data '{}' "$APP/api/challenge" || true
  else
    limited=0
    for _ in $(seq 1 40); do
      code="$(curl "${curl_opts[@]}" -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' --data '{}' "$APP/api/challenge" || true)"
      [ "$code" = 429 ] && limited=$((limited + 1))
    done
    verdict "rate-limit ($limited/40 answered 429)" "$( [ "$limited" -gt 0 ] || echo "40 rapid POST /api/challenge, none answered 429")"
  fi
fi

[ "$dry" = 1 ] && { echo "dry run: nothing was sent"; exit 0; }
if [ "$failures" -gt 0 ]; then echo "smoke: $failures check(s) failed"; exit 1; fi
echo "smoke: all checks passed for $APP"
