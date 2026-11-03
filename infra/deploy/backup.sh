#!/bin/bash
# Nightly backup (omniswarm-backup.timer), run as root on the host:
#   db-<stamp>.dump          pg_dump -Fc of the omniswarm database
#   reports-<stamp>.tar.gz   the published report folders
# into OMNI_BACKUP_DIR (/srv/omniswarm/backup), keeping the newest
# OMNI_BACKUP_KEEP (7) of each. Restore: infra/deploy/restore.sh.
#   backup.sh [--dry-run] [--no-reports]
set -euo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "$0")/lib.sh"

DIR="${OMNI_BACKUP_DIR:-$OMNI_SRV/backup}"
KEEP="${OMNI_BACKUP_KEEP:-7}"
reports=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) OMNI_DRY_RUN=1; shift ;;
    --no-reports) reports=0; shift ;;
    *) omni_die "unknown option $1" ;;
  esac
done

stamp="$(date -u +%Y%m%dT%H%M%SZ)"

# keep_newest <glob-prefix> <suffix>: names sort by their UTC stamp.
keep_newest() {
  local files=() n
  for f in "$DIR/$1"*"$2"; do [ -e "$f" ] && files+=("$f"); done
  n=$(( ${#files[@]} - KEEP ))
  [ "$n" -gt 0 ] || return 0
  omni_run rm -f -- "${files[@]:0:$n}"
}

if [ "$OMNI_DRY_RUN" = 1 ]; then
  omni_compose exec -T postgres pg_dump -U omniswarm -d omniswarm -Fc
  printf '+ > %s/db-%s.dump; tar the reports dir; keep the newest %s\n' "$DIR" "$stamp" "$KEEP"
  exit 0
fi

umask 077
mkdir -p "$DIR"
omni_compose exec -T postgres pg_dump -U omniswarm -d omniswarm -Fc > "$DIR/db-$stamp.dump.part"
mv "$DIR/db-$stamp.dump.part" "$DIR/db-$stamp.dump"
omni_log "database: $DIR/db-$stamp.dump ($(wc -c < "$DIR/db-$stamp.dump" | tr -d ' ') bytes)"

if [ "$reports" = 1 ]; then
  src="$(omni_env_value OMNI_REPORTS_DIR)"
  tar -C "$(dirname "$src")" -czf "$DIR/reports-$stamp.tar.gz.part" "$(basename "$src")"
  mv "$DIR/reports-$stamp.tar.gz.part" "$DIR/reports-$stamp.tar.gz"
  omni_log "reports: $DIR/reports-$stamp.tar.gz"
fi

keep_newest db- .dump
keep_newest reports- .tar.gz
echo "$DIR/db-$stamp.dump"
