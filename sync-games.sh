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

# ~/game 하위의 모든 게임 폴더를 자동 순회 (하드코딩 목록 제거 — 새 게임 추가 시 폴더만 두면 됨).
# 숨김 폴더(.git 등)와 파일은 건너뛴다.
# index.html 없는 폴더는 게임이 아니라 공용 라이브러리(game-kit 등)이므로 동기화 제외 —
# 서빙은 어차피 games.json 등록된 게임만 하지만, 레포에 dead 파일을 두지 않는다.
for dir in "$SRC"/*/; do
  g=$(basename "$dir")
  case "$g" in .*) continue ;; esac   # 숨김 폴더 제외
  if [ ! -f "$dir/index.html" ]; then
    echo "건너뜀(게임 아님, index.html 없음): $g"
    continue
  fi
  rm -rf "games/$g"
  cp -R "$dir" "games/$g"
  rm -rf "games/$g/.git"
  echo "동기화: $g"
done

echo "완료. games.json에 새 게임 entry가 있는지 확인하고, git diff 후 커밋하세요."
