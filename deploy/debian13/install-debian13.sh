#!/usr/bin/env bash
set -Eeuo pipefail
[[ $# == 0 || ${1:-} == --no-start && $# == 1 ]] || { echo 'Usage: install-debian13.sh [--no-start]' >&2; exit 1; }
[[ $EUID == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
# shellcheck disable=SC1091
source /etc/os-release
[[ $ID == debian && $VERSION_ID == 13 ]] || { echo 'This installer targets Debian 13 (trixie).' >&2; exit 1; }
for package in docker.io docker-compose docker-doc docker-buildx podman-docker containerd runc; do
    if dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null | grep -qx installed; then
        echo "Resolve the conflicting package $package first; existing containers are not modified by this installer." >&2
        exit 1
    fi
done
apt-get update
apt-get install -y ca-certificates curl git openssl restic python3 util-linux
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error --location https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod 0644 /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: trixie
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
if [[ ${1:-} != --no-start ]]; then systemctl enable --now docker; fi
echo 'Docker Engine, Compose and restic installed. Next: hermes.sh init (see README).'
