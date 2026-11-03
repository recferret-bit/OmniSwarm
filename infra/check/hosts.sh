#!/bin/bash
# Host provisioning checks (W12-06, W12-09): the provision.sh dry-run plan for a
# fresh host, then the real provision.sh run three times in a Debian trixie
# container (infra/check/hosts-provision.test.sh) and validated by sshd, nft,
# fail2ban and visudo themselves. Nothing here contacts a host.
set -euo pipefail
# shellcheck source=infra/check/lib.sh
. "$(dirname "$0")/lib.sh"
: "${CHECK_TMP:?run through infra/check.sh}"

key="$CHECK_TMP/deploy.pub"
printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOmniswarmCheckKeyOnlyForTheDryRunPlan0000 check\n' > "$key"
bash "$INFRA/deploy/provision.sh" --dry-run --deploy-key "$key" > "$CHECK_TMP/provision-plan.txt" 2>&1 \
  || { cat "$CHECK_TMP/provision-plan.txt"; check_fail "provision.sh --dry-run"; }
plan="$CHECK_TMP/provision-plan.txt"
for step in 'must be 9DC858229FC7DD38854AE2D88D81803C0EBFCD88' 'must be 6F71F525282841EEDAF851B42F59B5F99B1BE0B4' \
  'docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin nodejs' \
  'useradd --system --user-group --home-dir /srv/omniswarm' 'usermod -aG docker omniswarm' 'install -d -m 0700 -o root -g root /etc/omniswarm' \
  '/etc/docker/daemon.json' '/etc/nftables.d/omniswarm.nft' 'systemctl enable --now omniswarm-firewall.service' \
  '/etc/ssh/sshd_config.d/10-omniswarm.conf' '/etc/fail2ban/jail.d/omniswarm.local' '/etc/systemd/journald.conf.d/omniswarm.conf' \
  '/etc/apt/apt.conf.d/20auto-upgrades' 'append ssh-ed25519 to /home/deploy/.ssh/authorized_keys'; do
  grep -qF -- "$step" "$plan" || check_fail "provision.sh --dry-run plan lacks '$step'"
done
grep -qE '^\+ (curl[^|]*\| *(ba)?sh|sh -c .*curl)' "$plan" && check_fail "provision.sh pipes a download into a shell"
# Node must come from the major the apps are built and tested on (CI uses 24).
grep -qx 'NODE_MAJOR=24' "$INFRA/deploy/provision.sh" || check_fail "provision.sh does not pin Node 24"
remote="$(cd "$ROOT" && bash infra/deploy/provision.sh --dry-run --remote provision-host.invalid --deploy-key "$key" 2>&1)"
# shellcheck disable=SC2016 # literal $HOME, expanded on the remote host
for step in 'git -C' 'archive --format=tar' 'scp -q' 'ssh provision-host.invalid' 'sudo bash $HOME/omniswarm-provision/infra/deploy/provision.sh --deploy-user deploy --dry-run --deploy-key'; do
  printf '%s' "$remote" | grep -qF -- "$step" || check_fail "provision.sh --remote --dry-run lacks '$step'"
done
if bash "$INFRA/deploy/provision.sh" --dry-run --deploy-user 'x;rm' >/dev/null 2>&1; then check_fail "provision.sh accepted a bad --deploy-user"; fi
check_log "provision.sh dry runs (local and --remote) plan every step; key fingerprints pinned; no curl | sh"

if ! docker image inspect "$HOSTS_CHECK_IMAGE" >/dev/null 2>&1; then
  check_log "building $HOSTS_CHECK_IMAGE (first run only)"
  docker build -q -t "$HOSTS_CHECK_IMAGE" -f "$CHECK_DIR/hosts.Dockerfile" "$CHECK_DIR" >/dev/null
fi
# NET_ADMIN only for this container's own network namespace (nft -c / nft -f).
docker run --rm --network none --cap-add NET_ADMIN -v "$ROOT:/repo:ro" "$HOSTS_CHECK_IMAGE" \
  bash /repo/infra/check/hosts-provision.test.sh > "$CHECK_TMP/hosts.log" 2>&1 \
  || { cat "$CHECK_TMP/hosts.log"; check_fail "provision.sh in a Debian container"; }
check_log "$(tail -n 1 "$CHECK_TMP/hosts.log")"
