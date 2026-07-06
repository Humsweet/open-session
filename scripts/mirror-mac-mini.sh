#!/bin/zsh
# mirror-mac-mini — 把 mac-mini 上各家 AI agent 的 session 文件「只增不删」地
# 增量镜像到本机一个本地目录，作为 open-session 的一个远端 host 数据源。
#
# 动机:mac-mini 上跑着大量 agent session(claude/codex/…),它们与本机同构地
# 存在 ~/.claude/projects、~/.codex/sessions 等路径下。本脚本把它们拉到本机镜像
# 根,让 open-session 用「同一套 parser、只换个根」来读,并以 host='mac-mini' 标记,
# 作为「每日工作总结」的数据基础。默认这些会话不进本机主列表(见 /api/sessions 的 host 过滤)。
#
# 核心不变量(正确性第一,风格照 scripts/backup-sessions.sh):
#   · 只增不删 —— 远端文件没了,镜像里必须保留。绝不用 rsync --delete。
#   · 幂等增量 —— rsync -a --update:新增拉过来、远端变大的(jsonl 追加写)更新过来、
#                 镜像独有(远端已被清理)的原样保留。重复跑安全、断点续跑安全。
#   · 失败边界 —— mac-mini 不可达(LAN 与 tailscale 都不通)就清晰报错退出,
#                 绝不报「成功」、绝不建幽灵目录。
#
# 用法:
#   scripts/mirror-mac-mini.sh                    # 跑全量镜像(LAN 优先,tailscale 兜底)
#   OPEN_SESSION_MACMINI_MIRROR=/x ... .sh        # 覆盖镜像根(默认见下)

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# --- SSOT:mac-mini 的可达地址 / SSH 用户 / 镜像根 ---------------------------------
# 这里是 mac-mini 连接信息的唯一正本(IP/host/user 只在此出现一次)。
#   · tailscale 短名在本机解析不了,别用;用 tailscale IP 兜底。
#   · 同局域网时 bonjour 短名 .local 可达且更快,故 LAN 优先、tailscale 兜底。
MACMINI_TS_IP="100.120.27.0"                 # tailscale IP(跨网络兜底)
MACMINI_LAN_HOST="hans-mac-mini.local"       # 同局域网 bonjour 短名(优先)
MACMINI_USER="hanyuyang"                      # mac-mini 的 SSH 用户

# 镜像根:默认 ~/.open-session/mirror/mac-mini,可被环境变量覆盖。
# MUST 与 open-session 的 src/lib/parsers/session-roots.ts 里
# DEFAULT_MACMINI_MIRROR_ROOT 保持一致(单一真相源:换路径只改这两处)。
MIRROR_ROOT="${OPEN_SESSION_MACMINI_MIRROR:-$HOME/.open-session/mirror/mac-mini}"

LOG_DIR="${HOME}/Library/Logs"
LOG_FILE="${LOG_DIR}/open-session-macmini-mirror.log"
mkdir -p "$LOG_DIR" 2>/dev/null

log() { print -r -- "$(date '+%Y-%m-%d %H:%M:%S')  $*" | tee -a "$LOG_FILE"; }

# --- 连通性探测:LAN 优先,tailscale 兜底,都不通 -> exit 2 --------------------------
SSH_PROBE_OPTS=(-o BatchMode=yes -o ConnectTimeout=4)
HOST=""
for candidate in "$MACMINI_LAN_HOST" "$MACMINI_TS_IP"; do
  if ssh "${SSH_PROBE_OPTS[@]}" "${MACMINI_USER}@${candidate}" true 2>/dev/null; then
    HOST="$candidate"
    break
  fi
done

if [[ -z "$HOST" ]]; then
  log "ERROR: mac-mini 不可达(LAN=$MACMINI_LAN_HOST 与 tailscale=$MACMINI_TS_IP 均无法 SSH) — 不执行镜像。"
  print -u2 "ERROR: mac-mini unreachable via LAN ($MACMINI_LAN_HOST) or tailscale ($MACMINI_TS_IP)"
  exit 2
fi

REMOTE="${MACMINI_USER}@${HOST}"

