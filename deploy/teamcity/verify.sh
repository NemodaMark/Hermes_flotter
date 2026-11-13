#!/usr/bin/env bash
set -Eeuo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
(cd frontend && npm ci && npm run lint && npm test -- --pool=threads --maxWorkers=2 && npm run build)
dotnet test backend/Hermes.slnx -c Release
dotnet test desktop/tests/Hermes.ControlCenter.Tests/Hermes.ControlCenter.Tests.csproj -c Release
shellcheck deploy/debian13/*.sh deploy/debian13/tests/*.sh deploy/teamcity/*.sh
