#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${SSH_ORIGINAL_COMMAND:-} =~ ^deploy\ ([0-9a-f]{40})$ ]] || { echo 'Expected deploy <commit>.' >&2; exit 1; }
exec sudo -n /usr/local/sbin/hermes-teamcity-deploy "${BASH_REMATCH[1]}"