if ! mkdir -p "$MIRROR_ROOT" 2>/dev/null; then
  log "ERROR: 无法创建/访问镜像根: $MIRROR_ROOT"
  print -u2 "ERROR: cannot create mirror root: $MIRROR_ROOT"
  exit 2
fi

# --- 每个源:远端目录(相对 mac-mini 的 $HOME) 本机镜像子目录 ----------------------
# 布局与 backup-sessions.sh / session-roots.ts 完全一致,parser 只换根即可读:
#   claude/projects   codex/sessions   copilot/session-state   gemini/{antigravity/conversations,tmp}
typeset -A SOURCES
SOURCES=(
  "claude"             ".claude/projects|${MIRROR_ROOT}/claude/projects"
  "codex"              ".codex/sessions|${MIRROR_ROOT}/codex/sessions"
  "copilot"            ".copilot/session-state|${MIRROR_ROOT}/copilot/session-state"
  "gemini-antigravity" ".gemini/antigravity/conversations|${MIRROR_ROOT}/gemini/antigravity/conversations"
  "gemini-tmp"         ".gemini/tmp|${MIRROR_ROOT}/gemini/tmp"
)

# rsync 选项(与 backup-sessions.sh 同):-a 归档 + --update 只进不退 + 无 --delete。
# --no-perms/owner/group:跨机权限不强套,避免噪音。-e 指定 SSH(BatchMode 免密卡住)。
RSYNC_SSH="ssh -o BatchMode=yes -o ConnectTimeout=8"
RSYNC_OPTS=(-a --update --no-perms --no-owner --no-group -e "$RSYNC_SSH" --out-format='%n')

log "==== mirror start (host=$HOST, root=$MIRROR_ROOT) ===="

TOTAL_COPIED=0
declare -a SUMMARY

for key in claude codex copilot gemini-antigravity gemini-tmp; do
  entry="${SOURCES[$key]}"
  rel="${entry%%|*}"
  dst="${entry##*|}"
  src="${REMOTE}:${rel}/"

  # 远端目录不存在就跳过,不报错(rsync 会因源缺失返回 23/非0,故先探测)。
  if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$REMOTE" "test -d \"$rel\"" 2>/dev/null; then
    log "SKIP  $key: 远端源不存在 (~/$rel)"
    SUMMARY+=("$key: remote source absent")
    continue
  fi

  mkdir -p "$dst"
  out="$(rsync "${RSYNC_OPTS[@]}" "$src" "$dst/" 2>>"$LOG_FILE")"
  # --out-format 只在实际传输文件时输出一行;目录项以 / 结尾,排除掉
  copied=$(print -r -- "$out" | grep -v '/$' | grep -c . )
  total_in_mirror=$(find "$dst" -type f 2>/dev/null | grep -c . )
  TOTAL_COPIED=$((TOTAL_COPIED + copied))
  log "OK    $key: 传输/更新 $copied 个文件;镜像现存 $total_in_mirror 个文件 ($dst)"
  SUMMARY+=("$key: +${copied} transferred, ${total_in_mirror} total in mirror")
done

log "==== mirror done: 本次共传输/更新 $TOTAL_COPIED 个文件 ===="
log "manifest:"
for line in "${SUMMARY[@]}"; do log "  - $line"; done

# manifest 落一份到镜像根,方便离线核对(各源文件计数 + 时间 + host)。
{
  print -r -- "# mac-mini AI Agent Sessions mirror manifest"
  print -r -- "# generated: $(date '+%Y-%m-%d %H:%M:%S')"
  print -r -- "# source host: $HOST (user=$MACMINI_USER)"
  print -r -- "# this run transferred/updated: $TOTAL_COPIED file(s)"
  for line in "${SUMMARY[@]}"; do print -r -- "$line"; done
} > "${MIRROR_ROOT}/MIRROR-MANIFEST.txt" 2>/dev/null

# 记录最后一次成功镜像的时刻(epoch 秒),供 open-session 判定某天 mac-mini 覆盖是否新鲜:
# 只有「最后成功镜像时刻 >= 那天结束」才算该天 mac-mini 数据已捕获,否则标 partial 待补齐。
print -r -- "$(date +%s)" > "${MIRROR_ROOT}/.last-success" 2>/dev/null

exit 0
