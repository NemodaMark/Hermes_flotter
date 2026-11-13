#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID == 0 && $# == 4 ]] || {
    echo 'Usage (as root): install-hermes.sh DOMAIN ACME_EMAIL RESTIC_REPOSITORY TEAMCITY_PUBLIC_KEY_FILE' >&2
    exit 1
}
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
config=/etc/hermes/staging.env
[[ ! -e $config && ! -e /var/lib/hermes && ! -e /etc/hermes/restic-password ]] || {
    echo 'HERMES is already initialized. Run releases through TeamCity.' >&2
    exit 1
}
[[ $(stat -c '%u:%a' "$root") == 0:755 || $(stat -c '%u:%a' "$root") == 0:700 ]] || {
    echo 'Use a root-owned checkout with permissions 0755 or 0700.' >&2
    exit 1
}
git -C "$root" diff --quiet HEAD
[[ -z $(git -C "$root" ls-files --others --exclude-standard) && -f $4 ]]
IFS=' ' read -r key_type public_key _ < "$4"
[[ $key_type == ssh-ed25519 && $public_key =~ ^[A-Za-z0-9+/=]+$ ]]
bash "$root/deploy/debian13/install-debian13.sh"
apt-get install -y openssh-server sudo
systemctl enable --now ssh
HERMES_CONFIG_FILE=$config bash "$root/deploy/debian13/hermes.sh" init "$1" "$2" "$3"
HERMES_CONFIG_FILE=$config bash "$root/deploy/debian13/hermes.sh" init-repository
HERMES_CONFIG_FILE=$config bash "$root/deploy/debian13/hermes.sh" deploy
curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 --max-time 10 "https://$1/health/ready" >/dev/null
HERMES_CONFIG_FILE=$config bash "$root/deploy/debian13/hermes.sh" backup
HERMES_CONFIG_FILE=$config bash "$root/deploy/debian13/hermes.sh" restore-drill latest
HERMES_CONFIG_FILE=$config bash "$root/deploy/debian13/hermes.sh" install-systemd
bash "$root/deploy/debian13/install-teamcity-access.sh" "$4"
echo 'HERMES installed. Activate the TeamCity build configuration for subsequent releases.'
