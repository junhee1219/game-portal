#!/bin/bash
# 게임 포털 배포 스크립트 (서버에서 실행)
# git pull → 의존성 → systemd 재시작 → 헬스체크
set -e
cd "$(dirname "$0")"

echo "[1/4] git pull"
git pull

echo "[2/4] 의존성 설치"
if [ ! -d venv ]; then
  python3 -m venv venv
fi
venv/bin/pip install -q -r requirements.txt

echo "[3/4] 서비스 재시작"
sudo systemctl restart game-portal

echo "[4/4] 헬스체크"
sleep 2
for i in 1 2 3 4 5; do
  if curl -sf http://127.0.0.1:8200/health > /dev/null; then
    echo "OK — game-portal 기동 완료 (port 8200)"
    exit 0
  fi
  sleep 2
done
echo "FAIL — 헬스체크 실패. journalctl -u game-portal -n 50 확인"
exit 1
