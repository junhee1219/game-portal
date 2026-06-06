#!/bin/bash
# ~/game 원본 → games/ 스냅샷 갱신 (로컬에서 실행)
# 게임 원본이 업데이트됐을 때 통째로 교체한다. .git은 제외.
set -e
cd "$(dirname "$0")"

SRC="${1:-$HOME/game}"
if [ ! -d "$SRC" ]; then
  echo "원본 폴더 없음: $SRC"
  exit 1
fi

for g in cube gateway vase; do
  if [ -d "$SRC/$g" ]; then
    rm -rf "games/$g"
    cp -R "$SRC/$g" "games/$g"
    rm -rf "games/$g/.git"
    echo "동기화: $g"
  fi
done

echo "완료. git diff 확인 후 커밋하세요."
