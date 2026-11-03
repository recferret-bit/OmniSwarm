#!/bin/bash
# One-command deploy from the owner's machine over ssh.
#   deploy.sh [--dry-run] <ssh-host> <git-ref> [--api-replicas N] [--workers M]
#   deploy.sh [--dry-run] <ssh-host> --rollback [--api-replicas N] [--workers M]
#
# deploy: `git archive <ref>` -> rsync to the host -> unpack into
#         /srv/omniswarm/releases/<id> -> `release.sh activate <id>` as root
#         (host deps, image build, one migration run, `current` flip, rolling
#         api/web restart, nginx reload, workers restarted one at a time).
# rollback: `release.sh rollback` on the host.
# --dry-run prints every local and remote command and contacts nothing.
# The ssh user (provision.sh --deploy-user, default `deploy`) needs passwordless
# sudo: it unpacks the release and runs its release.sh as root, so it is
# root-equivalent. Run infra/deploy/smoke.sh <domain> afterwards.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRV=/srv/omniswarm
dry=0
host=""
ref=""
rollback=0
extra="" # validated numeric options, passed through to release.sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1; shift ;;
    --rollback) rollback=1; shift ;;
    --api-replicas | --workers)
      case "${2:-}" in '' | *[!0-9]*) echo "deploy.sh: $1 needs a number" >&2; exit 64 ;; esac
      extra="$extra $1 $2"; shift 2 ;;
    -h | --help) sed -n '2,15p' "$0"; exit 0 ;;
    -*) echo "deploy.sh: unknown option $1" >&2; exit 64 ;;
    *) if [ -z "$host" ]; then host="$1"; else ref="$1"; fi; shift ;;
  esac
done
[ -n "$host" ] || { echo "usage: deploy.sh [--dry-run] <ssh-host> <git-ref> | --rollback" >&2; exit 64; }
[ "$rollback" = 1 ] || [ -n "$ref" ] || { echo "deploy.sh: give a git ref (tag or commit) or --rollback" >&2; exit 64; }

run() {
  if [ "$dry" = 1 ]; then printf '+'; printf ' %q' "$@"; printf '\n'; else "$@"; fi
}

# remote <command string>: one ssh call. Every word in it is either a fixed
# path, the sanitized release id ([A-Za-z0-9._-]) or a validated number.
remote() {
  if [ "$dry" = 1 ]; then printf '+ ssh -o BatchMode=yes %s <<remote\n%s\nremote\n' "$host" "$1"; else ssh -o BatchMode=yes "$host" "$1"; fi
}

if [ "$rollback" = 1 ]; then
  remote "sudo $SRV/current/infra/deploy/release.sh rollback$extra"
  exit 0
fi

commit="$(git -C "$ROOT" rev-parse --verify --quiet "$ref^{commit}")" || {
  echo "deploy.sh: $ref is not a commit in $ROOT" >&2; exit 65
}
if git -C "$ROOT" show-ref --verify --quiet "refs/tags/$ref"; then id="$ref"; else id="$(git -C "$ROOT" rev-parse --short=12 "$commit")"; fi
id="$(printf '%s' "$id" | tr -c 'A-Za-z0-9._-' '-')"
[ -n "$id" ] && [ "$id" != "." ] && [ "$id" != ".." ] || { echo "deploy.sh: bad release id" >&2; exit 65; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
archive="$tmp/omniswarm-$id.tar.gz"
staged="omniswarm-$id.tar.gz" # in the ssh user's home on the host

echo "deploying $ref ($commit) to $host as release $id"
run git -C "$ROOT" archive --format=tar.gz --prefix="$id/" -o "$archive" "$commit"
run rsync -az --partial -e "ssh -o BatchMode=yes" "$archive" "$host:$staged"
remote "set -eu
if [ -L $SRV/current ] && [ \"\$(basename \"\$(readlink $SRV/current)\")\" = $id ]; then echo 'release $id is already current' >&2; exit 1; fi
sudo mkdir -p $SRV/releases
sudo rm -rf $SRV/releases/$id
sudo tar -xzf ~/$staged -C $SRV/releases
rm -f ~/$staged
sudo $SRV/releases/$id/infra/deploy/release.sh activate $id$extra"
