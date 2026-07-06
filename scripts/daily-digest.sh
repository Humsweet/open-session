#!/bin/zsh
# open-session 每日工作总结 —— 调度桩（清晰命名，勿误关）
#
# 每天 00:05 由 LaunchAgent `com.hanyuyang.open-session-daily-digest` 触发。
# 职责只有两件，逻辑本身在 app 里（单一真相源，见 src/lib/daily-digest/）：
#   1. 先把 mac-mini 的 session 增量镜像到本地（scripts/mirror-mac-mini.sh）；
#      mac-mini 不可达时不算失败——继续跑，当天总结会诚实标为 partial，日后补齐。
#   2. 调 open-session 的 reconcile 接口：总结昨天 + 往前回填若干天（幂等、催齐）。
#
# 手动跑：zsh scripts/daily-digest.sh   （随时可重复，幂等）
# 日志：~/Library/Logs/open-session-daily-digest.log
set -u

REPO="${OPEN_SESSION_REPO:-${0:A:h:h}}"
PORT="${OPEN_SESSION_PORT:-3001}"
MAX_DAYS="${OPEN_SESSION_DIGEST_MAXDAYS:-4}"   # 昨天 + ~3 天回填 / 每次
LOG="$HOME/Library/Logs/open-session-daily-digest.log"

log() { print -r -- "$(date '+%Y-%m-%d %H:%M:%S')  $*" >> "$LOG"; }

log "=== daily-digest tick start (repo=$REPO port=$PORT maxDays=$MAX_DAYS) ==="

# 1) 镜像 mac-mini（best-effort）
if zsh "$REPO/scripts/mirror-mac-mini.sh" >> "$LOG" 2>&1; then
  log "mirror-mac-mini: ok"
else
  log "mirror-mac-mini: FAILED/unreachable (continuing; day(s) will be marked partial)"
fi

# 2) 触发 reconcile（总结昨天 + 回填）
resp="$(curl -s -m 1800 -w $'\n%{http_code}' \
  -H 'Content-Type: application/json' \
  -d "{\"maxDays\": $MAX_DAYS}" \
  "http://localhost:$PORT/api/daily/reconcile" 2>&1)"
code="${resp##*$'\n'}"
body="${resp%$'\n'*}"

if [[ "$code" == "200" ]]; then
  log "reconcile: ok  $body"
  log "=== tick done ==="
  exit 0
else
  log "reconcile: FAILED (http=$code) $body"
  log "=== tick done (with error) ==="
  exit 1
fi
