#!/bin/bash
# Host provisioning for a fresh Debian 12/13 or Ubuntu 22.04/24.04 VM (W12-06, W12-09).
# Idempotent: every step compares before it acts, and a second run reports 0 changes.
#
#   provision.sh [--dry-run] [--deploy-user NAME] [--deploy-key FILE] [--no-packages]
#       on the host, as root, from any copy of infra/
#   provision.sh --remote <ssh-host> [--dry-run] [--deploy-user NAME] [--deploy-key FILE]
#       from the owner's machine: ships infra/ as committed at HEAD and runs the above with sudo
#
# Steps: Docker Engine + compose plugin and Node 24 from their signed apt repositories
# (key fingerprints pinned below), rsync/git/nftables/fail2ban/unattended-upgrades; users
# `omniswarm` (service user, group docker) and the deploy user (ssh key, passwordless sudo);
# /srv/omniswarm/* and /etc/omniswarm (root 0700); swap off; Docker daemon.json; journald
# limits; unattended security upgrades; the nftables firewall (22 rate-limited, 80, 443);
# sshd key-only (skipped while no account has an authorized key, so it cannot lock you out);
# fail2ban on sshd. --no-packages skips the apt steps (the gate uses it).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/deploy/lib.sh
. "$HERE/lib.sh"
# shellcheck source=infra/deploy/provision-lib.sh
. "$HERE/provision-lib.sh"
HOSTS="$OMNI_INFRA/hosts"

DOCKER_KEY_FPR=9DC858229FC7DD38854AE2D88D81803C0EBFCD88    # Docker Release (CE deb)
NODESOURCE_KEY_FPR=6F71F525282841EEDAF851B42F59B5F99B1BE0B4 # NodeSource (NSolid)
NODE_MAJOR=24
BASE_PACKAGES=(ca-certificates curl gnupg rsync git openssl nftables fail2ban python3-systemd unattended-upgrades apt-listchanges)
DOCKER_PACKAGES=(docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin)

remote=""; deploy_user=deploy; deploy_key=""; packages=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) OMNI_DRY_RUN=1; shift ;;
    --remote) remote="${2:?--remote needs an ssh host}"; shift 2 ;;
    --deploy-user) deploy_user="${2:-}"; shift 2 ;;
    --deploy-key) deploy_key="${2:-}"; shift 2 ;;
    --no-packages) packages=0; shift ;;
    -h | --help) sed -n '2,16p' "$0"; exit 0 ;;
    *) omni_die "unknown argument $1" ;;
  esac
