#!/usr/bin/env bash
# 在一台全新的 Ubuntu 22.04 / 24.04 上裝好 Docker 和防火牆。
# 用法（用 root 或有 sudo 的帳號執行）：
#   bash deploy/bootstrap-ubuntu.sh
set -euo pipefail

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

echo "==> 更新套件清單"
$SUDO apt-get update -y
$SUDO apt-get upgrade -y

echo "==> 安裝 Docker"
if ! command -v docker >/dev/null 2>&1; then
    $SUDO apt-get install -y ca-certificates curl
    $SUDO install -m 0755 -d /etc/apt/keyrings
    $SUDO curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    $SUDO chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        | $SUDO tee /etc/apt/sources.list.d/docker.list > /dev/null
    $SUDO apt-get update -y
    $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
    echo "    Docker 已存在，跳過"
fi

echo "==> 讓目前使用者不用 sudo 就能跑 docker"
if [ -n "$SUDO" ]; then
    $SUDO usermod -aG docker "$USER" || true
    echo "    已加入 docker 群組，要重新登入一次才會生效"
fi

echo "==> 設定防火牆（只開 SSH / HTTP / HTTPS）"
if command -v ufw >/dev/null 2>&1; then
    $SUDO ufw allow OpenSSH
    $SUDO ufw allow 80/tcp
    $SUDO ufw allow 443/tcp
    $SUDO ufw allow 443/udp
    $SUDO ufw --force enable
    $SUDO ufw status
fi

# Oracle Cloud / 部分 VPS 有額外的 iptables 規則會擋掉 80/443，
# 這裡補上，不然 Caddy 申請憑證會失敗。
if command -v iptables >/dev/null 2>&1 && $SUDO iptables -L INPUT -n | grep -q REJECT; then
    echo "==> 偵測到 iptables REJECT 規則，補開 80/443"
    $SUDO iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
    $SUDO iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
    $SUDO iptables -I INPUT 1 -p udp --dport 443 -j ACCEPT
    if command -v netfilter-persistent >/dev/null 2>&1; then
        $SUDO netfilter-persistent save || true
    fi
fi

echo
echo "==> 完成。接下來："
echo "    1. cp .env.example .env  然後把網域和密碼填好"
echo "    2. docker compose up -d"
echo "    3. docker compose logs -f"
