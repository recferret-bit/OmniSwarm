#!/bin/bash
# Runs INSIDE the hosts check container (infra/check/hosts.sh), as root, with the
# repository mounted read-only at /repo. Drives the real provision.sh three times
# (--no-packages: apt needs the network) and judges the result with the tools'
# own validators. systemctl and swapoff are stubs that record their calls: there
# is no init system in the container.
set -euo pipefail
PROVISION=/repo/infra/deploy/provision.sh
fail() { echo "FAIL hosts: $*" >&2; exit 1; }

stubs="$(mktemp -d)"
calls="$stubs/calls"
: > "$calls"
cat > "$stubs/systemctl" <<'EOF'
#!/bin/sh
dir="$(dirname "$0")"
echo "systemctl $*" >> "$dir/calls"
case "$1" in
  is-enabled) shift; [ "$1" = --quiet ] && shift; grep -qxF "$1" "$dir/enabled" 2>/dev/null ;;
  enable) shift; [ "$1" = --now ] && shift; echo "$1" >> "$dir/enabled" ;;
esac
EOF
# shellcheck disable=SC2016 # the stub's own $* and $0
printf '#!/bin/sh\necho "swapoff $*" >> "$(dirname "$0")/calls"\n' > "$stubs/swapoff"
printf '#!/bin/sh\nexit 0\n' > "$stubs/swapon"
chmod +x "$stubs"/*
export PATH="$stubs:$PATH"

echo '/swapfile none swap sw 0 0' >> /etc/fstab
ssh-keygen -q -t ed25519 -N '' -C check@omniswarm -f "$stubs/deploy" >/dev/null

# 1. No account has a key yet: sshd must be left alone (lockout guard).
out="$(bash "$PROVISION" --no-packages 2>&1)" || { echo "$out"; fail "first run failed"; }
[ ! -e /etc/ssh/sshd_config.d/10-omniswarm.conf ] || fail "sshd was hardened while no account had a key"
printf '%s' "$out" | grep -q 'would lock you out' || fail "no lockout warning without a key"

# 2. With the deploy key: everything is applied.
out="$(bash "$PROVISION" --no-packages --deploy-key "$stubs/deploy.pub" 2>&1)" || { echo "$out"; fail "second run failed"; }
printf '%s' "$out" | grep -q 'provision: 0 change' && fail "second run with a key changed nothing"

# 3. Idempotent: nothing left to change, nothing restarted.
: > "$calls"
out="$(bash "$PROVISION" --no-packages --deploy-key "$stubs/deploy.pub" 2>&1)" || { echo "$out"; fail "third run failed"; }
printf '%s\n' "$out" | grep -qx 'provision: 0 change(s)' || { echo "$out"; fail "a repeated run changed something"; }
grep -E 'systemctl (restart|reload|try-reload)|swapoff' "$calls" && fail "a repeated run restarted a service"

state() { stat -c '%a %U:%G' "$1"; }
[ "$(state /etc/omniswarm)" = "700 root:root" ] || fail "/etc/omniswarm is $(state /etc/omniswarm)"
[ "$(state /srv/omniswarm/reports)" = "755 omniswarm:omniswarm" ] || fail "reports dir is $(state /srv/omniswarm/reports)"
[ "$(state /srv/omniswarm/backup)" = "700 root:root" ] || fail "backup dir is $(state /srv/omniswarm/backup)"
[ "$(state /etc/sudoers.d/omniswarm-deploy)" = "440 root:root" ] || fail "sudoers drop-in is $(state /etc/sudoers.d/omniswarm-deploy)"
id -nG omniswarm | tr ' ' '\n' | grep -qx docker || fail "omniswarm is not in group docker"
[ "$(getent passwd omniswarm | cut -d: -f7)" = /usr/sbin/nologin ] || fail "omniswarm has a login shell"
grep -qxF "$(cat "$stubs/deploy.pub")" /home/deploy/.ssh/authorized_keys || fail "deploy key not installed"
[ "$(state /home/deploy/.ssh/authorized_keys)" = "600 deploy:deploy" ] || fail "authorized_keys is $(state /home/deploy/.ssh/authorized_keys)"
grep -Eq '^/swapfile' /etc/fstab && fail "swap entry still active in /etc/fstab"

visudo -cq || fail "visudo rejects /etc/sudoers.d"
sshd -t || fail "sshd -t rejects the hardened config"
effective="$(sshd -T -C user=deploy,host=check,addr=192.0.2.1)"
for want in 'passwordauthentication no' 'kbdinteractiveauthentication no' 'permitrootlogin without-password' 'authenticationmethods publickey' 'allowtcpforwarding no'; do
  printf '%s\n' "$effective" | grep -qx "$want" || fail "sshd effective config lacks '$want'"
done
nft -c -f /etc/nftables.d/omniswarm.nft || fail "nft rejects the installed ruleset"
for _ in 1 2; do nft -f /etc/nftables.d/omniswarm.nft || fail "ruleset does not reload over itself"; done
rules="$(nft list table inet omniswarm)"
for want in 'policy drop' 'tcp dport { 22, 80, 443 } accept' 'limit rate over 6/minute' 'tcp dport != { 22, 80, 443 } drop'; do
  printf '%s' "$rules" | grep -qF "$want" || fail "loaded firewall lacks '$want'"
done
fail2ban-client -t >/dev/null 2>&1 || fail "fail2ban-client -t rejects the jail"
python3 - /etc/docker/daemon.json <<'EOF' || fail "daemon.json lacks a required setting"
import json, sys
d = json.load(open(sys.argv[1]))
assert d["no-new-privileges"] is True and d["live-restore"] is True and d["icc"] is False
assert d["log-driver"] == "json-file" and d["log-opts"]["max-size"] and d["log-opts"]["max-file"]
assert "hosts" not in d, "the Docker API must never listen on TCP"
EOF
echo "provision: idempotent (3rd run 0 changes), lockout guard, sshd -T, nft load x2, fail2ban -t, visudo, modes"
