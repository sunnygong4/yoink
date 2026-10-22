#!/usr/bin/env sh
# Start Yoinker on the server (behind the Cloudflare tunnel: music.sunnygong.com -> 127.0.0.1:8100).
# SONGSTORE_ROOT must be the same folder the karaoke site uses, so both see one song library.
cd "$(dirname "$0")"
export SONGSTORE_ROOT="${SONGSTORE_ROOT:-$HOME/songstore}"
export YOINKER_DATA="${YOINKER_DATA:-$HOME/yoinker-data}"
export YOINKER_COOKIE_SECURE=1
exec .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8100
