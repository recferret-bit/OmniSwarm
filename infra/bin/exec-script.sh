#!/bin/sh
# exec-script.sh <package-dir> <script-name>
#
# Runs one package.json script the way `npm run <script>` would (cwd = the
# package dir, node_modules/.bin on PATH), but replaces itself with the
# command instead of supervising it. The node process then IS the container's
# or the systemd unit's main process, so SIGTERM reaches it directly and a
# graceful shutdown can finish. `npm run` exits on SIGTERM without waiting for
# its child (probed on node:24.22.2-trixie-slim), which kills in-flight work.
#
# Only a single simple command is accepted (no `&&`, `;`, pipes, redirects or
# substitutions): anything else could not be exec'd and would bring back a
# supervising shell.
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: exec-script.sh <package-dir> <script-name>" >&2
  exit 64
fi

pkg_dir=$(cd "$1" && pwd)
name=$2

cmd=$(node -e '
  const pkg = require(process.argv[1]);
  const cmd = pkg.scripts && pkg.scripts[process.argv[2]];
  if (typeof cmd !== "string" || cmd.trim() === "") process.exit(3);
  process.stdout.write(cmd);
' "$pkg_dir/package.json" "$name") || {
  echo "exec-script: no script \"$name\" in $pkg_dir/package.json" >&2
  exit 66
}

case "$cmd" in
  *'&'* | *';'* | *'|'* | *'<'* | *'>'* | *'`'* | *'$'* | *'"'* | *"'"* | *\\* | *"
"*)
    echo "exec-script: \"$name\" is not a single simple command: $cmd" >&2
    exit 65
    ;;
esac
case "${cmd%% *}" in
  *=*)
    echo "exec-script: \"$name\" starts with an env assignment; set it in the environment instead: $cmd" >&2
    exit 65
    ;;
esac

root=$pkg_dir
while [ "$root" != "/" ] && [ ! -f "$root/package-lock.json" ]; do
  root=$(dirname "$root")
done
PATH="$pkg_dir/node_modules/.bin:$root/node_modules/.bin:$PATH"
export PATH

cd "$pkg_dir"
set -f # no globbing: the validated command is split on spaces only
# shellcheck disable=SC2086 # word splitting of the validated simple command is the point
exec $cmd
