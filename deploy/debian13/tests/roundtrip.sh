#!/usr/bin/env bash
# CI only: run as root in Debian 13 with the host Docker socket and matching bind paths.
set -Eeuo pipefail
umask 077
[[ ${HERMES_SMOKE_ISOLATED:-} == true && -n ${HERMES_CI_TEMP:-} ]] || { echo 'Requires a dedicated CI temporary directory.' >&2; exit 1; }
root=$(git rev-parse --show-toplevel)
export HERMES_CONFIG_FILE="$HERMES_CI_TEMP/config/staging.env"
export HERMES_DATA_DIR="$HERMES_CI_TEMP/data"
export HERMES_WORK_DIR="$HERMES_CI_TEMP/work"
tool="$root/deploy/debian13/hermes.sh"
dc() { docker compose --project-name hermes-staging --env-file "$HERMES_CONFIG_FILE" -f "$root/deploy/debian13/compose.yaml" "$@"; }
cleanup() {
    dc down --remove-orphans >/dev/null 2>&1 || true
    if [[ -f $HERMES_CI_TEMP/recovered.env ]]; then HERMES_CONFIG_FILE="$HERMES_CI_TEMP/recovered.env" bash "$tool" stop >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

bash "$tool" init hermes.test ci@example.test "$HERMES_CI_TEMP/repository"
# ACME is tested with Caddy's internal CA: no public DNS or Let's Encrypt requests in CI.
sed '/email /a\    local_certs' "$root/deploy/debian13/Caddyfile" > "$HERMES_CI_TEMP/Caddyfile"
cat >> "$HERMES_CONFIG_FILE" <<EOF
HERMES_CADDYFILE=$HERMES_CI_TEMP/Caddyfile
HERMES_BIND_ADDRESS=127.0.0.1
HERMES_HTTP_PORT=18080
HERMES_HTTPS_PORT=18443
EOF
echo '127.0.0.1 hermes.test' >> /etc/hosts
bash "$tool" init-repository
bash "$tool" deploy
for ((attempt=0; attempt<60; attempt++)); do
    [[ ! -f $HERMES_DATA_DIR/caddy-data/caddy/pki/authorities/local/root.crt ]] || break
    sleep 2
done
export NODE_EXTRA_CA_CERTS="$HERMES_DATA_DIR/caddy-data/caddy/pki/authorities/local/root.crt"
export HERMES_BASE_URL=https://hermes.test:18443
curl --fail --retry 15 --retry-all-errors --retry-delay 2 --cacert "$NODE_EXTRA_CA_CERTS" "$HERMES_BASE_URL/health/ready"
node "$root/scripts/smoke-auth.mjs"
node "$root/deploy/debian13/tests/staging-roundtrip.mjs" seed "$HERMES_CI_TEMP/state.json"
bash "$tool" bootstrap-admin restore.owner
dc exec -T db psql -U postgres -d hermes -At < "$root/deploy/debian13/tests/fingerprint.sql" > "$HERMES_CI_TEMP/before.txt"
bash "$tool" backup
bash "$tool" snapshots
bash "$tool" restore-drill latest
dc exec -T db psql -U postgres -d hermes -At < "$root/deploy/debian13/tests/fingerprint.sql" > "$HERMES_CI_TEMP/after-drill.txt"
cmp "$HERMES_CI_TEMP/before.txt" "$HERMES_CI_TEMP/after-drill.txt"

# Reusing a nonempty destination must fail without touching live data.
if bash "$tool" recover latest "$root" "$HERMES_CI_TEMP/never-created" "$HERMES_CI_TEMP/never.env"; then exit 1; fi
[[ ! -e $HERMES_CI_TEMP/never-created && ! -e $HERMES_CI_TEMP/never.env ]]
bash "$tool" recover latest "$HERMES_CI_TEMP/recovered-source" "$HERMES_CI_TEMP/recovered-data" "$HERMES_CI_TEMP/recovered.env"
bash "$tool" stop
export HERMES_CONFIG_FILE="$HERMES_CI_TEMP/recovered.env"
root="$HERMES_CI_TEMP/recovered-source"
tool="$root/deploy/debian13/hermes.sh"
# The recovery uses the exact images in the backup, with no rebuild and no migration.
recovered_instance=$(sed -n 's/^HERMES_INSTANCE=//p' "$HERMES_CONFIG_FILE")
docker compose --project-name "$recovered_instance" --env-file "$HERMES_CONFIG_FILE" -f "$root/deploy/debian13/compose.yaml" exec -T db psql -U postgres -d hermes -At < "$root/deploy/debian13/tests/fingerprint.sql" > "$HERMES_CI_TEMP/after-recovery.txt"
cmp "$HERMES_CI_TEMP/before.txt" "$HERMES_CI_TEMP/after-recovery.txt"
bash "$tool" start
node "$root/deploy/debian13/tests/staging-roundtrip.mjs" verify "$HERMES_CI_TEMP/state.json"
bash "$tool" status
echo 'PASS: Debian 13 install, Production HTTPS, encrypted backup, isolated restore drill, full recovery, all-table fingerprints, binary document, sessions and tenant isolation.'
