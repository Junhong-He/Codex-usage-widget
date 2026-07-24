#!/usr/bin/env bash
# 发布到 GitHub Releases 的一键脚本
# 前置：已安装并登录 gh（gh auth login），且已 git commit 当前代码
# 用法：bash scripts/release.sh <tag> [repo名] [github用户名]
set -e

TAG="${1:-v1.0.0}"
REPO="${2:-codex-usage-widget}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# 取当前登录的 GitHub 用户名（若未传第 3 个参数）
if [ -z "${3:-}" ]; then
  USER="$(gh api user --jq .login)"
else
  USER="$3"
fi

echo "==> 分支: $BRANCH | 仓库: $USER/$REPO | tag: $TAG"

# 1. 创建仓库并首次推送（若已存在 origin 则直接推送）
if ! git remote get-url origin >/dev/null 2>&1; then
  gh repo create "$USER/$REPO" --public --source . --remote origin --push
else
  git push -u origin "$BRANCH"
fi

# 2. 打 tag 触发 CI（build-windows.yml / build-macos.yml）
git tag "$TAG"
git push origin "$TAG"

echo "✅ 已推送 $TAG，去 https://github.com/$USER/$REPO/releases 查看自动构建的 exe / dmg"
echo "⚠️  macOS 的 dmg 需要先在仓库 Settings → Secrets 配置 MAC_CERT_P12 / MAC_CERT_PASSWORD / MAC_PROVISIONING_PROFILE / MAC_TEAM_ID，否则该 job 会失败（Windows 的 exe 不受影响）"
echo "⚠️  提交作者想改成你 GitHub 的邮箱：先 git config user.email '你的邮箱'，再 git commit --amend --reset-author"
