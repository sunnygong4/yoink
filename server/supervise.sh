#!/usr/bin/env bash
# Keeps Yoinker running on the server (same idea as the karaoke site's supervise.sh). Run from cron every minute
# and at boot; "supervise.sh restart" restarts it now (after a deploy). The public URL comes from the karaoke
# site's Cloudflare tunnel: music.sunnygong.com -> 127.0.0.1:8100 (ingress in ~/karaoke/tunnel.yml).
Y="$HOME/yoink"
export PATH="$HOME/.local/bin:$Y/server/.venv/bin:/usr/local/bin:$PATH"
export SONGSTORE_ROOT="${SONGSTORE_ROOT:-$HOME/songstore}"   # the same song library the karaoke site uses
export YOINKER_DATA="${YOINKER_DATA:-$HOME/yoinker-data}"
export YOINKER_COOKIE_SECURE=1
mkdir -p "$Y/logs"
exec 9>"$Y/logs/.supervise.lock"
flock -n 9 || exit 0

log() { echo "$(date '+%F %T') $*" >> "$Y/logs/supervisor.log"; }
MATCH="[u]vicorn app:app --app-dir $Y/server"

if [ "$1" = "restart" ]; then
  log "restart requested"
  pkill -f "$MATCH"
  for i in $(seq 1 16); do pgrep -f "$MATCH" > /dev/null || break; sleep 0.5; done
  pkill -9 -f "$MATCH" ; sleep 1
fi
[ -f "$Y/logs/server.log" ] && [ "$(stat -c %s "$Y/logs/server.log")" -gt 20000000 ] \
  && tail -c 2000000 "$Y/logs/server.log" > "$Y/logs/server.log.tmp" && mv "$Y/logs/server.log.tmp" "$Y/logs/server.log"

if ! pgrep -f "$MATCH" > /dev/null; then
  log "server down -> starting"
  cd "$Y"
  setsid nohup "$Y/server/.venv/bin/python" -m uvicorn app:app --app-dir "$Y/server" --host 127.0.0.1 --port 8100 \
    --timeout-graceful-shutdown 3 >> "$Y/logs/server.log" 2>&1 9>&- &
fi

if [ "$1" = "restart" ]; then
  for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:8100/api/healthz && break; sleep 1; done
  echo "yoinker HTTP $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8100/api/healthz)"
fi
exit 0