done
[[ "$deploy_user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || omni_die "bad --deploy-user '$deploy_user'"
if [ -n "$deploy_key" ]; then
  [ -r "$deploy_key" ] || omni_die "cannot read --deploy-key $deploy_key"
  grep -Eq '^(ssh-ed25519|sk-ssh-ed25519@openssh\.com|ecdsa-sha2-nistp(256|384|521)|ssh-rsa) [A-Za-z0-9+/=]+( .*)?$' "$deploy_key" \
    || omni_die "$deploy_key is not an OpenSSH public key"
fi

# --remote: copy infra/ (HEAD) and the public key to ~/omniswarm-provision, run it with sudo.
if [ -n "$remote" ]; then
  root="$(cd "$OMNI_INFRA/.." && pwd)"
  # shellcheck disable=SC2016 # expanded by the remote shell
  stage='$HOME/omniswarm-provision'
  args="--deploy-user $deploy_user"
  [ "$OMNI_DRY_RUN" = 1 ] && args="$args --dry-run"
  [ -n "$deploy_key" ] && args="$args --deploy-key $stage/deploy.pub"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  omni_run git -C "$root" archive --format=tar -o "$tmp/infra.tar" HEAD infra
  [ -n "$deploy_key" ] && omni_run cp "$deploy_key" "$tmp/deploy.pub"
  # Every word in the remote command is fixed, the validated user name or $stage.
  # shellcheck disable=SC2029 # expanded locally on purpose
  remote_sh() {
    if [ "$OMNI_DRY_RUN" = 1 ]; then printf '+ ssh %s <<remote\n%s\nremote\n' "$remote" "$1"; else ssh "$remote" "$1"; fi
  }
  remote_sh "set -eu; rm -rf $stage; mkdir -m 0700 $stage"
  omni_run scp -q "$tmp/infra.tar" ${deploy_key:+"$tmp/deploy.pub"} "$remote:omniswarm-provision/"
  remote_sh "set -eu; tar -xf $stage/infra.tar -C $stage; sudo bash $stage/infra/deploy/provision.sh $args; rm -rf $stage"
  exit 0
fi

[ "$OMNI_DRY_RUN" = 1 ] || [ "$(id -u)" = 0 ] || omni_die "run as root (or use --remote <ssh-host>)"
[ "$OMNI_DRY_RUN" = 1 ] || [ -f /etc/debian_version ] || omni_die "Debian or Ubuntu only"
PROV_TMP="$(mktemp -d)"; trap 'rm -rf "$PROV_TMP"' EXIT

# --- packages ----------------------------------------------------------------
install_packages() {
  local id codename arch missing
  id="$(os_field ID)"; codename="$(os_field VERSION_CODENAME)"; arch="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
  case "$id/$codename" in
    debian/bookworm | debian/trixie | ubuntu/jammy | ubuntu/noble) ;;
    *)
      # A dry run on a laptop plans for Debian trixie.
      if [ "$OMNI_DRY_RUN" = 1 ]; then id=debian; codename=trixie; else omni_die "unsupported distribution $id/$codename"; fi ;;
  esac
  missing="$(missing_packages "${BASE_PACKAGES[@]}")"
  # shellcheck disable=SC2086 # word list on purpose
  [ -z "$missing" ] || { omni_run apt-get update -q; apt_install $missing; }
  apt_repo docker "https://download.docker.com/linux/$id/gpg" "$DOCKER_KEY_FPR" \
    "deb [arch=$arch signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$id $codename stable"
  apt_repo nodesource https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key "$NODESOURCE_KEY_FPR" \
    "deb [arch=$arch signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main"
  missing="$(missing_packages "${DOCKER_PACKAGES[@]}" nodejs)"
  if [ -n "$missing" ]; then
    omni_run apt-get update -q
    # shellcheck disable=SC2086
    apt_install $missing
  fi
  [ "$OMNI_DRY_RUN" = 1 ] || node --version | grep -q "^v$NODE_MAJOR\." || omni_die "node is $(node --version), want v$NODE_MAJOR (another nodejs package pinned?)"
}

# --- users and directories ----------------------------------------------------
setup_users() {
  ensure_group docker
  ensure_user omniswarm --system --user-group --home-dir /srv/omniswarm --no-create-home --shell /usr/sbin/nologin
  ensure_member omniswarm docker
  ensure_user "$deploy_user" --create-home --user-group --shell /bin/bash
  printf '# /etc/sudoers.d/omniswarm-deploy (infra/deploy/provision.sh)\n# deploy.sh unpacks a release and runs its release.sh as root, so this user is\n# root-equivalent by design. Protect its ssh key like a root key.\n%s ALL=(root) NOPASSWD: ALL\n' \
    "$deploy_user" > "$PROV_TMP/sudoers"
  [ "$OMNI_DRY_RUN" = 1 ] || visudo -cqf "$PROV_TMP/sudoers" || omni_die "generated sudoers file does not parse"
  put_file "$PROV_TMP/sudoers" /etc/sudoers.d/omniswarm-deploy 0440 || true
  [ -z "$deploy_key" ] || ensure_authorized_key "$deploy_user" "$deploy_key"
}

