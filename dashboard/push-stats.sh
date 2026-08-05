#!/bin/bash
# 更新 stats.json 并推送到 GitHub，看板自动刷新
# 运行方式：bash push-stats.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Token 从环境变量读取，不写入脚本
# 使用前请先执行: export GITHUB_TOKEN=<your_token>
TOKEN="${GITHUB_TOKEN:?请先设置 GITHUB_TOKEN 环境变量}"
REPO="erikainworking-cloud/reddit-dashboard"

echo "📊 拉取飞书数据..."
node "$SCRIPT_DIR/export-stats.js"

echo "🚀 推送到 GitHub..."
CONTENT=$(base64 -i "$SCRIPT_DIR/stats.json")

# 获取当前文件的 SHA（更新文件必须提供）
SHA=$(curl -s -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/$REPO/contents/stats.json" | \
  python3 -c "import json,sys; print(json.load(sys.stdin).get('sha',''))")

curl -s -X PUT \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"update stats $(date +%Y-%m-%d)\",\"content\":\"$CONTENT\",\"sha\":\"$SHA\"}" \
  "https://api.github.com/repos/$REPO/contents/stats.json" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print('✅ 已更新' if 'content' in d else '❌ ' + d.get('message',''))"

echo "🌐 看板已更新：https://erikainworking-cloud.github.io/reddit-dashboard/"
