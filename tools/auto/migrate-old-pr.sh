#!/usr/bin/env bash
# 구조 개편(content/posts → content/guide/<slug>/) 전에 열린 자동 초안 PR을 새 구조로 옮긴다. 옛 PR을 다 옮기면 이 파일은 지운다.
#
# 구조 개편이 main에 들어간 뒤에 실행한다. 옛 PR 브랜치에서 글 파일만 가져와 main 기반 새 브랜치에 새 경로로 옮기고
# (cover·[이미지 필요]·내부 링크 경로 수정), 검사 결과를 보여 준다. 기본은 로컬에서만 하고,
# --push를 주면 새 브랜치를 올려 새 PR을 만들고 옛 PR은 닫는다(옛 브랜치는 지우지 않는다).
#
# 사용법: tools/auto/migrate-old-pr.sh <PR 번호> [--push]

set -euo pipefail
PR="${1:-}"
PUSH="${2:-}"
[ -z "$PR" ] && { echo "사용법: $0 <PR 번호> [--push]" >&2; exit 2; }

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_DIR"
[ -n "$(git status --porcelain)" ] && { echo "작업 트리에 커밋 안 된 변경이 있음. 정리 후 실행" >&2; exit 1; }
[ -d content/guide ] || { echo "main에 구조 개편이 아직 없음" >&2; exit 1; }

OLD_BRANCH=$(gh pr view "$PR" --json headRefName --jq .headRefName)
FILES=$(gh pr view "$PR" --json files --jq '.files[].path')
POST=$(grep -E '^content/posts/[a-z0-9-]+\.md$' <<< "$FILES" | head -1 || true)
[ -z "$POST" ] && { echo "PR #${PR}에 content/posts/<slug>.md가 없음 — 옛 구조 PR이 아님" >&2; exit 1; }
SLUG=$(basename "$POST" .md)

git fetch origin main "$OLD_BRANCH"
NEW_BRANCH="auto/guide/$SLUG-migrated"
git checkout -B "$NEW_BRANCH" origin/main

# 옛 브랜치의 파일을 새 경로로 복사
mkdir -p "content/guide/$SLUG" pipeline/guide/research
git show "origin/${OLD_BRANCH}:${POST}" > "content/guide/$SLUG/index.md"
while IFS= read -r f; do
  case "$f" in
    assets/images/$SLUG/*) git show "origin/${OLD_BRANCH}:${f}" > "content/guide/$SLUG/$(basename "$f")" ;;
    research/*) git show "origin/${OLD_BRANCH}:${f}" > "pipeline/guide/research/$(basename "$f")" ;;
  esac
done <<< "$FILES"

# 경로 규칙 바꾸기: 커버, 이미지 자리표시자, 본문 이미지, 옛 내부 링크
python3 - "content/guide/$SLUG/index.md" "$SLUG" <<'PY'
import re, sys
f, slug = sys.argv[1], sys.argv[2]
t = open(f, encoding='utf-8').read()
t = t.replace(f'image: "images/{slug}/eli5-overview.png"', 'image: "eli5-overview.png"')
t = t.replace(f'[이미지 필요: images/{slug}/', '[이미지 필요: ')
t = re.sub(rf'\]\(images/{slug}/([^)]+)\)', r'](\1)', t)
t = re.sub(r'\]\(/posts/([a-z0-9-]+)/?\)', r']({{< relref "/guide/\1" >}})', t)
open(f, 'w', encoding='utf-8').write(t)
PY

echo "== 검사"
node tools/check/guide.mjs "content/guide/$SLUG/index.md" || true

git add "content/guide/$SLUG" pipeline/guide/research
git commit -q -m "[가이드] $SLUG 초안 (PR #${PR}을 새 구조로 이전)"
echo "로컬 브랜치 ${NEW_BRANCH}에 커밋함."

if [ "$PUSH" = "--push" ]; then
  git push -u origin "$NEW_BRANCH"
  BODY=$(gh pr view "$PR" --json body --jq .body)
  NEW_URL=$(gh pr create --title "[자동 초안][가이드] $SLUG" --base main --head "$NEW_BRANCH" \
    --body "#${PR}을 새 디렉터리 구조(content/guide/<slug>/)로 옮긴 PR입니다. 내용은 그대로입니다.

$BODY")
  gh pr close "$PR" --comment "구조 개편으로 $NEW_URL 로 옮겼습니다."
  echo "새 PR: $NEW_URL (옛 PR #$PR 닫음)"
fi
git checkout -q main
