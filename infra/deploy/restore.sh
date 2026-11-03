#!/bin/bash
# Restore a backup.sh dump. Run as root on the host.
#   restore.sh drill [dump] [--dry-run]
#       Restores into a scratch database, prints "restored: <table>=<rows> ...",
#       compares each count with the live database, drops the scratch database.
#       Default dump: the newest in OMNI_BACKUP_DIR.
#   restore.sh live <dump> --yes [--dry-run]
#       Stops the workers and the api, restores over the live database in one
#       transaction, starts them again. Take a fresh backup first.
set -euo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "$0")/lib.sh"

DIR="${OMNI_BACKUP_DIR:-$OMNI_SRV/backup}"
SCRATCH=omniswarm_restore_drill
cmd="${1:-}"; shift || true
dump=""
yes=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) OMNI_DRY_RUN=1; shift ;;
    --yes) yes=1; shift ;;
    -*) omni_die "unknown option $1" ;;
    *) dump="$1"; shift ;;
  esac
done

newest_dump() {
  local f last=""
  for f in "$DIR"/db-*.dump; do [ -e "$f" ] && last="$f"; done
  printf '%s' "$last"
}

psql_c() { omni_compose exec -T postgres psql -v ON_ERROR_STOP=1 -U omniswarm -At "$@"; }

# "table|rows" lines for every table in the public schema of database $1.
row_counts() {
  [ "$OMNI_DRY_RUN" = 1 ] && { psql_c -d "$1" -c '<count rows per public table>'; return 0; }
  printf '%s\n' "SELECT format('SELECT %L || ''|'' || count(*) FROM %I', tablename, tablename) FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename \\gexec" \
    | psql_c -d "$1"
}

drill() {
  dump="${dump:-$(newest_dump)}"
  [ "$OMNI_DRY_RUN" = 1 ] || [ -s "$dump" ] || omni_die "no dump found (looked in $DIR)"
  psql_c -d postgres -c "SET client_min_messages TO warning" -c "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH"
  if [ "$OMNI_DRY_RUN" = 1 ]; then
    omni_compose exec -T postgres pg_restore -U omniswarm -d "$SCRATCH" --no-owner --exit-on-error
  else
    omni_compose exec -T postgres pg_restore -U omniswarm -d "$SCRATCH" --no-owner --exit-on-error < "$dump"
  fi
  local restored live
  restored="$(row_counts "$SCRATCH")"
  live="$(row_counts omniswarm)"
  psql_c -d postgres -c "DROP DATABASE $SCRATCH"
  [ "$OMNI_DRY_RUN" = 1 ] && return 0
  echo "restored from $(basename "$dump"): $(printf '%s\n' "$restored" | tr '|' '=' | tr '\n' ' ')"
  echo "live now:                $(printf '%s\n' "$live" | tr '|' '=' | tr '\n' ' ')"
  [ -n "$restored" ] || omni_die "the dump restored no tables"
}

live() {
  [ -n "$dump" ] || omni_die "usage: restore.sh live <dump> --yes"
  [ "$yes" = 1 ] || omni_die "live restore replaces the production database; pass --yes"
  omni_run systemctl stop omniswarm-workers.target
  omni_compose stop api
  if [ "$OMNI_DRY_RUN" = 1 ]; then
    omni_compose exec -T postgres pg_restore -U omniswarm -d omniswarm --clean --if-exists --no-owner --single-transaction --exit-on-error
  else
    omni_compose exec -T postgres pg_restore -U omniswarm -d omniswarm --clean --if-exists --no-owner --single-transaction --exit-on-error < "$dump"
  fi
  omni_compose up -d --no-deps --wait api
  omni_run systemctl start omniswarm-workers.target
  omni_log "restored $dump into omniswarm"
}

case "$cmd" in
  drill) drill ;;
  live) live ;;
  *) omni_die "usage: restore.sh drill [dump] | live <dump> --yes  [--dry-run]" ;;
esac
