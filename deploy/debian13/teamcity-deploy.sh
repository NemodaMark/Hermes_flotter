#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID == 0 && $# == 1 && $1 =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected one Git commit SHA.' >&2; exit 1; }
revision=$1
export HERMES_CONFIG_FILE=/etc/hermes/staging.env
[[ -f $HERMES_CONFIG_FILE && ! -L $HERMES_CONFIG_FILE && $(stat -c '%u:%a' "$HERMES_CONFIG_FILE") == 0:600 ]]
# shellcheck disable=SC1090
source "$HERMES_CONFIG_FILE"
[[ -f $HERMES_DATA_DIR/release/source.tar && ! -e $HERMES_DATA_DIR/deploying ]]
[[ $(git -C "$HERMES_ROOT" remote get-url origin) == https://github.com/NemodaMark/Hermes_flotter.git ]]
exec 9>"$HERMES_DATA_DIR/operations.lock"
flock -w 120 9
# Reload after acquiring the lock; another queued release may have just been deployed.
# shellcheck disable=SC1090
source "$HERMES_CONFIG_FILE"
[[ ! -e $HERMES_DATA_DIR/deploying ]]
git -C "$HERMES_ROOT" diff --quiet HEAD
[[ -z $(git -C "$HERMES_ROOT" ls-files --others --exclude-standard) ]]
git -C "$HERMES_ROOT" fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
[[ $(git -C "$HERMES_ROOT" rev-parse refs/remotes/origin/main) == "$revision" ]] || {
    echo 'A newer commit is available on main. Deploy its validated build instead.' >&2
    exit 1
}
git -C "$HERMES_ROOT" merge-base --is-ancestor "$HERMES_RELEASE" "$revision"
if [[ $HERMES_RELEASE != "$revision" ]]; then
    git -C "$HERMES_ROOT" checkout --detach "$revision"
    bash "$HERMES_ROOT/deploy/debian13/hermes.sh" deploy
fi
curl --fail --silent --show-error --retry 5 --retry-all-errors --max-time 10 "https://$HERMES_DOMAIN/health/ready" >/dev/null
curl --fail --silent --show-error --max-time 10 "https://$HERMES_DOMAIN/health/version" |
    python3 -c 'import json,sys; assert json.load(sys.stdin)["commit"] == sys.argv[1]' "$revision"
echo "HERMES $revision passed the HTTPS readiness and revision checks."
