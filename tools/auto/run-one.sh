#!/usr/bin/env bash
# 글 초안 1편을 헤드리스 클로드 코드(claude -p)로 만들어 PR을 올린다.
# 클로드 API 토큰이 아니라 이 컴퓨터에 로그인된 클로드 코드 구독 세션을 쓴다.
# 스킬은 "초안까지만" 만든다([확인 필요] 자리 남김, draft: true 유지, 커밋·푸시 안 함). 경험 자리 표시는 만들지 않는다.
# 여기서는 PR만 올린다. 사람이 PR의 체크박스를 다 확인하고 머지하면 그때 자동으로 공개·배포된다.
#
# 사용법: tools/auto/run-one.sh <guide|analysis> <id>
#   guide    id = keywords.csv의 slug          (write-guide 스킬)
#   analysis id = data/cases/<id>.json의 사건 ID (analyze-case 스킬)
# 대상을 고르는 일은 batch.sh가 한다(tools/pending.mjs).

set -euo pipefail

TYPE="${1:-}"
ID="${2:-}"
if [[ "$TYPE" != "guide" && "$TYPE" != "analysis" ]] || [ -z "$ID" ]; then
  echo "사용법: $0 <guide|analysis> <id>" >&2
  exit 2
fi

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_FILE="$REPO_DIR/tools/auto/auto-write.log"
cd "$REPO_DIR"
exec >> "$LOG_FILE" 2>&1
echo ""
echo "===== $(date '+%Y-%m-%d %H:%M:%S') 자동 글쓰기 시작 ($TYPE/$ID) ====="

# 1) main을 최신으로 맞추고 작업 브랜치를 만든다. 브랜치 이름에 ID가 들어가 batch.sh가 중복 PR을 거른다.
git checkout main
git pull origin main
BRANCH="auto/$TYPE/$ID-$(date '+%Y%m%d-%H%M%S')"
git checkout -b "$BRANCH"

# 2) 종류별 지시문·스테이징 경로·PR 체크리스트
if [ "$TYPE" = "guide" ]; then
  LABEL="가이드"
  PROMPT="write-guide 스킬로 새 글 1편을 작성해줘 (기본 --type info). 대상: render-prompt.mjs --slug $ID 한 편만. 다른 글은 절대 건드리지 마라.
0단계 조사 → 1단계 글쓰기 → ELI5 커버 이미지 생성 → 2단계 셀프 리뷰 → tools/check/guide.mjs 검사와 FAIL 수정까지,
스킬 지시를 사람에게 되묻지 말고 끝까지 진행해라. 사람이 확인해야 할 사실은 [확인 필요: …] 표시만 남기고(경험 자리 표시는 만들지 마라),
draft는 true로 유지하고 커밋이나 푸시는 하지 마라. 이미 있는 슬러그라 SKIPPED로 건너뛰게 되면 그렇다고만 보고하고 끝내라."
  PATHS=(content/guide pipeline/guide)
else
  LABEL="분석"
  PROMPT="analyze-case 스킬로 사건 $ID 의 분석 글 1편을 작성해줘. 대상: render-prompt.mjs --case $ID 한 건만. 다른 글·다른 사건 데이터는 절대 건드리지 마라.
compute.mjs 확인 → 0단계 조사 노트 → 1단계 글쓰기 → 2단계 셀프 리뷰 → tools/check/analysis.mjs 검사와 FAIL 수정까지,
스킬 지시를 사람에게 되묻지 말고 끝까지 진행해라. data/cases/$ID.json의 입력값은 고치지 마라(INVALID면 그렇다고만 보고하고 끝내라).
확인이 필요한 부분은 [확인 필요: …] 표시만 남기고, draft는 true로 유지하고 커밋이나 푸시는 하지 마라."
  PATHS=(content/analysis pipeline/analysis data/cases)
fi

# 3) 헤드리스 클로드 코드 실행.
#    --dangerously-skip-permissions: 사람이 없어 승인 프롬프트에 응답할 수 없으므로 필수.
#    --disallowedTools: 위험한 git 명령과 rm -rf는 막는다(커밋·푸시는 이 스크립트가 담당).
claude -p "$PROMPT" \
  --dangerously-skip-permissions \
  --disallowedTools "Bash(git push*)" "Bash(git commit*)" "Bash(git reset*)" "Bash(git checkout*)" "Bash(rm -rf*)" \
  --output-format text

# 4) 변경 사항이 없으면(SKIPPED·INVALID·실패) 브랜치를 정리하고 종료
if [ -z "$(git status --porcelain -- "${PATHS[@]}")" ]; then
  echo "생성된 변경 사항 없음 (SKIPPED/INVALID 또는 실패). 브랜치 정리 후 종료."
  git checkout main
  git branch -D "$BRANCH"
  exit 0
fi

# 5) 이 종류의 산출물 경로만 스테이징 (git add -A 금지)
git add -- "${PATHS[@]}"
git commit -m "[$LABEL] $ID 초안 자동 생성 (검토 필요)

로컬 스케줄러가 헤드리스 claude -p로 만든 초안입니다.
PR을 머지하면 자동으로 공개·배포됩니다(.github/workflows/publish.yml)."
git push -u origin "$BRANCH"

# PR 본문 = 머지 전 확인할 것(체크박스). 글 속 [확인 필요] 하나하나가 칸이 된다.
# PR 검사(.github/workflows/pr-check.yml)가 커밋이 추가될 때마다 같은 목록을 다시 채운다(체크한 칸은 유지).
BODY_FILE="$(mktemp)"
node tools/pr-checklist.mjs origin/main > "$BODY_FILE"
gh pr create \
  --title "[자동 초안][$LABEL] $ID" \
  --base main \
  --head "$BRANCH" \
  --body-file "$BODY_FILE"
rm -f "$BODY_FILE"

# 6) 다음 실행에 방해되지 않도록 main으로 되돌린다
git checkout main
echo "===== $(date '+%Y-%m-%d %H:%M:%S') 완료: PR 생성됨 ($BRANCH) ====="
