# Throwaway image for `systemd-analyze verify` on machines without systemd
# (macOS) and with a predictable systemd version everywhere (CI). Built and
# cached locally by infra/check/systemd.sh; never pushed or deployed.
FROM debian:trixie-20261027-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd nftables \
 && rm -rf /var/lib/apt/lists/*
# The units' dependencies on the real host: a docker.service, the omniswarm
# user and group, the docker group.
RUN groupadd --system docker \
 && useradd --system --user-group --home-dir /srv/omniswarm --shell /usr/sbin/nologin omniswarm \
 && printf '[Unit]\nDescription=stand-in for docker.service\n[Service]\nType=oneshot\nExecStart=/bin/true\n' > /etc/systemd/system/docker.service
