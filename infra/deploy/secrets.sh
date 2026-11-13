#!/bin/bash
# Installs the owner's filled env files on the host (W12-10), from the owner's machine.
#   secrets.sh [--dry-run] <ssh-host> [--from DIR]      (DIR default ~/.omniswarm/env)
#
# 1. node infra/deploy/secrets-check.mjs DIR: every variable present, required ones set,
#    cross-file values agree (the worker's presets = the stack's, DATABASE_URL
#    password = POSTGRES_PASSWORD, ...), no .testnet donation recipient. Prints
#    names and sha256 fingerprints only. Stops on an error.
# 2. Streams each file over ssh into /etc/omniswarm/<name> as root:root 0600 (written to a
#    temp name, then renamed; nothing lands in the ssh user's home), then compares the
#    host's sha256 with the local one.
#    Files: stack.env worker.env providers.env [ops.env omniswarm.config.json]
# 3. Lists the names of any provider-key variable inside a running api
#    container (there must be none).
# The ssh user needs passwordless sudo (provision.sh --deploy-user). Afterwards redeploy
# (deploy.sh) or restart the workers so the new values are read.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FILES=(stack.env worker.env providers.env ops.env omniswarm.config.json)

dry=0; host=""; from="${HOME}/.omniswarm/env"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1; shift ;;
    --from) from="${2:?--from needs a directory}"; shift 2 ;;
    -h | --help) sed -n '2,17p' "$0"; exit 0 ;;
    -*) echo "secrets.sh: unknown option $1" >&2; exit 64 ;;
    *) host="$1"; shift ;;
  esac
done
[ -n "$host" ] || { echo "usage: secrets.sh [--dry-run] <ssh-host> [--from DIR]" >&2; exit 64; }
[ -d "$from" ] || { echo "secrets.sh: $from is not a directory" >&2; exit 66; }

node "$HERE/secrets-check.mjs" "$from" || { echo "secrets.sh: fix the errors above; nothing was copied" >&2; exit 1; }

# remote <command> [stdin file]: every word in <command> is fixed or a name from FILES.
remote() {
  if [ "$dry" = 1 ]; then printf '+ ssh -o BatchMode=yes %s%s <<remote\n%s\nremote\n' "$host" "${2:+ < $2}" "$1"; return 0; fi
  if [ -n "${2:-}" ]; then ssh -o BatchMode=yes "$host" "$1" < "$2"; else ssh -o BatchMode=yes "$host" "$1"; fi
}

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

remote "sudo install -d -m 0700 -o root -g root /etc/omniswarm"
for name in "${FILES[@]}"; do
  file="$from/$name"
  [ -f "$file" ] || continue
  remote "sudo sh -c 'umask 077 && cat > /etc/omniswarm/.$name.new && chown root:root /etc/omniswarm/.$name.new && chmod 0600 /etc/omniswarm/.$name.new && mv -f /etc/omniswarm/.$name.new /etc/omniswarm/$name'" "$file"
  want="$(sha "$file")"
  if [ "$dry" = 1 ]; then echo "  would install /etc/omniswarm/$name (sha256:${want:0:12})"; continue; fi
  got="$(remote "sudo sha256sum /etc/omniswarm/$name" | cut -d' ' -f1)"
  [ "$got" = "$want" ] || { echo "secrets.sh: /etc/omniswarm/$name on $host does not match the local file" >&2; exit 1; }
  echo "  installed /etc/omniswarm/$name (root:root 0600, sha256:${want:0:12})"
done

leaks="$(remote "sudo docker ps -q --filter label=com.docker.compose.service=api | xargs -r sudo docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' | cut -d= -f1 | grep -E '_API_KEY\$|^OPENROUTER|^ZAI_' | sort -u || true")"
if [ "$dry" = 1 ]; then printf '%s\n' "$leaks"; echo "dry run: nothing was copied"; exit 0; fi
[ -z "$leaks" ] || { echo "secrets.sh: the api container holds worker-only variables: $leaks" >&2; exit 1; }
echo "secrets installed on $host; api containers hold no provider key. Redeploy or restart omniswarm-workers.target to apply."
