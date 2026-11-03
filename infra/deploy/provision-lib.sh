# shellcheck shell=bash
# Idempotent building blocks for infra/deploy/provision.sh. Source it after lib.sh.
# Each ensure_*/put_file compares the current state first and acts (through omni_run,
# so --dry-run prints instead) only when it differs; every action bumps CHANGES.
# Needs PROV_TMP (scratch dir) for apt_repo.

CHANGES=0
changed() { CHANGES=$((CHANGES + 1)); omni_log "changed: $*"; }

# "<octal mode> <user>:<group>" of a path, empty when it does not exist.
path_state() { stat -c '%a %U:%G' "$1" 2>/dev/null || true; }

# put_file <src> <dest> <mode> [user:group]: install when content, mode or owner differ.
# Returns 0 when it changed the file (callers reload the service), 1 when it was current.
put_file() {
  local src="$1" dest="$2" mode="$3" owner="${4:-root:root}"
  if [ -f "$dest" ] && cmp -s "$src" "$dest" && [ "$(path_state "$dest")" = "${mode#0} $owner" ]; then return 1; fi
  omni_run install -D -m "$mode" -o "${owner%%:*}" -g "${owner#*:}" "$src" "$dest"
  changed "$dest"
}

ensure_dir() {
  local dir="$1" mode="$2" owner="$3"
  if [ -d "$dir" ] && [ "$(path_state "$dir")" = "${mode#0} $owner" ]; then return 0; fi
  omni_run install -d -m "$mode" -o "${owner%%:*}" -g "${owner#*:}" "$dir"
  changed "$dir ($mode $owner)"
}

ensure_group() {
  getent group "$1" >/dev/null 2>&1 && return 0
  omni_run groupadd --system "$1"
  changed "group $1"
}

# ensure_user <name> <useradd options...>
ensure_user() {
  local name="$1"; shift
  getent passwd "$name" >/dev/null 2>&1 && return 0
  omni_run useradd "$@" "$name"
  changed "user $name"
}

ensure_member() {
  id -nG "$1" 2>/dev/null | tr ' ' '\n' | grep -qxF "$2" && return 0
  omni_run usermod -aG "$2" "$1"
  changed "$1 joins group $2"
}

home_of() { getent passwd "$1" 2>/dev/null | cut -d: -f6 || true; }

ensure_authorized_key() {
  local user="$1" key home file
  key="$(head -n 1 "$2")"
  home="$(home_of "$user")"; home="${home:-/home/$user}"
  file="$home/.ssh/authorized_keys"
  ensure_dir "$home/.ssh" 0700 "$user:$user"
  if [ -f "$file" ] && grep -qxF -- "$key" "$file"; then return 0; fi
  if [ "$OMNI_DRY_RUN" = 1 ]; then
    printf '+ append %s to %s (0600 %s)\n' "${key%% *}" "$file" "$user"
  else
    printf '%s\n' "$key" >> "$file"
    chown "$user:$user" "$file"
    chmod 0600 "$file"
  fi
  changed "authorized key for $user"
}

# True when root, the deploy user or the sudo caller has an authorized key.
any_authorized_key() {
  local user home
  for user in root "$1" ${SUDO_USER:+"$SUDO_USER"}; do
    home="$(home_of "$user")"
    [ -n "$home" ] && [ -s "$home/.ssh/authorized_keys" ] && return 0
  done
  return 1
}

ensure_enabled() {
  systemctl is-enabled --quiet "$1" 2>/dev/null && return 0
  omni_run systemctl enable --now "$1"
  changed "$1 enabled"
}

os_field() { [ -r /etc/os-release ] && sed -n "s/^$1=//p" /etc/os-release | tr -d '"' || true; }

missing_packages() {
  local p
  for p in "$@"; do
    dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' || printf '%s ' "$p"
  done
}

apt_install() {
  omni_run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends "$@"
  changed "installed $*"
}

# Primary-key fingerprint of an armored or binary OpenPGP key file.
key_fingerprint() { gpg --show-keys --with-colons "$1" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }'; }

# apt_repo <name> <key url> <fingerprint> <deb line>: a signed-by keyring whose
# fingerprint must match the pinned one, and its sources list.
apt_repo() {
  local name="$1" url="$2" fpr="$3" line="$4" keyring="/etc/apt/keyrings/$1.gpg" got
  if [ -s "$keyring" ]; then
    got="$(key_fingerprint "$keyring")"
    [ "$got" = "$fpr" ] || omni_die "$keyring has fingerprint '$got', want $fpr; remove it and re-run"
  elif [ "$OMNI_DRY_RUN" = 1 ]; then
    printf '+ curl -fsSL %q | gpg --show-keys (must be %s) | gpg --dearmor > %q\n' "$url" "$fpr" "$keyring"
    changed "$keyring"
  else
    curl -fsSL --proto '=https' --tlsv1.2 "$url" -o "$PROV_TMP/$name.asc"
    got="$(key_fingerprint "$PROV_TMP/$name.asc")"
    [ "$got" = "$fpr" ] || omni_die "$url has fingerprint '$got', want $fpr"
    install -d -m 0755 /etc/apt/keyrings
    gpg --dearmor < "$PROV_TMP/$name.asc" > "$keyring.part"
    chmod 0644 "$keyring.part"
    mv -f "$keyring.part" "$keyring"
    changed "$keyring"
  fi
  printf '%s\n' "$line" > "$PROV_TMP/$name.list"
  put_file "$PROV_TMP/$name.list" "/etc/apt/sources.list.d/$name.list" 0644 || true
}
