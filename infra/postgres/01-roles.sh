#!/bin/sh
set -eu

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=database="$POSTGRES_DB" \
  --set=migrator_password="$HERMES_MIGRATOR_PASSWORD" \
  --set=app_password="$HERMES_APP_PASSWORD" \
  --file=/docker-entrypoint-initdb.d/roles.sql.template