setup_dirs() {
  ensure_dir /srv/omniswarm 0755 root:root
  ensure_dir /srv/omniswarm/releases 0755 root:root
  # Reports stay world-readable: nginx (uid 101 in its container) serves them.
  ensure_dir /srv/omniswarm/reports 0755 omniswarm:omniswarm
  ensure_dir /srv/omniswarm/work 0750 omniswarm:omniswarm
  ensure_dir /srv/omniswarm/backup 0700 root:root
  ensure_dir /srv/omniswarm/acme 0755 root:root
  ensure_dir /srv/omniswarm/nginx 0755 root:root
  ensure_dir /etc/omniswarm 0700 root:root
}

# The engine gives each sandbox `--memory` without `--memory-swap`. With swap on, a
# container may use as much swap again; with it off, --memory is the real ceiling.
swap_off() {
  if [ -n "$(swapon --show --noheadings 2>/dev/null || true)" ]; then omni_run swapoff -a; changed "swap turned off"; fi
  if grep -Eq '^[^#]\S*\s+\S+\s+swap\s' /etc/fstab 2>/dev/null; then
    omni_run sed -i -E 's|^([^#]\S*\s+\S+\s+swap\s.*)$|# omniswarm provision.sh: swap off # \1|' /etc/fstab
    changed "/etc/fstab swap entries commented out"
  fi
}

# --- configuration -----------------------------------------------------------
setup_config() {
  # live-restore keeps running containers across this restart once it is on.
  if put_file "$HOSTS/daemon.json" /etc/docker/daemon.json 0644; then omni_run systemctl restart docker.service; fi
  if put_file "$HOSTS/journald.conf" /etc/systemd/journald.conf.d/omniswarm.conf 0644; then omni_run systemctl restart systemd-journald.service; fi
  put_file "$HOSTS/auto-upgrades.conf" /etc/apt/apt.conf.d/20auto-upgrades 0644 || true
  put_file "$HOSTS/unattended-upgrades.conf" /etc/apt/apt.conf.d/52omniswarm-unattended-upgrades 0644 || true
  ensure_enabled unattended-upgrades.service
}

setup_firewall() {
  [ "$OMNI_DRY_RUN" = 1 ] || nft -c -f "$HOSTS/omniswarm.nft" || omni_die "nft rejects $HOSTS/omniswarm.nft"
  local reload=0
  put_file "$HOSTS/omniswarm.nft" /etc/nftables.d/omniswarm.nft 0644 && reload=1
  put_file "$HOSTS/omniswarm-firewall.service" /etc/systemd/system/omniswarm-firewall.service 0644 && { omni_run systemctl daemon-reload; reload=1; }
  ensure_enabled omniswarm-firewall.service
  [ "$reload" = 0 ] || omni_run systemctl restart omniswarm-firewall.service
  # ufw would add a second default-deny ruleset that knows nothing of this one.
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    omni_run ufw --force disable; changed "ufw disabled (replaced by table inet omniswarm)"
  fi
}

setup_ssh() {
  if [ -z "$deploy_key" ] && ! any_authorized_key "$deploy_user"; then
    omni_log "warning: no account has an ssh authorized key; sshd stays as it is (would lock you out). Re-run with --deploy-key."
    return 0
  fi
  if put_file "$HOSTS/sshd.conf" /etc/ssh/sshd_config.d/10-omniswarm.conf 0644; then
    [ "$OMNI_DRY_RUN" = 1 ] || sshd -t || omni_die "sshd -t rejects the new configuration"
    omni_run systemctl try-reload-or-restart ssh.service
  fi
  if put_file "$HOSTS/fail2ban.local" /etc/fail2ban/jail.d/omniswarm.local 0644; then omni_run systemctl restart fail2ban.service; fi
  ensure_enabled fail2ban.service
}

[ "$packages" = 1 ] && install_packages
setup_users
setup_dirs
swap_off
setup_config
setup_firewall
setup_ssh
omni_log "provision: $CHANGES change(s)$( [ "$OMNI_DRY_RUN" = 1 ] && echo ' planned (dry run)')"
echo "provision: $CHANGES change(s)"
