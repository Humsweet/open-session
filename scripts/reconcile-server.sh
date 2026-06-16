#!/bin/zsh
# reconcile-server — 把运行中的 open-session server 收敛到当前 git HEAD。
#
# 设计不变量:这台 host 上「运行中的 server」⇔「当前 HEAD 的代码」。
# 本脚本是这条不变量的唯一执行者(单一真相源):构建/重启逻辑只此一处。
#
#   · 幂等   —— 产物已对应当前 HEAD 时空跑,重复调用安全、断点重跑安全。
#   · 增量   —— 仅当 lockfile 变化或依赖不完整才装依赖,否则跳过。
#   · 失败边界 —— 只在 build/install 失败时失败,且失败时保留旧 server 不动,
#                绝不把服务切到崩溃态来「兜底」。
#
# 调用方:git hooks(post-merge / post-rewrite)在 pull/rebase 后自动触发;
#         也可手动运行 = 「按当前代码重建并重启」。

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

REPO="${0:A:h:h}"                              # 脚本在 scripts/ 下,仓库根 = 上两级(随仓库移动而自适应)
SERVICE="com.hanyuyang.open-session"
STAMP="$REPO/.git/open-session-built-commit"   # 机器本地状态,在 .git 内 → 永不入库、各机各留

cd "$REPO" || { echo "[reconcile] 仓库不存在: $REPO" >&2; exit 1 }

head_commit="$(git rev-parse HEAD)"
built_commit="$(cat "$STAMP" 2>/dev/null || echo none)"

# —— 幂等门:产物已对应当前 HEAD 且依赖完整 → 空跑 ——
if [[ "$head_commit" == "$built_commit" && -x node_modules/.bin/next ]]; then
  echo "[reconcile] 已是最新 (${head_commit:0:8}),无需重建"
  exit 0
fi

echo "[reconcile] 收敛: 已构建 ${built_commit:0:8}  →  目标 HEAD ${head_commit:0:8}"

# —— 依赖:仅当不完整、或 lockfile 在两 commit 间变化时才装(增量) ——
need_install=0
if [[ ! -x node_modules/.bin/next || ! -x node_modules/.bin/cross-env ]]; then
  need_install=1                               # 依赖缺失
elif [[ "$built_commit" != "none" ]] && ! git diff --quiet "$built_commit" "$head_commit" -- package-lock.json 2>/dev/null; then
  need_install=1                               # lockfile 变了(diff 报错也归此类,拿不准就装,安全侧)
fi

if (( need_install )); then
  echo "[reconcile] 依赖变化,npm ci ..."
  npm ci || { echo "[reconcile] npm ci 失败 → 保留旧 server 不动,未重启" >&2; exit 1 }
fi

echo "[reconcile] 构建 npm run build ..."
if ! npm run build; then
  echo "[reconcile] 构建失败 → 旧 server 继续服务,未重启。修正后重跑本脚本。" >&2
  exit 1
fi

echo "[reconcile] 构建成功,重启 $SERVICE ..."
launchctl kickstart -k "gui/$(id -u)/$SERVICE"

echo "$head_commit" > "$STAMP"
echo "[reconcile] 完成: server 现服务于 ${head_commit:0:8}"
