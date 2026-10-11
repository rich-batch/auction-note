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
data/categories.json                분석 분류(아파트·빌라·상가·토지·자동차) — 한 줄 추가로 새 분류
pipeline/<type>/research/<id>.md    조사 노트 (발행 안 됨)
pipeline/guide/research/<id>.eli5.json  가이드 커버 스펙 → node tools/render-eli5.mjs <스펙>
pipeline/guide/keywords.csv         가이드 글감 목록
tools/lib/                          경로·CSV·사건 데이터·분석 글 제목 규칙(title.mjs) 공통 코드
tools/analysis/                     권리분석 계산 엔진(rights.mjs)과 CLI — 필드 설명 README.md
tools/check/                        글 검사 (common.mjs 공통 + 종류별)
tools/auto/                         헤드리스 자동 글쓰기 (batch.sh → run-one.sh → PR)
layouts/_shortcodes/case-*.html     분석 글 표 (사건 데이터에서 그림)
content/analysis/_content.gotmpl    자동 생성: 월별 일정(/analysis/2026-10/), 분류 페이지(/analysis/apartment/)와 그 월별 일정
layouts/home.html                   홈: 검색 → 분류·조건 바로가기 → 경매 일정(D-day 카드, _partials/home-case-card.html) → 가이드(처음 순서는 data/home.json) → 분석 방식
layouts/_partials/calendar.html     물건 분석 일정 달력 (평일 5칸, 발행된 글만) — /analysis/ 메인이 이번 달 달력
content/results/_content.gotmpl     자동 생성: 사건별 매각 결과 페이지(/results/<사건ID>/) — 결과(result.outcome)가 있고 분석 글이 공개된 사건만. 숫자 위주라 검색·사이트맵 제외(robotsNoIndex). 분석 글 맨 위 배너(layouts/analysis/single.html)가 이 페이지로 연결
layouts/analysissearch/list.html   /analysis/search/ 물건 검색(필터·정렬은 assets/js/analysis-search.js가 브라우저에서 처리, 필터 상태는 URL 쿼리)
```

## 규칙

- **사실 → 판정 → 해설을 섞지 않는다.** 분석 글의 사실은 `data/cases/<id>.json`에만 있고(사람이 서류를 보고 입력), 말소기준권리·인수/소멸·대항력은 `tools/analysis/compute.mjs`가 계산하고, AI는 그 결과를 해설만 한다. 본문에 사건 수치 표를 직접 쓰지 않는다(`{{< case-summary >}}` 등 shortcode).
- `data/cases/*.json`의 `computed`는 손으로 고치지 않는다. 입력을 고쳤으면 `node tools/analysis/compute.mjs <id>`.
- 계산 규칙을 바꾸면 `tools/analysis/rights.test.mjs`도 고치고 `node --test tools/analysis/rights.test.mjs`를 통과시킨다.
- **저장소와 사이트는 공개 상태다.** 이름·주민번호·전화번호를 데이터·글·조사 노트에 넣지 않는다(FORBIDDEN_KEYS·정규식 검사가 막는다). 서류 원본은 `private/`(gitignore)나 저장소 밖에. 소재지(`case.region`)는 지번·동/호수를 포함한 **전체 주소**를 넣는다 — 법원경매정보·온비드가 법률상 공개하는 정보이고 기존 경매정보 서비스(탱크옥션·마당 등)도 동일하게 전체 주소를 쓴다. 사람 이름만 계속 마스킹한다.
- 일정 달력은 사건 데이터의 `sale.sale_date`(평일만 허용)와 발행된 분석 글로 자동으로 그려진다. 글이 없거나 초안이면 달력에 나오지 않는다. 칩에는 지역·분류만 보인다. 분류는 사건 데이터의 `case.category`가 원본이고, 글 주소는 분류와 무관하게 `/analysis/<사건ID>/`로 고정한다.
- 물건 검색은 발행된 분석 글 × 사건 데이터에서 자동으로 만들어진다. 인수 위험 배지는 계산 결과(`computed`)에서 나오므로 `compute.mjs`를 돌리지 않은 사건은 "확인 필요"로 보인다. 필터 항목을 늘리려면 `analysissearch/list.html`(JSON·컨트롤)과 `analysis-search.js`를 함께 고친다.
- 이미지는 글 폴더에 두고 파일명만 쓴다(`![…](cost-flow.png)`). 외부 이미지·캡처 금지.
- 다른 글 링크는 `[제목]({{< relref "/guide/<slug>" >}})`. `/guide/…`처럼 직접 쓰면 하위 경로(`/auction-note/`)가 빠져 깨진다. 발행 글에서 초안 글을 링크하면 발행 빌드가 실패한다.
- 면책 문구는 템플릿이 자동으로 붙인다(`layouts/_partials/disclaimer.html`, `disclaimer-analysis.html`). 본문에 쓰지 않는다.
- 스킬은 초안까지만: `draft: true` 유지, `[이미지 필요]`는 사람이 채운다.
- **운영자는 서류·현장 확인을 대신 할 수 없다.** 분석 글은 `[확인 필요]` 표시를 남기지 않고, 계산 도구가 사람 확인으로 넘긴 항목(review)을 `## 입찰 전 확인할 것`에 "이 글에서 확인하지 못했다 + 왜 중요한지 + 어디서 확인하는지"로 쓴다(검사가 표시를 막고, review 개수만큼 항목이 있는지 본다).
- **운영자는 글에 개인 경험을 덧붙이지 않는다.** 스킬은 `[경험 추가 필요]` 표시를 만들지 않고, 겪지 않은 경험도 지어내지 않는다. 신뢰는 공식 원문 인용, 이 블로그의 실제 분석 사례, 가정을 밝힌 계산 예시, 근거를 댄 판단 문장으로 만든다(검사가 경험 자리 표시를 막는다).
- **글은 PR로, 스킬·도구·레이아웃 개선은 main에 바로.** PR 본문의 "머지 전 확인할 것" 체크박스는 PR 검사(`.github/workflows/pr-check.yml`, `tools/pr-checklist.mjs`)가 자동으로 채우고, 글을 공개 기준으로 검사·빌드한다. **PR을 머지하면 그 PR의 글이 자동으로 `draft: false`가 되어 배포된다**(`tools/publish-merged.mjs`, PR에 `초안 유지` 라벨이 있으면 제외). main에 바로 push한 커밋에 초안 글이 들어 있어도 공개되므로 `content/`는 main에 바로 넣지 않는다.
- 발행 후 slug·사건 ID는 바꾸지 않는다(주소). 옛 `/posts/<slug>/` 주소는 가이드 글 `aliases`로 넘긴다.

## 자주 쓰는 명령

```bash
hugo server -D                                   # 로컬 미리보기 (초안 포함)
hugo -D -d /tmp/auction-note-build               # 빌드 확인 (shortcode 데이터 누락은 여기서 에러)
node .claude/skills/write-guide/render-prompt.mjs --list    # 가이드 글감과 작성 여부
node tools/analysis/status.mjs                   # 사건별 단계와 다음 할 일
node tools/analysis/new-case.mjs <id> <사건번호>  # 사건 데이터 파일 만들기 (직접 입력)
node tools/analysis/scan-onbid.mjs --date <날짜>  # 그 날 개찰하는 온비드 물건 후보 나열(등록은 안 함)
node tools/analysis/fetch-onbid.mjs <물건관리번호> # 사건 데이터 자동 조회(온비드, 최초 1회 npx playwright install chromium)
node tools/analysis/scan-court.mjs --court <코드> --date <날짜>   # 그 법원 매각공고 후보 나열(등록은 안 함, 코드 목록: --courts). --court 생략 시 data/courts-of-interest.json에 등록한 법원을 순서대로 조회(법원 전환마다 1분 지연)
node tools/analysis/scan-daily.mjs --date <날짜>  # 공매(온비드)+경매(관심 법원)를 같은 날짜로 한 번에 나열(위 두 스캔을 그대로 실행). 둘 다 분석 가치 낮은 물건(최저가 300만원 미만·공유지분)은 기본 생략 — tools/lib/candidate-filter.mjs, --min-price=0 --include-share로 전부 보기
node tools/analysis/fetch-court.mjs <법원코드> <사건번호> --sale-date <날짜>  # 사건 데이터 자동 조회(법원경매정보)
node tools/analysis/fetch-car-market.mjs <id>    # 자동차: 비슷한 차량 온비드 낙찰 사례 조회(--write로 market.trades에 반영), 자동차365·당근 입력 형식 안내
node tools/analysis/fetch-onbid-result.mjs <id> --write  # 온비드 매각 결과(분석 회차 + 이후 회차) → result. 결과 페이지·배너가 자동 갱신
node tools/analysis/fetch-court-result.mjs <id>... --write  # 법원경매 기일 내역·매각가 → result, 명세서 최선순위 설정·인수 권리 → spec_sheet(비었을 때만), 유찰 횟수 보정. 다음 회차는 콘솔에만
node tools/analysis/compute.mjs <id>             # 사건 검증·권리 계산
node --test tools/analysis/rights.test.mjs       # 계산 엔진 테스트
tools/auto/batch.sh guide 3                      # 가이드 3편 자동 초안 → PR 3개
tools/auto/batch.sh analysis 1                   # 분석 1편 자동 초안 → PR
```
