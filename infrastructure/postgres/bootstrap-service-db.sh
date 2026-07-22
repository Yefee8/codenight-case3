#!/bin/sh
set -eu

# Runs only during first initialization of each PostgreSQL volume.
# Application roles are deliberately NOSUPERUSER and NOBYPASSRLS.
if [ -n "${MIGRATION_PASSWORD_FILE:-}" ]; then
  MIGRATION_PASSWORD="$(cat "$MIGRATION_PASSWORD_FILE")"
fi
if [ -n "${RUNTIME_PASSWORD_FILE:-}" ]; then
  RUNTIME_PASSWORD="$(cat "$RUNTIME_PASSWORD_FILE")"
fi
if [ -n "${POSTGRES_PASSWORD_FILE:-}" ]; then
  POSTGRES_PASSWORD="$(cat "$POSTGRES_PASSWORD_FILE")"
fi

: "${APP_DATABASE:?APP_DATABASE is required}"
: "${MIGRATION_USER:?MIGRATION_USER is required}"
: "${MIGRATION_PASSWORD:?MIGRATION_PASSWORD or MIGRATION_PASSWORD_FILE is required}"
: "${RUNTIME_USER:?RUNTIME_USER is required}"
: "${RUNTIME_PASSWORD:?RUNTIME_PASSWORD or RUNTIME_PASSWORD_FILE is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD or POSTGRES_PASSWORD_FILE is required}"
if [ "$MIGRATION_USER" = "$RUNTIME_USER" ]; then
  echo "Migration and runtime database roles must be different" >&2
  exit 1
fi
case "$MIGRATION_USER:$RUNTIME_USER" in
  *postgres*)
    echo "Application database roles must not use the postgres bootstrap identity" >&2
    exit 1
    ;;
esac

# Local socket authentication is SCRAM, so init-time psql must authenticate too.
export PGPASSWORD="$POSTGRES_PASSWORD"
psql --set ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  --set=db_name="$APP_DATABASE" \
  --set=migration_user="$MIGRATION_USER" \
  --set=migration_password="$MIGRATION_PASSWORD" \
  --set=runtime_user="$RUNTIME_USER" \
  --set=runtime_password="$RUNTIME_PASSWORD" <<'EOSQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'migration_user', :'migration_password'
) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migration_user') \gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'runtime_user', :'runtime_password'
) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_user') \gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'migration_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db_name', :'migration_user') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db_name', :'runtime_user') \gexec
EOSQL

psql --set ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$APP_DATABASE" \
  --set=migration_user="$MIGRATION_USER" \
  --set=runtime_user="$RUNTIME_USER" <<'EOSQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'migration_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'runtime_user') \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  :'migration_user', :'runtime_user'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
  :'migration_user', :'runtime_user'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I',
  :'migration_user', :'runtime_user'
) \gexec
EOSQL

unset PGPASSWORD MIGRATION_PASSWORD RUNTIME_PASSWORD POSTGRES_PASSWORD
