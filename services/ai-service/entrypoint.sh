#!/bin/sh
set -eu

if [ "${APP_MODE:-serve}" = "migrate" ]; then
  exec python -m alembic upgrade head
fi

python -m app.cli ensure-model --rows "${MODEL_ROWS:-12000}"

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-1}" \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"
