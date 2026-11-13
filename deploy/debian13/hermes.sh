#!/usr/bin/env bash
# Root-owned configuration is intentionally sourced. Never source an untrusted .env.
set -Eeuo pipefail
umask 077
export COMPOSE_DISABLE_ENV_FILE=1
HERMES_CONFIG_FILE=${HERMES_CONFIG_FILE:-/etc/hermes/staging.env}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
temporary_dir=
drill_project=
drill_config=
drill_root=

die() { echo "HERMES: $*" >&2; exit 1; }
log() { echo "HERMES: $*"; }
safe_path() {
    [[ $1 =~ ^/[a-zA-Z0-9_./-]+$ && $1 != / ]] || die "Use an absolute non-root path without spaces: $1"
    [[ $(realpath -m -- "$1") == "$1" ]] || die "Path must be canonical: $1"
}
dc() { docker compose --project-name "$HERMES_INSTANCE" --env-file "$HERMES_CONFIG_FILE" -f "$HERMES_ROOT/deploy/debian13/compose.yaml" "$@"; }
rc() (
    # Compose gives exported variables precedence over --env-file. Override the live
    # configuration in this subshell before starting any isolated drill container.
    set -a
    # shellcheck disable=SC1090
    source "$drill_config"
    set +a
    docker compose --project-name "$drill_project" --env-file "$drill_config" -f "$drill_root/deploy/debian13/compose.restore.yaml" "$@"
)
cleanup() {
    local result=$?
    trap - EXIT
    if [[ -n $drill_project ]]; then
        if ! rc down --volumes --remove-orphans >/dev/null 2>&1; then
            log "Restore drill cleanup failed; inspect project $drill_project and $temporary_dir."
            exit 1
        fi
    fi
    if [[ -n $temporary_dir && -d $temporary_dir ]]; then
        [[ $temporary_dir == "$HERMES_WORK_DIR"/operation.* ]] || die 'Unexpected temporary path; cleanup refused.'
        rm -rf -- "$temporary_dir"
    fi
    exit "$result"
}
trap cleanup EXIT

