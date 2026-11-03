# Throwaway image for infra/check/hosts.sh: a Debian trixie userland with the
# tools provision.sh configures (sshd, nftables, fail2ban, sudo), so their own
# validators (sshd -t / -T, nft -c, fail2ban-client -t, visudo -c) judge the
# files provision.sh installs. Built and cached locally; never pushed.
FROM debian:trixie-20261027-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-server nftables fail2ban python3-systemd sudo \
 && rm -rf /var/lib/apt/lists/* \
 && ssh-keygen -A \
 && mkdir -p /run/sshd
