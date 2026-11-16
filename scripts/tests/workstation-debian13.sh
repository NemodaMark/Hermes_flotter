#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} == --desktop-session ]]; then
    project=$2
    shortcut=$3
    cli="$project/.local/workstation/launcher/Hermes.Workstation.dll"
    gio launch "$shortcut"
    window=$(timeout 15s xdotool search --sync --onlyvisible --limit 1 --class '^xterm$')
    printf 'Desktop shortcut opened an XTerm window (%s).\n' "$window"

    wait_for_health() {
        local expected=$1 status count attempt
        for ((attempt = 0; attempt < 35; attempt++)); do
            status=$(dotnet "$cli" status "$project") || true
            count=$(awk -v expected="$expected" '$0 ~ ("[[:space:]]" expected "[[:space:]]") { count++ } END { print count+0 }' <<< "$status")
            if [[ "$count" == 4 ]]; then
                printf '%s\n' "$status"
                return 0
            fi
            sleep 2
        done
        printf 'Expected four %s health checks. Last status:\n%s\n' "$expected" "$status" >&2
        return 1
    }

    wait_for_health OK
    xdotool windowfocus --sync "$window"
    xdotool type S
    xdotool key Return
    wait_for_health HIBA
    exit 0
fi

# A clean Debian container supplies the desktop tools, but the installer provisions the project tools.
project="$HOME/HERMES workstation 100%"
desktop="$HOME/HERMES Desktop"
mkdir -p "$desktop"
xdg-user-dirs-update --set DESKTOP "$desktop"
test "$(xdg-user-dir DESKTOP)" = "$desktop"

show_logs_on_failure() {
    local result=$?
    if (( result != 0 )); then
        for log in "$project"/.local/control-center/logs/*.log; do
            if [[ -f "$log" ]]; then tail -n 80 "$log"; fi
        done
    fi
}
trap show_logs_on_failure EXIT

printf '%s\n' "$project" | bash /hermes-scripts/install-workstation.sh
shortcut="$desktop/HERMES.desktop"
test -x "$shortcut"
desktop-file-validate "$shortcut"
xvfb-run -a dbus-run-session -- bash "$0" --desktop-session "$project" "$shortcut"
