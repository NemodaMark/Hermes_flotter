#!/usr/bin/env bash
set -Eeuo pipefail
[[ $# == 1 && $1 =~ ^[0-9a-f]{40}$ ]] || { echo 'Usage: release.sh <tested revision>' >&2; exit 1; }
revision=$1
[[ $(git rev-parse HEAD) == "$revision" ]] || { echo 'Checkout and tested revision differ.' >&2; exit 1; }
[[ ${HERMES_DEPLOY_HOST:-} =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]
[[ -f ${TEAMCITY_SSH_KNOWN_HOSTS:-} ]] || { echo 'Configure the verified server SSH host key.' >&2; exit 1; }
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$TEAMCITY_SSH_KNOWN_HOSTS" \
    "hermes-deploy@$HERMES_DEPLOY_HOST" "deploy $revision"
