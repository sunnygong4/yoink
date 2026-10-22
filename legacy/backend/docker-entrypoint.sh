#!/bin/sh
set -eu

cd /app/backend

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  alembic upgrade head
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
