# auction-note (오늘의 경매 노트)

Hugo + PaperMod 경매·공매 블로그. GitHub Actions(`.github/workflows/publish.yml`)가 main push와 매일 KST 07:00에 빌드해 GitHub Pages(https://rich-batch.github.io/auction-note/)로 배포한다. 빌드 결과물은 저장소에 두지 않는다(`public/`은 gitignore).

## 글은 두 종류

| 종류 | 무엇 | 입력 | 스킬 | 검사 |
|---|---|---|---|---|
| `guide` | 개념·절차 설명 (SEO 키워드 글) | `pipeline/guide/keywords.csv` | `write-guide` | `node tools/check/guide.mjs <글>` |
| `analysis` | 실제 경매 사건 하나의 권리분석 | `data/cases/<id>.json` | `analyze-case` | `node tools/check/analysis.mjs <글>` |

사이트 전체(필수 페이지·애드센스 준비)는 `site-readiness` 스킬.

## 구조 — 글 하나 = ID 하나

가이드는 slug, 분석은 사건 ID(`seoul-central-2026ta12345`)가 폴더·파일·주소·브랜치 이름을 모두 겸한다. 경로 규칙의 원본은 `tools/lib/paths.mjs`.

```
content/<type>/<id>/index.md        발행되는 글 (page bundle — 커버·본문 이미지도 이 폴더에)
content/<type>/_index.md            섹션 목록 페이지·메뉴
data/cases/<id>.json                분석 글의 사실 원본 (사람 입력 + compute.mjs 계산 결과 + 매각 결과)
data/glossary.json                  용어 → 가이드 slug (분석 글 내부 링크)
pipeline/<type>/research/<id>.md    조사 노트 (발행 안 됨)
pipeline/guide/research/<id>.eli5.json  가이드 커버 스펙 → node tools/render-eli5.mjs <스펙>
pipeline/guide/keywords.csv         가이드 글감 목록
tools/lib/                          경로·CSV·사건 데이터 공통 코드
tools/analysis/                     권리분석 계산 엔진(rights.mjs)과 CLI — 필드 설명 README.md
tools/check/                        글 검사 (common.mjs 공통 + 종류별)
tools/auto/                         헤드리스 자동 글쓰기 (batch.sh → run-one.sh → PR)
layouts/_shortcodes/case-*.html     분석 글 표 (사건 데이터에서 그림)
```

## 규칙

- **사실 → 판정 → 해설을 섞지 않는다.** 분석 글의 사실은 `data/cases/<id>.json`에만 있고(사람이 서류를 보고 입력), 말소기준권리·인수/소멸·대항력은 `tools/analysis/compute.mjs`가 계산하고, AI는 그 결과를 해설만 한다. 본문에 사건 수치 표를 직접 쓰지 않는다(`{{< case-summary >}}` 등 shortcode).
- `data/cases/*.json`의 `computed`는 손으로 고치지 않는다. 입력을 고쳤으면 `node tools/analysis/compute.mjs <id>`.
- 계산 규칙을 바꾸면 `tools/analysis/rights.test.mjs`도 고치고 `node --test tools/analysis/rights.test.mjs`를 통과시킨다.
- **저장소와 사이트는 공개 상태다.** 이름·주민번호·전화번호·번지·동호수를 데이터·글·조사 노트에 넣지 않는다. 서류 원본은 `private/`(gitignore)나 저장소 밖에.
- 이미지는 글 폴더에 두고 파일명만 쓴다(`![…](cost-flow.png)`). 외부 이미지·캡처 금지.
- 다른 글 링크는 `[제목]({{< relref "/guide/<slug>" >}})`. `/guide/…`처럼 직접 쓰면 하위 경로(`/auction-note/`)가 빠져 깨진다. 발행 글에서 초안 글을 링크하면 발행 빌드가 실패한다.
- 면책 문구는 템플릿이 자동으로 붙인다(`layouts/_partials/disclaimer.html`, `disclaimer-analysis.html`). 본문에 쓰지 않는다.
- 스킬은 초안까지만: `draft: true` 유지, `[경험 추가 필요]`·`[확인 필요]`·`[이미지 필요]`는 사람이 채운다. 커밋·푸시·`draft: false`는 사람이 한다.
- 발행 후 slug·사건 ID는 바꾸지 않는다(주소). 옛 `/posts/<slug>/` 주소는 가이드 글 `aliases`로 넘긴다.

## 자주 쓰는 명령

```bash
hugo server -D                                   # 로컬 미리보기 (초안 포함)
hugo -D -d /tmp/auction-note-build               # 빌드 확인 (shortcode 데이터 누락은 여기서 에러)
node .claude/skills/write-guide/render-prompt.mjs --list    # 가이드 글감과 작성 여부
node tools/analysis/status.mjs                   # 사건별 단계와 다음 할 일
node tools/analysis/new-case.mjs <id> <사건번호>  # 사건 데이터 파일 만들기
node tools/analysis/compute.mjs <id>             # 사건 검증·권리 계산
node --test tools/analysis/rights.test.mjs       # 계산 엔진 테스트
tools/auto/batch.sh guide 3                      # 가이드 3편 자동 초안 → PR 3개
tools/auto/batch.sh analysis 1                   # 분석 1편 자동 초안 → PR
```
