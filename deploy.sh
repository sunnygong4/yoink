#!/usr/bin/env bash
# Push Yoinker's code (songstore, server, built web page) to sunnyserver3 and restart it there.
#   ./deploy.sh          deploy and restart
#   ./deploy.sh --build  run "npm run build" in web/ first
# Data (~/songstore, ~/yoinker-data) lives on the server and is never touched by this script.
set -euo pipefail
cd "$(dirname "$0")"
SRV=sunnyserver3
[ "${1:-}" = "--build" ] && (cd web && npm run build)
tar -cf /tmp/yk_deploy.tar --exclude=.venv --exclude=__pycache__ --exclude='*.pyc' --exclude='*.egg-info' \
  songstore server web/dist
scp -o BatchMode=yes /tmp/yk_deploy.tar "$SRV:/tmp/yk_deploy.tar"
rm /tmp/yk_deploy.tar
ssh -o BatchMode=yes "$SRV" 'mkdir -p ~/yoink && cd ~/yoink && tar -xf /tmp/yk_deploy.tar && rm /tmp/yk_deploy.tar \
  && chmod +x server/supervise.sh \
  && (cd server && ~/.local/bin/uv pip install -q --python .venv/bin/python -r requirements.txt) \
  && server/supervise.sh restart'
