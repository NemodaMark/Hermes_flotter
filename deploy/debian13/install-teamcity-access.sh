#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID == 0 && $# == 1 && -f $1 ]] || {
    echo 'Usage (as root): install-teamcity-access.sh TEAMCITY_PUBLIC_KEY_FILE' >&2
    exit 1
}
dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
IFS=' ' read -r type key _ < "$1"
[[ $type == ssh-ed25519 && $key =~ ^[A-Za-z0-9+/=]+$ ]]
ssh-keygen -l -f "$1" >/dev/null
if ! id hermes-deploy >/dev/null 2>&1; then
    useradd --system --no-create-home --home-dir /var/lib/hermes-deploy --shell /bin/bash hermes-deploy
fi
[[ $(getent passwd hermes-deploy | cut -d: -f6) == /var/lib/hermes-deploy ]]
install -m 0755 -o root -g root "$dir/teamcity-deploy.sh" /usr/local/sbin/hermes-teamcity-deploy
install -m 0755 -o root -g root "$dir/teamcity-ssh.sh" /usr/local/sbin/hermes-teamcity-ssh
install -d -m 0755 -o root -g root /var/lib/hermes-deploy /var/lib/hermes-deploy/.ssh
temporary=$(mktemp)
trap 'rm -f -- "$temporary"' EXIT
printf 'restrict,command="/usr/local/sbin/hermes-teamcity-ssh" %s %s\n' "$type" "$key" > "$temporary"
install -m 0644 -o root -g root "$temporary" /var/lib/hermes-deploy/.ssh/authorized_keys
printf '%s\n' 'hermes-deploy ALL=(root) NOPASSWD: /usr/local/sbin/hermes-teamcity-deploy *' > "$temporary"
visudo -cf "$temporary"
install -m 0440 -o root -g root "$temporary" /etc/sudoers.d/hermes-teamcity