load_config() {
    [[ -f $HERMES_CONFIG_FILE && ! -L $HERMES_CONFIG_FILE ]] || die "Missing regular configuration file: $HERMES_CONFIG_FILE"
    local mode
    mode=$(stat -c '%a' "$HERMES_CONFIG_FILE")
    (( (8#$mode & 077) == 0 )) || die 'Configuration must not be readable by group/others (chmod 600).'
    [[ $(stat -c '%u' "$HERMES_CONFIG_FILE") == 0 ]] || die 'Configuration must be owned by root.'
    set -a
    # shellcheck disable=SC1090
    source "$HERMES_CONFIG_FILE"
    set +a
    for name in HERMES_ROOT HERMES_DATA_DIR HERMES_WORK_DIR RESTIC_PASSWORD_FILE; do
        [[ -n ${!name:-} ]] || die "Missing setting $name"
        safe_path "${!name}"
    done
    [[ $HERMES_INSTANCE =~ ^hermes-[a-z0-9-]+$ ]] || die 'Instance must start with hermes- and contain lowercase letters, digits and hyphens.'
    [[ $HERMES_DOMAIN =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ && $HERMES_DOMAIN == *.* ]] || die 'Supply a DNS hostname, without protocol, path or port.'
    python3 - "${HERMES_EDGE_SUBNET:-172.30.90.0/24}" "${HERMES_EDGE_DYNAMIC_RANGE:-172.30.90.128/25}" "${HERMES_PROXY_IP:-172.30.90.2}" <<'PY'
import ipaddress, sys
network, dynamic = map(ipaddress.ip_network, sys.argv[1:3])
proxy = ipaddress.ip_address(sys.argv[3])
if not dynamic.subnet_of(network) or proxy not in network or proxy in dynamic or proxy in (network.network_address, network.broadcast_address, network.network_address + 1):
    raise SystemExit('Proxy IP must be inside the edge subnet and outside its dynamic address pool/gateway.')
PY
    for name in POSTGRES_ADMIN_PASSWORD POSTGRES_MIGRATOR_PASSWORD POSTGRES_APP_PASSWORD; do
        [[ ${!name:-} =~ ^[a-zA-Z0-9]{32,128}$ ]] || die "$name must be 32–128 alphanumeric characters (init generates it)."
    done
    [[ -n ${RESTIC_REPOSITORY:-} && -f $RESTIC_PASSWORD_FILE ]] || die 'Configure the backup repository and password file.'
    mode=$(stat -c '%a' "$RESTIC_PASSWORD_FILE")
    (( (8#$mode & 077) == 0 )) || die 'Repository password file must not be readable by group/others.'
    install -d -m 0700 "$HERMES_DATA_DIR" "$HERMES_WORK_DIR"
}
lock() {
    # TeamCity holds the same lock across checkout, migration and the HTTPS check.
    if [[ ! /proc/$$/fd/9 -ef $HERMES_DATA_DIR/operations.lock ]]; then
        exec 9>"$HERMES_DATA_DIR/operations.lock"
    fi
    flock -w 5 9 || die 'Another deploy/backup/restore operation is running. Try again after it finishes.'
    load_config
}
workdir() { temporary_dir=$(mktemp -d "$HERMES_WORK_DIR/operation.XXXXXXXX"); }
write_setting() {
    # Values used by Compose and Bash deliberately exclude whitespace/expansion characters.
    python3 - "$HERMES_CONFIG_FILE" "$1" "$2" <<'PY'
import os, re, sys, tempfile
path, key, value = sys.argv[1:]
if not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or not re.fullmatch(r'[a-zA-Z0-9_./:@+-]+', value):
    raise SystemExit('Invalid setting')
lines = open(path).read().splitlines()
lines = [line for line in lines if not line.startswith(key + '=')]
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
with os.fdopen(fd, 'w') as out:
    out.write('\n'.join(lines + [key + '=' + value]) + '\n')
os.replace(tmp, path)
PY
    export "$1=$2"
}
wait_db() {
    local command=$1
    for ((attempt=0; attempt<90; attempt++)); do
        if "$command" exec -T db pg_isready -U postgres -d hermes >/dev/null 2>&1; then return; fi
        sleep 2
    done
    die 'Database did not become ready.'
}
restore_database() {
    local command=$1 dump=$2
    # This helper is called only for a fresh directory/project, never for the live database.
    # Expand the password inside the database container.
    # shellcheck disable=SC2016
    "$command" exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore -U postgres -d hermes --clean --if-exists --exit-on-error --single-transaction' < "$dump"
}
validate_database() {
    local command=$1
    "$command" exec -T db psql -U postgres -d hermes -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM public."__EFMigrationsHistory") THEN RAISE EXCEPTION 'Missing migration history'; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'hermes_app' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe application role'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hermes_app') THEN RAISE EXCEPTION 'Missing application role'; END IF;
  IF NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity AND c.relforcerowsecurity) THEN RAISE EXCEPTION 'Missing forced tenant RLS'; END IF;
  IF EXISTS (SELECT FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid JOIN pg_namespace n ON t.relnamespace=n.oid WHERE n.nspname='public' AND NOT c.convalidated) THEN RAISE EXCEPTION 'Unvalidated constraints'; END IF;
END $$;
SQL
}
init() {
    [[ $# == 3 ]] || die 'Usage: hermes.sh init DOMAIN ACME_EMAIL RESTIC_REPOSITORY'
    [[ ! -e $HERMES_CONFIG_FILE ]] || die 'Configuration already exists; nothing was overwritten.'
    safe_path "$HERMES_CONFIG_FILE"
    local root data work password_file
    root=$(cd "$script_dir/../.." && pwd)
    data=${HERMES_DATA_DIR:-/var/lib/hermes}
    work=${HERMES_WORK_DIR:-/var/cache/hermes}
    password_file="$(dirname "$HERMES_CONFIG_FILE")/restic-password"
    for path in "$root" "$data" "$work" "$password_file"; do safe_path "$path"; done
    [[ $1 =~ ^[a-z0-9][a-z0-9.-]+[a-z0-9]$ && $1 == *.* ]] || die 'Invalid DNS hostname.'
    [[ $2 =~ ^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+$ ]] || die 'Invalid ACME contact email.'
    [[ $3 =~ ^[a-zA-Z0-9_./:@+-]+$ ]] || die 'Repository must not contain whitespace or shell expansion characters.'
    [[ ! -e $data && ! -e $password_file ]] || die 'Data directory/password file already exists; init refused.'
    install -d -m 0700 "$(dirname "$HERMES_CONFIG_FILE")" "$data" "$work"
    openssl rand -hex 32 > "$password_file"
    cat > "$HERMES_CONFIG_FILE" <<EOF
HERMES_ROOT=$root
HERMES_DATA_DIR=$data
HERMES_WORK_DIR=$work
HERMES_INSTANCE=hermes-staging
HERMES_DOMAIN=$1
HERMES_ACME_EMAIL=$2
HERMES_RELEASE=initial
HERMES_API_IMAGE=hermes-api:initial
HERMES_FRONTEND_IMAGE=hermes-frontend:initial
HERMES_POSTGRES_IMAGE=postgres:18-alpine
HERMES_CADDY_IMAGE=caddy:2.11.7-alpine
HERMES_EDGE_SUBNET=172.30.90.0/24
HERMES_EDGE_DYNAMIC_RANGE=172.30.90.128/25
HERMES_PROXY_IP=172.30.90.2
POSTGRES_ADMIN_PASSWORD=$(openssl rand -hex 32)
POSTGRES_MIGRATOR_PASSWORD=$(openssl rand -hex 32)
POSTGRES_APP_PASSWORD=$(openssl rand -hex 32)
RESTIC_REPOSITORY=$3
RESTIC_PASSWORD_FILE=$password_file
EOF
    install -d -m 0700 -o 1654 -g 1654 "$data/keys"
    install -d -m 0700 "$data/caddy-data" "$data/caddy-config" "$data/release"
    log "Created $HERMES_CONFIG_FILE. Store a separate, secure copy of restic-password before using backups."
}
backup() {
    [[ -f $HERMES_DATA_DIR/release/source.tar && ! -e $HERMES_DATA_DIR/deploying ]] || die 'No complete deployed release, or a deployment needs recovery.'
    [[ -z $temporary_dir ]] && workdir
    local package="$temporary_dir/package"
    mkdir "$package"
    # Expand the password inside the database container.
    # shellcheck disable=SC2016
    dc exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U postgres -d hermes --format=custom' > "$package/database.dump"
    dc exec -T db pg_restore --list < "$package/database.dump" > /dev/null
    # Include binaries, not just moving image tags: recovery works without rebuilding old code.
    cp "$HERMES_CONFIG_FILE" "$package/deployment.env"
    local -a images=()
    local service image alias setting
    for service in api frontend db proxy; do
        image=$(docker inspect --format '{{.Image}}' "$(dc ps -q "$service")")
        alias="hermes-recovery-$service:${image#sha256:}"
        docker image tag "$image" "$alias"
        images+=("$alias")
        case $service in api) setting=HERMES_API_IMAGE ;; frontend) setting=HERMES_FRONTEND_IMAGE ;; db) setting=HERMES_POSTGRES_IMAGE ;; proxy) setting=HERMES_CADDY_IMAGE ;; esac
        sed -i "s|^$setting=.*|$setting=$alias|" "$package/deployment.env"
    done
    docker image save "${images[@]}" -o "$package/images.tar"
    tar -C "$HERMES_DATA_DIR" -cf "$package/keys-and-tls.tar" keys caddy-data caddy-config
    cp "$HERMES_DATA_DIR/release/source.tar" "$package/source.tar"
    docker cp "$(dc ps -q proxy):/etc/caddy/Caddyfile" "$package/Caddyfile"
    python3 - "$package/manifest.json" "$HERMES_RELEASE" <<'PY'
import datetime, json, sys
with open(sys.argv[1], 'w') as out:
    json.dump({'format': 1, 'release': sys.argv[2], 'postgresMajor': 18, 'createdUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()}, out)
PY
    (cd "$package" && sha256sum database.dump images.tar keys-and-tls.tar source.tar deployment.env Caddyfile manifest.json > SHA256SUMS)
    restic backup "$package" --tag hermes --host "$HERMES_INSTANCE" --json > "$temporary_dir/restic.json"
    python3 - "$temporary_dir/restic.json" "$HERMES_DATA_DIR/last-backup.json" <<'PY'
import json, sys
summary = [json.loads(line) for line in open(sys.argv[1]) if json.loads(line).get('message_type') == 'summary']
if len(summary) != 1 or not summary[0].get('snapshot_id'): raise SystemExit('No completed restic snapshot')
with open(sys.argv[2], 'w') as out: json.dump(summary[0], out)
print('HERMES: Backup snapshot ' + summary[0]['snapshot_id'])
PY
    restic forget --host "$HERMES_INSTANCE" --tag hermes --group-by host,tags --keep-last 3 --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune
}
extract_snapshot() {
    local snapshot=$1
    [[ $snapshot == latest || $snapshot =~ ^[a-f0-9]{8,64}$ ]] || die 'Use latest or a restic snapshot ID.'
    [[ -z $temporary_dir ]] && workdir
    restic restore "$snapshot" --host "$HERMES_INSTANCE" --tag hermes --target "$temporary_dir/restored" > /dev/null
    local -a manifests
    mapfile -t manifests < <(find "$temporary_dir/restored" -type f -name manifest.json)
    [[ ${#manifests[@]} == 1 ]] || die 'Snapshot must contain exactly one HERMES package.'
    package=$(dirname "${manifests[0]}")
    python3 - "$package" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
expected = {'database.dump','images.tar','keys-and-tls.tar','source.tar','deployment.env','Caddyfile','manifest.json'}
lines = (root/'SHA256SUMS').read_text().splitlines()
found = set()
for line in lines:
    digest, name = line.split('  ', 1)
    if name not in expected or name in found or (root/name).is_symlink(): raise SystemExit('Invalid checksum manifest')
    with (root/name).open('rb') as f: actual = hashlib.file_digest(f, 'sha256').hexdigest()
    if actual != digest: raise SystemExit('Backup checksum mismatch: ' + name)
    found.add(name)
if found != expected: raise SystemExit('Incomplete backup')
manifest = json.loads((root/'manifest.json').read_text())
if manifest.get('format') != 1 or manifest.get('postgresMajor') != 18: raise SystemExit('Unsupported backup format')
PY
}
restore_drill() {
    restic check --read-data
    extract_snapshot "${1:-latest}"
    local drill_data="$temporary_dir/data"
    mkdir -p "$drill_data"
    drill_root="$temporary_dir/source"
    mkdir "$drill_root"
    tar -C "$drill_root" -xf "$package/source.tar"
    tar -C "$drill_data" -xf "$package/keys-and-tls.tar" keys
    docker image load -i "$package/images.tar" > /dev/null
    drill_project="hermes-drill-$(openssl rand -hex 6)"
    drill_config="$temporary_dir/drill.env"
    cp "$package/deployment.env" "$drill_config"
    # Compose uses the restored passwords and images, with a fresh isolated data directory.
    sed -i "s|^HERMES_DATA_DIR=.*|HERMES_DATA_DIR=$drill_data|" "$drill_config"
    rc up -d db --wait --wait-timeout 180
    restore_database rc "$package/database.dump"
    validate_database rc
    rc up -d api --wait --wait-timeout 180
    rc --profile check run --rm --no-deps check
    date -u +%FT%TZ > "$HERMES_DATA_DIR/last-restore-drill.txt"
    log 'Restore drill passed: encrypted snapshot, checksums, PostgreSQL restore, roles/RLS/constraints and API readiness. Live services were not changed.'
}
deploy() {
    [[ ! -e $HERMES_DATA_DIR/deploying ]] || die 'Previous deployment is incomplete; follow the recovery procedure.'
    git -C "$HERMES_ROOT" diff --quiet || die 'Deploy a clean committed checkout.'
    git -C "$HERMES_ROOT" diff --cached --quiet || die 'Deploy a clean committed checkout.'
    [[ -z $(git -C "$HERMES_ROOT" ls-files --others --exclude-standard) ]] || die 'Commit untracked project files before deployment.'
    local release api_image frontend_image
    release=$(git -C "$HERMES_ROOT" rev-parse HEAD)
    api_image="hermes-api:$release"
    frontend_image="hermes-frontend:$release"
    workdir
    git -C "$HERMES_ROOT" archive --format=tar HEAD > "$temporary_dir/source.tar"
    HERMES_API_IMAGE=$api_image HERMES_FRONTEND_IMAGE=$frontend_image HERMES_RELEASE=$release dc build --pull api frontend
    # Finish the old release's backup before changing its image/configuration or database schema.
    if [[ -f $HERMES_DATA_DIR/release/source.tar ]]; then
        backup
        rm -rf -- "$temporary_dir/package"
    fi
    touch "$HERMES_DATA_DIR/deploying"
    write_setting HERMES_RELEASE "$release"
    write_setting HERMES_API_IMAGE "$api_image"
    write_setting HERMES_FRONTEND_IMAGE "$frontend_image"
    dc up -d db --wait --wait-timeout 180
    dc stop api
    dc --profile maintenance run --rm --no-deps migrate
    dc up -d --wait --wait-timeout 240 db api frontend proxy
    cp "$temporary_dir/source.tar" "$HERMES_DATA_DIR/release/source.tar"
    rm "$HERMES_DATA_DIR/deploying"
    log "Release $release is running. Check https://$HERMES_DOMAIN/health/ready from outside the server."
}
start() {
    [[ -f $HERMES_DATA_DIR/release/source.tar && ! -e $HERMES_DATA_DIR/deploying ]] || die 'No complete release. Use deploy or recover first.'
    dc up -d --wait --wait-timeout 240 db api frontend proxy
}
recover() {
    [[ $# == 4 ]] || die 'Usage: hermes.sh recover SNAPSHOT NEW_SOURCE_DIR NEW_DATA_DIR NEW_CONFIG_FILE'
    local target_root=$2 target_data=$3 target_config=$4
    for path in "$target_root" "$target_data" "$target_config"; do safe_path "$path"; [[ ! -e $path ]] || die "Recovery target already exists: $path"; done
    [[ $target_data != "$target_root"/* && $target_root != "$target_data"/* ]] || die 'Source and data directories must be separate.'
    extract_snapshot "$1"
    install -d -m 0700 "$target_root" "$target_data" "$(dirname "$target_config")"
    tar -C "$target_root" -xf "$package/source.tar"
    tar -C "$target_data" -xf "$package/keys-and-tls.tar"
    cp "$package/Caddyfile" "$target_data/Caddyfile"
    docker image load -i "$package/images.tar" > /dev/null
    cp "$package/deployment.env" "$target_config"
    local old_config=$HERMES_CONFIG_FILE work=$HERMES_WORK_DIR
    # Copy current repository credentials/settings too (including optional S3 credentials).
    python3 - "$old_config" "$target_config" <<'PY'
import sys
original, target = sys.argv[1:]
extra = [line for line in open(original).read().splitlines() if line.startswith(('AWS_', 'B2_', 'AZURE_', 'GOOGLE_', 'RESTIC_'))]
lines = [line for line in open(target).read().splitlines() if not line.startswith(('AWS_', 'B2_', 'AZURE_', 'GOOGLE_', 'RESTIC_'))]
with open(target, 'w') as f: f.write('\n'.join(lines + extra) + '\n')
PY
    HERMES_CONFIG_FILE=$target_config
    write_setting HERMES_ROOT "$target_root"
    write_setting HERMES_DATA_DIR "$target_data"
    write_setting HERMES_WORK_DIR "$work"
    write_setting HERMES_CADDYFILE "$target_data/Caddyfile"
    # Isolate the new database/project even when recovering on the old host.
    write_setting HERMES_INSTANCE "hermes-recovery-$(openssl rand -hex 6)"
    set -a
    # shellcheck disable=SC1090
    source "$target_config"
    set +a
    dc up -d db --wait --wait-timeout 180
    restore_database dc "$package/database.dump"
    validate_database dc
    install -d -m 0700 "$target_data/release"
    cp "$package/source.tar" "$target_data/release/source.tar"
    log "Recovery complete in $target_data. API/proxy are stopped. Review $target_config, stop the old instance, then run HERMES_CONFIG_FILE=$target_config bash $target_root/deploy/debian13/hermes.sh start."
}
install_systemd() {
    for unit in "$script_dir"/systemd/*; do
        sed -e "s|@ROOT@|$HERMES_ROOT|g" -e "s|@CONFIG@|$HERMES_CONFIG_FILE|g" "$unit" > "/etc/systemd/system/$(basename "$unit")"
    done
    systemctl daemon-reload
    systemctl enable --now hermes-staging.service hermes-backup.timer hermes-restore-drill.timer
}

[[ $EUID == 0 ]] || die 'Run as root (Docker access is equivalent to root access).'
command=${1:-help}
shift || true
if [[ $command == init ]]; then init "$@"; exit; fi
if [[ $command == help ]]; then
    echo 'Commands: init DOMAIN EMAIL REPOSITORY | init-repository | deploy | start | stop | status | backup | snapshots | check | restore-drill [SNAPSHOT] | recover SNAPSHOT SOURCE DATA CONFIG | initialize-admin USERNAME EMAIL | bootstrap-admin USERNAME | install-systemd'
    exit
fi
load_config
case $command in
    init-repository) restic init ;;
    snapshots) restic snapshots --host "$HERMES_INSTANCE" --tag hermes ;;
    check) lock; restic check --read-data ;;
    status) dc ps; for marker in last-backup.json last-restore-drill.txt; do [[ ! -f $HERMES_DATA_DIR/$marker ]] || { echo "$marker:"; cat "$HERMES_DATA_DIR/$marker"; echo; }; done ;;
    deploy|start|backup|recover) lock; "$command" "$@" ;;
    restore-drill) lock; restore_drill "$@" ;;
    install-systemd) lock; install_systemd ;;
    stop) lock; dc down --remove-orphans ;;
    initialize-admin)
        [[ $# == 2 && -n ${HERMES_INITIAL_ADMIN_PASSWORD:-} ]] || die 'Specify a username, email and HERMES_INITIAL_ADMIN_PASSWORD.'
        export HERMES_INITIAL_ADMIN_PASSWORD
        lock
        dc --profile maintenance run --rm --no-deps -e HERMES_INITIAL_ADMIN_PASSWORD migrate --initialize-system-admin "$1" "$2"
        ;;
    bootstrap-admin) [[ $# == 1 && $1 =~ ^[a-z0-9][a-z0-9._-]+$ ]] || die 'Specify one canonical username.'; lock; dc --profile maintenance run --rm --no-deps migrate --bootstrap-system-admin "$1" ;;
    *) die "Unknown command: $command" ;;
esac
