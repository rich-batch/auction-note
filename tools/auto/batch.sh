#!/usr/bin/env bash
# 아직 글이 없는 대상을 N개 골라 run-one.sh를 순서대로(동시 실행 아님) 호출한다.
# 이미 열린 PR이 그 글 파일을 건드리고 있으면 건너뛴다(구조 개편 전 content/posts/<slug>.md PR도 인식).
#
# 사용법: tools/auto/batch.sh <guide|analysis> [편수]
# 예:     tools/auto/batch.sh guide 3
#         tools/auto/batch.sh analysis 1
# launchd(com.auction-note.autowrite.plist)는 매일 "batch.sh guide 1"을 실행한다.

set -euo pipefail

TYPE="${1:-}"
COUNT="${2:-1}"
if [[ "$TYPE" != "guide" && "$TYPE" != "analysis" ]]; then
  echo "사용법: $0 <guide|analysis> [편수]" >&2
  exit 2
fi

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_DIR"

git checkout main
git pull origin main

OPEN_FILES=$(gh pr list --state open --limit 200 --json files --jq '.[].files[].path' 2>/dev/null || true)

# 열린 PR이 있는 것을 빼고도 COUNT개가 되도록 넉넉히 뽑는다
TARGETS=()
while IFS= read -r ID; do
  [ -z "$ID" ] && continue
  if grep -qE "^content/$TYPE/$ID/|^content/posts/$ID\.md$" <<< "$OPEN_FILES"; then
    echo "건너뜀: $ID (열린 PR 있음)"
    continue
  fi
  TARGETS+=("$ID")
  [ "${#TARGETS[@]}" -ge "$COUNT" ] && break
done < <(node tools/pending.mjs "$TYPE" 1000)

if [ "${#TARGETS[@]}" -eq 0 ]; then
  echo "새로 쓸 $TYPE 대상이 없습니다."
  exit 0
fi

echo "이번 배치 대상($TYPE): ${TARGETS[*]}"
for ID in "${TARGETS[@]}"; do
  echo ">>> $TYPE/$ID 시작"
  if "$REPO_DIR/tools/auto/run-one.sh" "$TYPE" "$ID"; then
    echo ">>> $TYPE/$ID 완료"
  else
    echo ">>> $TYPE/$ID 실패 — tools/auto/auto-write.log 확인 후 이 편만 다시: tools/auto/run-one.sh $TYPE $ID"
    git checkout main 2>/dev/null || true
  fi
done

echo "배치 종료. 열린 자동 초안 PR:"
gh pr list --state open --json number,title,url \
  --jq '.[] | select(.title | startswith("[자동 초안]")) | "#\(.number)  \(.title)  \(.url)"'
