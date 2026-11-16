#!/usr/bin/env bash
set -euo pipefail

repository='https://github.com/NemodaMark/Hermes_flotter.git'
tools_directory="${XDG_DATA_HOME:-$HOME/.local/share}/hermes/tools"

die() { printf '%s\n' "$*" >&2; exit 1; }
(( EUID != 0 )) || die 'Run as the desktop user. The installer uses sudo for system packages.'
(( $# <= 1 )) || die 'Usage: install-workstation.sh [project-directory]'
[[ -r /etc/os-release ]] || die 'Cannot determine the Linux distribution.'
# shellcheck disable=SC1091
. /etc/os-release
case "$ID:$VERSION_ID:$(uname -m)" in
    debian:13:x86_64|ubuntu:24.04:x86_64) ;;
    *) die 'This installer supports Debian 13 and Ubuntu 24.04 on x86-64.' ;;
esac
command -v sudo >/dev/null || die 'Install sudo and grant your desktop user package installation rights.'

temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT

apt_install() { sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"; }
sudo apt-get update
apt_install ca-certificates curl git gnupg xz-utils util-linux

if ! command -v dotnet >/dev/null || ! dotnet --list-sdks | grep '^10\.' >/dev/null; then
    if [[ "$ID" == debian ]] && ! apt-cache show dotnet-sdk-10.0 >/dev/null 2>&1; then
        curl --fail --silent --show-error --location --retry 2 \
            'https://packages.microsoft.com/config/debian/13/packages-microsoft-prod.deb' -o "$temporary/microsoft-prod.deb"
        sudo dpkg -i "$temporary/microsoft-prod.deb"
        sudo apt-get update
    fi
    apt_install dotnet-sdk-10.0
fi
dotnet_path=$(command -v dotnet)
if ! "$dotnet_path" --list-sdks | grep '^10\.' >/dev/null; then
    dotnet_path=/usr/bin/dotnet
    "$dotnet_path" --list-sdks | grep '^10\.' >/dev/null || die 'The .NET 10 SDK is missing.'
fi

postgres_bin=/usr/lib/postgresql/18/bin
if [[ ! -x "$postgres_bin/pg_ctl" ]]; then
    if ! apt-cache show postgresql-18 >/dev/null 2>&1; then
        curl --fail --silent --show-error --location --retry 2 \
            'https://www.postgresql.org/media/keys/ACCC4CF8.asc' -o "$temporary/postgresql.asc"
        mkdir -m 700 "$temporary/gnupg"
        fingerprint=$(gpg --homedir "$temporary/gnupg" --show-keys --with-colons "$temporary/postgresql.asc" |
            awk -F: '$1 == "fpr" && !seen++ {print $10}')
        [[ "$fingerprint" == B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8 ]] || die 'Unexpected PostgreSQL APT signing key.'
        sudo install -m 0644 "$temporary/postgresql.asc" /usr/share/keyrings/hermes-postgresql.asc
        printf 'Types: deb\nURIs: https://apt.postgresql.org/pub/repos/apt\nSuites: %s-pgdg\nComponents: main\nSigned-By: /usr/share/keyrings/hermes-postgresql.asc\n' \
            "$VERSION_CODENAME" | sudo tee /etc/apt/sources.list.d/hermes-postgresql.sources >/dev/null
        sudo apt-get update
    fi
    apt_install postgresql-18
fi

node_path=$(command -v node || true)
if [[ ! -x "$node_path" ]] || ! command -v npm >/dev/null ||
    [[ ! $("$node_path" --version) =~ ^v(22\.(2[0-9]|[3-9][0-9]|[0-9]{3,})\.|2[4-9]\.|[3-9][0-9]\.|[0-9]{3,}\.) ]]; then
    node_dist=https://nodejs.org/dist/latest-v22.x
    curl --fail --silent --show-error --location --retry 2 "$node_dist/SHASUMS256.txt" -o "$temporary/SHASUMS256.txt"
    entry=$(grep -E '^[a-f0-9]{64}[[:space:]]+node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$' "$temporary/SHASUMS256.txt") ||
        die 'The official Node.js checksum list does not contain the Linux x64 archive.'
    read -r checksum archive <<< "$entry"
    node_directory="$tools_directory/$(basename "$archive" .tar.xz)"
    if [[ ! -x "$node_directory/bin/node" ]]; then
        curl --fail --silent --show-error --location --retry 2 "$node_dist/$archive" -o "$temporary/$archive"
        (cd "$temporary" && printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check)
        mkdir -p -- "$tools_directory"
        stage=$(mktemp -d -- "$tools_directory/.node.XXXXXXXX")
        if tar -xJf "$temporary/$archive" -C "$stage" --strip-components=1; then
            mv -T -- "$stage" "$node_directory"
        else
            rm -rf -- "$stage"
            die 'Could not extract Node.js.'
        fi
    fi
    node_path="$node_directory/bin/node"
    PATH="$(dirname -- "$node_path"):$PATH"
    export PATH
fi
git_path=$(command -v git)

project=${1:-}
if [[ -z "$project" ]]; then
    read -r -e -p 'Project directory (Enter for ~/HERMES): ' project
fi
project=${project:-"$HOME/HERMES"}
if [[ "$project" == \~/* ]]; then project="$HOME/${project:2}"; fi
project=$(realpath -m -- "$project")
if [[ -e "$project/.git" ]]; then
    origin=$("$git_path" -C "$project" config --get remote.origin.url)
    case "$origin" in
        "$repository"|"${repository%.git}"|git@github.com:NemodaMark/Hermes_flotter.git|ssh://git@github.com:NemodaMark/Hermes_flotter.git) ;;
        *) die 'The selected checkout has a different origin.' ;;
    esac
    [[ $("$git_path" -C "$project" branch --show-current) == main &&
       -z $("$git_path" -C "$project" status --porcelain) ]] || die 'Select a clean HERMES main checkout or a new directory.'
    "$git_path" -C "$project" pull --ff-only origin main
else
    "$git_path" clone --branch main -- "$repository" "$project"
fi

cd -- "$project"
"$dotnet_path" build backend/src/Hermes.Api/Hermes.Api.csproj -c Debug --nologo
npm --prefix frontend ci
launcher="$project/.local/workstation/launcher"
first_setup=false
if [[ ! -e "$project/.env" ]]; then first_setup=true; fi
"$dotnet_path" publish desktop/src/Hermes.Workstation/Hermes.Workstation.csproj -c Release -o "$launcher" --nologo
cli="$launcher/Hermes.Workstation.dll"
"$dotnet_path" "$cli" prepare "$project" "$postgres_bin" "$dotnet_path" "$node_path" "$git_path"

# Escape both the desktop entry string and its quoted Exec argument.
desktop_argument() {
    local value=$1
    value=${value//\\/\\\\\\\\}
    value=${value//\"/\\\\\"}
    value=${value//\`/\\\\\`}
    value=${value//\$/\\\\\$}
    value=${value//%/%%}
    printf '"%s"' "$value"
}

desktop_directory=
if command -v xdg-user-dir >/dev/null; then desktop_directory=$(xdg-user-dir DESKTOP); fi
if [[ -z "$desktop_directory" || "$desktop_directory" == "$HOME" ]]; then desktop_directory="$HOME/Desktop"; fi
mkdir -p -- "$desktop_directory"
cat > "$temporary/HERMES.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=HERMES Rendszervezérlő
Exec=$(desktop_argument "$dotnet_path") $(desktop_argument "$cli") desktop $(desktop_argument "$project")
Icon=applications-engineering
Terminal=true
EOF
install -m 0755 -- "$temporary/HERMES.desktop" "$desktop_directory/HERMES.desktop"
printf 'Desktop launcher: %s/HERMES.desktop\n' "$desktop_directory"

if [[ -t 0 && "$first_setup" == true ]]; then
    read -r -p 'First system administrator username (Enter to skip): ' username
    if [[ -n "$username" ]]; then
        read -r -p 'Email: ' email
        "$dotnet_path" "$cli" admin "$project" "$username" "$email"
    fi
fi
printf 'Installed at %s\n' "$project"
