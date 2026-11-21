#!/usr/bin/env bash
# 一键启动 Portfolio Studio（本地静态服务器）
# 用法：  ./start.sh        然后浏览器打开 http://localhost:8787
set -e
cd "$(dirname "$0")"
PORT="${1:-8787}"
echo "➜  Portfolio Studio 运行中： http://localhost:$PORT"
echo "   按 Ctrl+C 停止"
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then
  npx --yes serve -l "$PORT" .
else
  echo "需要 python3 或 node。请先安装其一。" >&2
  exit 1
fi
