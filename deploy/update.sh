#!/usr/bin/env bash
# 更新 SillyTavern 到最新版。
# 先備份 data 目錄，再拉新 image 重啟。
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p backups
echo "==> 備份 data 到 backups/data-$STAMP.tar.gz"
tar czf "backups/data-$STAMP.tar.gz" data config

echo "==> 拉取最新 image"
docker compose pull

echo "==> 重啟"
docker compose up -d

echo "==> 清掉舊 image"
docker image prune -f

echo "==> 完成。目前版本："
docker compose exec -T sillytavern node -e "console.log(require('./package.json').version)" 2>/dev/null || true
