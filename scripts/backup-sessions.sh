#!/bin/zsh
# backup-sessions — 把各家 AI agent 的 session 文件「只增不删」地归档到外置 SSD。
#
# 动机:Claude Code 默认 cleanupPeriodDays=30,启动时自动删 30 天前的 session
# transcript;Codex / Gemini 等也各有清理。本脚本在清理删掉之前,把各源镜像到
# SSD,让历史永不丢失,并能在 open-session 里以「Archived (SSD)」来源回看。
#
# 核心不变量(正确性第一):
#   · 只增不删 —— 源里文件没了,备份里必须保留。绝不用 rsync --delete。
#   · 幂等增量 —— 用 rsync -a --update:新增拷过去、源变大的(jsonl 追加写)更新过去、
#                 备份独有(源已被清理)的原样保留。重复跑安全、断点续跑安全。
#   · 失败边界 —— SSD 未挂载就清晰报错退出,绝不报「成功」。
#
# 用法:
#   scripts/backup-sessions.sh            # 跑全量备份
#   OPEN_SESSION_BACKUP_ROOT=/x ... .sh   # 覆盖备份根(默认见下)
#
# 备份根可被环境变量 OPEN_SESSION_BACKUP_ROOT 覆盖,默认与 open-session 的
# src/lib/session-roots.ts 里的 DEFAULT_BACKUP_ROOT 保持一致(单一真相源:换盘只改这两处)。

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

BACKUP_ROOT="${OPEN_SESSION_BACKUP_ROOT:-/Volumes/Extreme SSD/Backup/AI Agent Sessions}"
HOME_DIR="${HOME}"
LOG_DIR="${HOME}/Library/Logs"
LOG_FILE="${LOG_DIR}/open-session-backup.log"

log() { print -r -- "$(date '+%Y-%m-%d %H:%M:%S')  $*"; }

# --- 失败边界:SSD 未挂载 -> 清晰报错退出,绝不静默/报成功 ---------------------
# 判据是「备份根的父目录(挂载点)真实存在且是目录」,不是「自动创建一个空目录假装成功」。
MOUNT_POINT="${BACKUP_ROOT%/*}"     # AI Agent Sessions 的上一级 = .../Backup
VOLUME_ROOT="/Volumes/${BACKUP_ROOT#/Volumes/}"; VOLUME_ROOT="/Volumes/${${BACKUP_ROOT#/Volumes/}%%/*}"

if [[ "$BACKUP_ROOT" == /Volumes/* && ! -d "$VOLUME_ROOT" ]]; then
  log "ERROR: 外置卷未挂载: $VOLUME_ROOT — 不执行备份(避免把本地数据写进未挂载的占位目录)。"
  print -u2 "ERROR: backup volume not mounted: $VOLUME_ROOT"
  exit 2
fi

if ! mkdir -p "$BACKUP_ROOT" 2>/dev/null; then
  log "ERROR: 无法创建/访问备份根: $BACKUP_ROOT"
  print -u2 "ERROR: cannot create backup root: $BACKUP_ROOT"
  exit 2
fi

mkdir -p "$LOG_DIR" 2>/dev/null

# --- 每个源:src(本地源目录) dst(SSD 子目录) -------------------------------
# 布局让 open-session 能用「同一套 parser、只换个根」来读:
#   claude/projects   codex/sessions   copilot/session-state   gemini/{tmp,antigravity}
typeset -A SOURCES
SOURCES=(
  "claude"            "${HOME_DIR}/.claude/projects|${BACKUP_ROOT}/claude/projects"
  "codex"             "${HOME_DIR}/.codex/sessions|${BACKUP_ROOT}/codex/sessions"
  "copilot"           "${HOME_DIR}/.copilot/session-state|${BACKUP_ROOT}/copilot/session-state"
  "gemini-tmp"        "${HOME_DIR}/.gemini/tmp|${BACKUP_ROOT}/gemini/tmp"
  "gemini-antigravity" "${HOME_DIR}/.gemini/antigravity|${BACKUP_ROOT}/gemini/antigravity"
)

# rsync 选项详解(只增不删的关键):
#   -a        归档:递归 + 保留权限/时间戳/符号链接
#   --update  目标比源新就跳过(不回退);源更新(jsonl 追加变大)才覆盖
#   --no-perms / --no-owner / --no-group  外置盘(exFAT/APFS 跨用户)别强套源权限,避免噪音报错
#   绝不出现 --delete:这是「源消失则备份保留」的根本保证
RSYNC_OPTS=(-a --update --no-perms --no-owner --no-group --out-format='%n')

log "==== backup start (root=$BACKUP_ROOT) ===="

TOTAL_COPIED=0
declare -a SUMMARY

for key in claude codex copilot gemini-tmp gemini-antigravity; do
  entry="${SOURCES[$key]}"
  src="${entry%%|*}"
  dst="${entry##*|}"

  if [[ ! -d "$src" ]]; then
    log "SKIP  $key: 源不存在 ($src)"
    SUMMARY+=("$key: source absent")
    continue
  fi

  mkdir -p "$dst"
  # rsync 尾部斜杠:把 src 的「内容」同步进 dst(而非把 src 目录本身嵌一层)
  out="$(rsync "${RSYNC_OPTS[@]}" "$src/" "$dst/" 2>>"$LOG_FILE")"
  # --out-format 只在「实际传输的文件」时输出一行;目录项以 / 结尾,排除掉
  copied=$(print -r -- "$out" | grep -v '/$' | grep -c . )
  total_in_backup=$(find "$dst" -type f 2>/dev/null | grep -c . )
  TOTAL_COPIED=$((TOTAL_COPIED + copied))
  log "OK    $key: 传输/更新 $copied 个文件;备份现存 $total_in_backup 个文件 ($dst)"
  SUMMARY+=("$key: +${copied} transferred, ${total_in_backup} total in backup")
done

log "==== backup done: 本次共传输/更新 $TOTAL_COPIED 个文件 ===="
log "manifest:"
for line in "${SUMMARY[@]}"; do log "  - $line"; done

# manifest 也落一份到备份根,方便离线核对
{
  print -r -- "# AI Agent Sessions backup manifest"
  print -r -- "# generated: $(date '+%Y-%m-%d %H:%M:%S')"
  print -r -- "# this run transferred/updated: $TOTAL_COPIED file(s)"
  for line in "${SUMMARY[@]}"; do print -r -- "$line"; done
} > "${BACKUP_ROOT}/MANIFEST.txt" 2>/dev/null

exit 0
