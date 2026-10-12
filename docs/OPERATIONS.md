# 운영자 가이드

오늘의 경매 노트(https://rich-batch.github.io/auction-note/)를 **매일 굴리는 사람**을 위한 문서다.
명령 하나하나의 옵션보다 "언제, 무엇을, 어떤 순서로, 무엇을 확인하고" 하는지에 집중한다.

- 저장소 구조·작성 규칙의 원본: [CLAUDE.md](../CLAUDE.md)
- 사건 데이터 필드 설명: [tools/analysis/README.md](../tools/analysis/README.md)
- 빠른 시작: [README.md](../README.md)

> 이 문서는 `docs/`에 있어 사이트에 발행되지 않는다(Hugo는 `content/`만 발행).

---

## 1. 운영 구조 한눈에 보기

이 블로그는 **사람·스크립트·AI·GitHub Actions**가 일을 나눠 맡는다. 운영자의 일은 "AI와 스크립트가 만든 것을 확인하고, 사람만 할 수 있는 것을 채우고, 발행 버튼을 누르는 것"이다.

| 누가 | 하는 일 | 하지 않는 일 |
|---|---|---|
| **스크립트** (`tools/`) | 후보 물건 조회, 사건 데이터 자동 입력, 권리 계산, 글 검사 | 판단·글쓰기 |
| **계산 엔진** (`compute.mjs`) | 말소기준권리·인수/소멸·대항력·점수 판정 | 서류에 없는 사실 추정 |
| **AI** (Claude 스킬) | 조사 노트, 초안 작성, 셀프 리뷰, 검사 FAIL 수정 | 사실 입력, 커밋·푸시, `draft: false` |
| **운영자** (사람) | 공개 자료(매각물건명세서·현황조사서·공매재산명세)로 사건 데이터 보완, PR 체크박스 확인·머지(=발행) | `computed` 손으로 고치기, 유료 등기부 열람(이 블로그는 보지 않는다) |
| **GitHub Actions** | main push 시 + 매일 KST 07:00 빌드·배포 | 초안 발행 |

### 운영의 3대 원칙

1. **사실 → 판정 → 해설을 섞지 않는다.** 사실은 `data/cases/<id>.json`에만, 판정은 `compute.mjs`만, 해설은 글 본문에만.
2. **저장소와 사이트는 공개다.** 사람 이름·주민번호·전화번호는 어디에도 넣지 않는다. 서류 원본은 `private/`(gitignore) 또는 저장소 밖에.
3. **발행 결정은 사람만 한다.** 자동화는 `draft: true` 초안 PR까지만 만든다.

---

## 2. 처음 한 번 하는 세팅

### 2.1 설치

| 도구 | 용도 | 확인 |
|---|---|---|
| Hugo **Extended** | 사이트 빌드 | `hugo version` (extended 표시) |
| Node.js 20+ | 모든 `tools/` 스크립트 | `node -v` |
| GitHub CLI (`gh`) | 자동 초안 PR 생성 | `gh auth status` |
| Claude Code (`claude`) | 스킬·헤드리스 자동 글쓰기 | `claude --version` (구독 로그인 상태) |
| git 서브모듈 | PaperMod 테마 | `git submodule update --init` |

```bash
npm install
```

```bash
npx playwright install chromium
```

`npm install`은 Playwright·`court-auction-notice-search`·`xlsx`를 설치한다. Playwright 브라우저는 온비드 조회·국토부 실거래가 대체 경로에만 필요하다.

### 2.2 GitHub 설정

- Settings → Pages → Source가 **GitHub Actions**인지 확인 (아니면 배포가 안 된다)
- Actions 탭에서 "Build and Deploy" 워크플로가 켜져 있는지 확인

### 2.3 자동 글쓰기 스케줄러 (선택)

맥에서 매일 06:00에 가이드 초안 1편을 PR로 올린다.

```bash
cp tools/auto/com.auction-note.autowrite.plist ~/Library/LaunchAgents/
```

```bash
launchctl load ~/Library/LaunchAgents/com.auction-note.autowrite.plist
```

- 해제: `launchctl unload ~/Library/LaunchAgents/com.auction-note.autowrite.plist`
- **맥이 06:00에 잠들어 있으면 그날은 건너뛴다**(깨어나도 보충 실행 안 함).
- 분석 글도 매일 자동으로 돌리려면 `batch.sh analysis 1`을 실행하는 plist를 하나 더 만든다(Label을 다르게).
- plist에는 이 컴퓨터의 절대 경로가 들어 있다. 다른 맥으로 옮기면 경로를 고친다.

### 2.4 관심 법원 정하기

`data/courts-of-interest.json`의 `courts` 배열이 법원경매 스캔 대상이다. 현재 수도권 12개 법원이 들어 있다.

- 법원 하나를 옮길 때마다 1분씩 쉰다 → 12개면 한 번 스캔에 **최소 10분 이상** 걸린다.
- 많이 넣을수록 법원경매정보 차단 위험이 커진다. **실제로 글을 쓸 법원만** 남기는 것을 권장한다.
- 코드 목록: `node tools/analysis/scan-court.mjs --courts`

---

## 3. 일일 루틴 (약 30~60분)

매일 같은 순서로 하면 놓치는 게 없다.

### ① 상태 확인 (1분)

```bash
node tools/analysis/status.mjs
```

사건마다 지금 단계와 다음 할 일이 나온다. 단계 의미는 [5.1](#51-사건의-수명주기-단계)을 본다.
**"결과 입력 필요"와 매각기일이 임박한 "검토 대기"를 먼저 처리한다** — 둘 다 시간이 지나면 의미가 줄어든다.

### ② 밤사이 자동 초안 PR 확인 (5~20분)

```bash
gh pr list --state open
```

`[자동 초안]` PR을 열어 [7. 발행 절차](#7-발행-절차-pr-리뷰)의 체크리스트대로 검토한다. 실패했으면 `tools/auto/auto-write.log`를 본다([9.3](#93-실패했을-때)).

### ③ 매각 결과 입력 (사건당 2분)

"결과 입력 필요" 사건의 결과를 넣는다 → [8. 매각 결과 입력](#8-매각-결과-입력).

### ④ 새 물건 찾기 (주 2~3회면 충분)

1~2주 뒤 매각기일을 기준으로 후보를 본다(온비드 배분요구현황은 입찰 7일 전부터 공개되므로 너무 이르면 정보가 비어 있다).

```bash
node tools/analysis/scan-daily.mjs --date 2026-10-20
```

후보 목록만 나온다(등록하지 않음). 분석할 물건을 고르는 기준:

- 권리관계가 **설명할 거리가 있는** 물건(선순위 임차인, 유찰 여러 번, 특수 조건) — 너무 단순하면 글이 얇다
- 사진·시세 비교가 가능한 아파트·빌라가 독자 반응이 좋다
- 최저가 300만원 미만·공유지분은 기본으로 빠진다(계산 엔진이 잘 안 맞는 구간)

### ⑤ 확인 (1분)

일과 끝에 다시 `status.mjs`로 단계가 의도대로 넘어갔는지 본다.

---

## 4. 주간·월간 루틴

| 주기 | 할 일 | 명령·위치 |
|---|---|---|
| 주 1회 | 가이드 글감 목록 점검(새 키워드 추가, 우선순위 조정) | `pipeline/guide/keywords.csv`, `node .claude/skills/write-guide/render-prompt.mjs --list` |
| 주 1회 | 사이트 실제 화면 확인(달력·검색·분류 페이지, 모바일) | https://rich-batch.github.io/auction-note/ |
| 주 1회 | 계산 엔진 테스트 | `node --test tools/analysis/rights.test.mjs` |
| 월 1회 | 가이드 수치 갱신 점검(금리·한도·세율 등 바뀌는 숫자) | write-guide 스킬 "갱신 점검", `node tools/check/guide.mjs <글> --facts` |
| 월 1회 | 발행 글 링크 확인 | `node tools/check/guide.mjs <글> --verify-links` |
| 월 1회 | 애드센스 준비 상태 점검 | site-readiness 스킬 |
| 수시 | 자동화 로그 정리 | `tools/auto/auto-write.log` (gitignore, 커지면 비움) |

---

## 5. 분석 글 운영 (핵심 업무)

### 5.1 사건의 수명주기 (단계)

단계는 파일에 적혀 있지 않고 `status.mjs`가 매번 계산한다.

```
계산 필요 → 글 작성 대기 → 검토 대기 → 발행됨 → 결과 입력 필요 → 종료
```

| 단계 | 뜻 | 운영자가 할 일 |
|---|---|---|
| **계산 필요** | 입력이 검증을 통과하지 못했거나, 입력을 고친 뒤 다시 계산하지 않음 | 빠진 필드 채우기 → `compute.mjs` |
| **글 작성 대기** | 계산 완료, 글 폴더 없음 | AI에게 글 작성 맡기기 |
| **검토 대기** | 글이 `draft: true` | PR 체크박스 확인 → 머지(머지하면 자동으로 `draft: false`) |
| **발행됨** | 사이트에 노출 중, 매각기일 전 | 매각기일 전 변경·취하 여부만 확인 |
| **결과 입력 필요** | 매각기일이 지났는데 `result.outcome` 없음 | 매각 결과 입력 |
| **종료** | 결과까지 입력됨 | 없음 |

### 5.2 사건 등록

사건 ID 규칙(파일·글 폴더·주소를 모두 겸하고, **발행 후 바꾸지 않는다**):

- 법원경매: `<법원>-<연도>ta<번호>[-<물건번호>]` → `seoul-central-2026ta12345`
- 온비드: `onbid-<물건관리번호 숫자만>` → `onbid-20220200007090`

**온비드 공매**

```bash
node tools/analysis/fetch-onbid.mjs 2026-0700-036408
```

- 압류재산·국유재산·공유재산·기타일반재산은 온비드 표시대로 자동 인식된다.
- 위임기관에 "신탁"이 있으면 스크립트가 `--type=trust`로 다시 실행하라고 안내한다 → 신탁공매는 **`case.trust_registered_on`(신탁등기 접수일)**이 있어야 계산된다. 등기부는 유료라 보지 않으므로 온비드 공고·공매재산명세에 신탁등기일이 공개돼 있을 때만 분석하고, 없으면 분석 대상에서 뺀다.
- **압류재산 부동산은 `rights[]`·`tenants[]`까지 자동으로 채워진다.** 다만 온비드가 옮겨 적은 *요약*이라 `special[]`에 남은 검토 항목은 꼭 본다.
- 입찰 시작 7일 전 이전에 등록했다면 배분요구 여부가 비어 있다 → **7일 이내가 되면 다시 조회**하거나 온비드 화면과 대조해 채운다.
- 최저입찰가가 "비공개"면 `sale.minimum`을 직접 넣는다.

**법원경매**

```bash
node tools/analysis/fetch-court.mjs B000210 2026타경12345 --sale-date 2026-10-20
```

```bash
node tools/analysis/fetch-court-docs.mjs seoul-central-2026ta12345
node tools/analysis/fetch-court-result.mjs seoul-central-2026ta12345 --write
```

- 첫 명령이 감정가·최저가·소재지·배당요구종기·청구금액까지 채운다.
- 두 번째가 현황조사서에서 점유관계·전입일(`tenants[]`)을 채운다. 보증금·확정일자·배당요구는 미상(`null`)으로 남는다 — 0으로 채우지 않는다.
- 세 번째가 물건상세의 매각물건명세서 요약에서 **`rights[0]`(말소기준권리 날짜·종류)·`spec_sheet`(최선순위 설정·소멸되지 않는 권리)·전용면적·유찰 횟수**를 채운다. 등기사항전부증명서는 유료라 보지 않는다 — 금액·후순위 등기는 글에서 "확인하지 못했다"로 남고 독자가 인터넷등기소에서 확인한다. 물건상세는 매각되면 닫히니 매각기일 전에 돌린다.
- 보증금·확정일자·배당요구 여부는 매각물건명세서에서 확인해 `tenants[]`에 보탠다.

**직접 입력(자동 조회가 안 되는 경우)**

```bash
node tools/analysis/new-case.mjs seoul-central-2026ta12345 2026타경12345 apartment
```

분류: `apartment` `villa` `commercial` `land` `car`.

### 5.3 사람이 채우는 필드 — 어디서 보나

| 필드 | 서류 | 주의 |
|---|---|---|
| `rights[]` | 공개 요약에서 옮긴 등기(법원경매: 명세서 최선순위 설정, 온비드: 공개 등기 요약). 등기사항전부증명서는 유료라 보지 않는다. 자동차는 자동차등록원부 | 같은 날 접수가 여럿이면 `receipt_no` 필수. 권리자는 `holder_type`(은행·개인 등)만, 이름 금지 |
| `tenants[]` | 매각물건명세서 + 현황조사서 | 전입일을 모르면 비워 둔다(→ review). 임대차 *기간*을 전입일로 쓰지 않는다 |
| `special[]` | 매각물건명세서 비고, 유치권 신고 등 | 등기로 판단 못 하는 건 전부 여기. 모두 review로 간다 |
| `spec_sheet.*` | 매각물건명세서 "최선순위 설정"·"소멸되지 않는 권리" 칸 그대로 | 계산 결과와 대조하는 용도 |
| `market.trades[]` | 국토부 실거래가(부동산), 온비드 낙찰·자동차365·당근(자동차) | 같은 단지·전용면적 ±5%만(`fetch-market --write`가 이 기준으로 넣는다). 가격 수준 별점이 이 평균과 최저가로 정해진다 |
| `source.checked_at` | 서류를 본 날 | 글의 "기준일"이 된다 |

시세 후보:

```bash
node tools/analysis/fetch-market.mjs seoul-central-2026ta12345 --write
node tools/analysis/fetch-car-market.mjs onbid-202614156001 --write      # 자동차: 온비드 낙찰 사례
```

- 부동산: 같은 단지(단지명 또는 법정동+지번)이면서 전용면적 ±5%인 최근 1년 거래만 넣는다(`case.area_m2` 필요). 단지명 표기가 많이 다르면 `--name <단지명 일부>`. `--write` 없이 돌리면 후보만 보여 준다. 아파트 외 유형은 프록시가 실패하면 대체 경로가 없다.
- 자동차: 온비드 낙찰 사례만 자동. 자동차365·당근은 로그인이 필요해 사람이 넣는다.
- 같은 단지 거래가 1년 안에 없으면 비워 둔다 — 가격 수준 별점은 감정가 대비로 매겨지고, 글은 "시세를 확인하지 못했다"로 쓴다.

### 5.4 계산

```bash
node tools/analysis/compute.mjs seoul-central-2026ta12345
```

- 검증에 실패하면 무엇이 틀렸는지 알려 준다 → 입력을 고치고 다시 실행.
- **`computed`는 절대 손으로 고치지 않는다.** 결과가 이상하면 입력을 다시 보거나, 엔진 버그면 [10.4](#104-계산-규칙을-바꿀-때) 절차로.
- 입력을 조금이라도 고치면 `computed.input_hash`가 어긋나 "계산 필요"로 돌아간다 → 다시 실행.
- 결과를 `spec_sheet`(매각물건명세서 원문)와 눈으로 대조한다. 말소기준권리가 다르면 입력 누락을 의심한다.

여러 건을 한 번에 계산할 때:

```bash
for id in seoul-nambu-2026ta141 seoul-nambu-2026ta3367; do node tools/analysis/compute.mjs "$id"; done
```

### 5.5 글 작성 (AI)

방법 셋 중 하나:

| 방법 | 언제 | 어떻게 |
|---|---|---|
| Claude Code 대화 | 한두 건, 과정을 보고 싶을 때 | "`<id>` 분석 써줘" (analyze-case 스킬) |
| 한 건 자동 → PR | 맡겨 두고 PR로 받고 싶을 때 | `tools/auto/run-one.sh analysis <id>` |
| 여러 건 자동 → PR | 대기 건이 많을 때 | `tools/auto/batch.sh analysis 3` (매각기일 가까운 순, 매각기일 지난 건 제외) |

AI는 조사 노트(`pipeline/analysis/research/<id>.md`) → 초안 → 셀프 리뷰 → 검사 FAIL 수정까지 하고 `draft: true`로 멈춘다.
**토큰 절약:** 등록·계산은 셸 반복문으로 직접, 글쓰기만 AI에게(자세한 건 analyze-case 스킬 문서).

### 5.6 검토 (사람)

[7. 발행 절차](#7-발행-절차-pr-리뷰)의 분석 글 체크리스트를 따른다.

### 5.7 발행 후 ~ 매각기일

- 매각기일 전날쯤 법원경매정보·온비드에서 **변경·취하·연기 여부**를 확인한다.
- 매각기일이 바뀌었으면 `sale.sale_date`를 고치고 `compute.mjs`를 다시 돌린다(달력 위치가 바뀐다). 평일만 허용된다.
- 취하·변경이면 매각기일이 지난 뒤 `result.outcome`에 `취하`/`변경`을 넣는다.

---

## 6. 가이드 글 운영

### 6.1 글감 관리

`pipeline/guide/keywords.csv`가 글감 목록이다. `priority` 순으로 자동 글쓰기 대상이 된다.

| 열 | 뜻 |
|---|---|
| `priority` | 작을수록 먼저 |
| `keyword` / `slug` | 검색 키워드 / 글 주소(발행 후 변경 금지) |
| `category` / `seed` / `intent` | 분류, 상위 키워드, 정보형·실행형·비교형 |
| `suggested_title` / `notes` | 제목안, 다룰 범위·다른 글과 겹침 방지 메모 |
| `my_experience` | 운영자 경험 메모 — 지금은 비워 둔다(비어 있으면 경험 문장을 쓰지 않는다) |

작성 여부 확인:

```bash
node .claude/skills/write-guide/render-prompt.mjs --list
```

### 6.2 작성

- 대화: "priority 12 써줘", "다음 글" (write-guide 스킬)
- 자동: `tools/auto/batch.sh guide 3` (매일 06:00 launchd가 1편씩)

AI가 공식 자료 조사 → 초안 → ELI5 커버 이미지 → AI 흔적 셀프 리뷰 → 검사까지 한다.

### 6.3 운영자가 꼭 채우는 것

- **경험은 넣지 않는다.** 스킬이 `[경험 추가 필요]` 자리를 만들지 않는다. 대신 글이 공식 원문 인용, 이 블로그의 실제 분석 사례, 가정을 밝힌 계산 예시로 뒷받침되는지 본다. 예전 글에 표시가 남아 있으면 표시째 지운다.
- **`[이미지 필요]`**: 직접 만든 이미지를 글 폴더에 넣고 파일명만 쓴다(`![설명](cost-flow.png)`). 외부 이미지·남의 화면 캡처 금지.
- 커버 이미지가 사실을 왜곡하지 않는지 직접 연다. 다시 만들 때: `node tools/render-eli5.mjs pipeline/guide/research/<slug>.eli5.json`

---

## 7. 발행 절차 (PR 리뷰)

### 7.1 공통 순서 — PR 머지 = 공개

**글(분석·가이드)은 PR로, 스킬·도구·레이아웃 개선은 main에 바로 넣는다.**

1. PR을 연다(자동 초안 PR은 `tools/auto/run-one.sh`가 연다). **PR 본문에 "머지 전 확인할 것" 체크박스가 자동으로 채워진다** — 공고 대조·결론 방향·"입찰 전 확인할 것" 같은 글 종류별 항목이 한 칸씩이다.
2. 체크박스를 하나씩 처리한다. 고칠 게 있으면 그 PR 브랜치에 커밋한다(커밋할 때마다 목록이 다시 채워지고, 이미 체크한 칸은 유지된다).
   - 로컬에서 보려면: `gh pr checkout <PR번호>` → `hugo server -D` → http://localhost:1313/auction-note/ (다른 폴더에 받았다면 `hugo server --source <폴더> --themesDir <저장소>/themes` — 테마가 서브모듈이라 새 폴더엔 비어 있다)
3. **"PR 검사"가 초록불인지 본다.** 빨간불이면 남아 있는 `[확인 필요]`·`[경험 추가 필요]` 같은 표시나, 공개되지 않은 글로 가는 링크가 있다는 뜻이다(검사 로그에 위치가 나온다). 지금 스킬은 이런 표시를 만들지 않는다 — 확인 못 한 사실은 글 속 "입찰 전 확인할 것"에 독자가 직접 확인할 일로 적힌다.
4. 체크박스를 다 채우고 **머지**한다. 머지하면 그 PR의 글이 자동으로 `draft: false`가 되고 바로 배포된다(`.github/workflows/publish.yml` → `tools/publish-merged.mjs`). Actions 탭 "Build and Deploy"가 초록불이면 끝(보통 1~2분).

> 머지는 하되 공개는 미루고 싶으면 PR에 **`초안 유지`** 라벨을 붙인 뒤 머지한다.
>
> **주의:** main에 바로 push한 커밋도 같은 규칙을 탄다 — 그 커밋에 `draft: true`인 글이 들어 있으면 공개된다. 그래서 글은 main에 바로 넣지 말고 PR로 올린다.

### 7.2 가이드 글 체크리스트

- [ ] `[경험 추가 필요]` 표시가 남아 있지 않다(경험은 넣지 않는다)
- [ ] 커버 이미지가 사실과 맞다
- [ ] `node tools/check/guide.mjs content/guide/<slug>/index.md` FAIL 없음
- [ ] `node tools/check/guide.mjs content/guide/<slug>/index.md --verify-links` 참고 링크가 열린다
- [ ] 다른 글 링크가 `{{< relref "/guide/<slug>" >}}` 형식이다
- [ ] 같은 주제의 기존 글과 겹치지 않는다

### 7.3 분석 글 체크리스트

- [ ] "입찰 전 확인할 것"에 이 글이 확인하지 못한 것과 확인할 곳이 분명히 적혀 있다 (`[확인 필요]` 표시는 없다)
- [ ] **최신 매각물건명세서(공매는 공매재산명세)와 `data/cases/<id>.json`이 여전히 같다** — 매각기일 변경·취하·권리 추가 여부
- [ ] 계산 결과(인수/소멸)와 본문 결론이 같은 방향이다
- [ ] 제목은 `<지역> <물건> <경매|공매> (<사건번호>)`이고 판정(인수 가능·임차권등기 등)은 제목이 아니라 tags에 있다
- [ ] 등기부를 본 것처럼 쓰지 않았다(출처는 매각물건명세서·현황조사서·공매재산명세)
- [ ] 본문에 사람 이름이 없다(소재지 전체 주소는 허용)
- [ ] 입찰 권유·수익 장담 표현이 없다
- [ ] `node tools/check/analysis.mjs content/analysis/<id>/index.md` FAIL 없음
- [ ] 본문에 사건 수치 표를 직접 쓰지 않았다(표는 `case-summary`·`case-rights`·`case-score`·`case-result` shortcode)

---

## 8. 매각 결과 입력

매각기일이 지나면 `data/cases/<id>.json`에 `result`를 넣는다. 대부분 도구가 자동으로 채운다:

```bash
node tools/analysis/fetch-onbid-result.mjs onbid-202610100001 --write          # 공매
node tools/analysis/fetch-court-result.mjs seoul-dongbu-2026ta50579 --write     # 경매(여러 ID 한 번에 가능)
```

분석한 회차 결과와 그 뒤 회차(`later[]`)까지 채운다. 경매 응찰자 수는 공개 API에 없어 비어 있다. 도구가 못 쓰는 경우(취하·정지 등)만 아래처럼 직접 넣는다.

```json
"result": {
  "outcome": "매각",
  "winning_bid": 312000000,
  "bidders": 7,
  "checked_at": "2026-10-13"
}
```

- `outcome`: `매각` / `유찰` / `변경` / `취하` / `재매각`
- 유찰·변경·취하면 `winning_bid`·`bidders`는 빼도 된다.
- `result`는 계산에 쓰이지 않으므로 **`compute.mjs`를 다시 돌릴 필요가 없다.**
- 커밋·push하면 다음 빌드부터 글의 결과 카드(`case-result`)가 자동으로 바뀐다.
- 유찰돼 다음 회차를 다시 분석하고 싶으면 **새 글이 아니라** 기존 사건 데이터의 `sale`(최저가·유찰 횟수·매각기일)을 갱신하는 것을 우선 검토한다(주소 유지).

---

## 9. 자동화 관리

### 매일 배치와 실패 알림 메일

- **배치**: 이 Mac의 Claude 예약 작업 `auction-note-daily`가 매일 08시대에 결과 반영 → 후보 스캔 → 분석 초안(최대 2건 PR) → 알림을 한다. Mac과 Claude 앱이 켜져 있어야 돈다(꺼져 있었으면 다음에 앱을 열 때). 관리: 사이드바 "Scheduled".
- **기록**: 배치는 시작할 때 `node tools/batch-log.mjs start`, 끝날 때 `node tools/batch-log.mjs finish <요약.json>`으로 `logs/batch/<날짜>.json`을 main에 남긴다(이 커밋은 사이트를 다시 배포하지 않는다).
- **감시·메일**: GitHub Actions `Batch Watch`(`.github/workflows/batch-watch.yml`)가 매일 KST 11시에 오늘 기록을 읽어 "배치 일지" 이슈에 `@rich-batch`를 멘션한 댓글을 남긴다 → GitHub 알림 메일이 온다. Mac이 꺼져 있어도 돈다.
  - ✅ 정상 / ⚠️ 일부 실패 또는 시작만 하고 끝난 기록 없음 / ❌ 오늘 기록 없음(안 돌았음). 문제 있는 날은 이슈에 `bug` 라벨이 붙고 **워크플로가 실패로 끝나 GitHub "Run failed: Batch Watch" 메일이 온다**(멘션 메일 설정과 별개 — 이게 문제 알림의 주 경로).
  - 메일이 안 오면: GitHub Settings → Notifications에서 "Participating, @mentions" 메일이 켜져 있는지 확인.
  - 수동 확인: `node tools/batch-watch.mjs --dry-run` (알림 없이 오늘 판정만 출력)


### 9.1 무엇이 자동으로 돌아가나

| 자동화 | 언제 | 어디 | 결과 |
|---|---|---|---|
| 사이트 배포 | main push, 매일 KST 07:00, 수동 | GitHub Actions (`.github/workflows/publish.yml`) | GitHub Pages 갱신 |
| 가이드 초안 | 매일 06:00 (맥이 깨어 있을 때) | launchd → `batch.sh guide 1` | `[자동 초안]` PR |
| 분석 초안 | 수동 (원하면 plist 추가) | `batch.sh analysis N` | `[자동 초안]` PR |

매일 07:00 재빌드가 있는 이유: 달력·"결과 입력 필요" 같은 **날짜에 따라 바뀌는 화면**을 push가 없어도 갱신하기 위해서다.

### 9.2 자동 글쓰기 동작 방식

`batch.sh`가 `tools/pending.mjs`로 아직 글이 없는 대상을 고르고, **이미 열린 PR이 있는 대상은 건너뛴 뒤** `run-one.sh`를 한 편씩 실행한다.
`run-one.sh`는 main 최신화 → `auto/<종류>/<id>-<시각>` 브랜치 → 헤드리스 `claude -p` → 해당 경로만 커밋 → PR 생성 → main 복귀 순서로 돌아간다.

- 이 컴퓨터에 로그인된 **Claude Code 구독 세션**을 쓴다(API 키 아님). 로그인이 풀리면 실패한다.
- 헤드리스 실행은 `git push/commit/reset/checkout`과 `rm -rf`가 막혀 있다. 커밋·PR은 스크립트가 직접 한다.
- **작업 중인 변경이 main에 커밋되지 않은 채 남아 있으면 `git checkout`/`pull`이 꼬일 수 있다.** 자동 실행 시각 전에는 작업 트리를 깨끗하게 두거나, 작업은 별도 브랜치에서 한다.

### 9.3 실패했을 때

| 증상 | 확인 | 조치 |
|---|---|---|
| PR이 안 생김 | `tools/auto/auto-write.log`, `tools/auto/launchd.err.log` | 로그 마지막 실행 블록 확인 |
| "생성된 변경 사항 없음" | 로그 | 이미 있는 slug(SKIPPED)거나 사건 데이터 INVALID → `compute.mjs`로 원인 확인 |
| `claude`/`gh` 명령 못 찾음 | `launchd.err.log` | plist의 PATH에 설치 경로 추가 |
| 인증 오류 | `gh auth status`, `claude` 로그인 | 다시 로그인 |
| 한 편만 다시 | — | `tools/auto/run-one.sh <guide\|analysis> <id>` |
| 실패 후 브랜치가 남음 | `git branch` | main으로 돌아와 빈 `auto/...` 브랜치 삭제 |

### 9.4 배포 실패

- Actions 탭에서 "Build and Deploy" 실패 로그를 본다.
- 흔한 원인: shortcode가 읽는 사건 데이터·`computed` 누락, 발행 글이 초안 글을 링크, 테마 서브모듈 누락.
- 로컬에서 똑같이 재현: `hugo -d /tmp/auction-note-build` (`-D` 없이).
- 고친 뒤 push하면 다시 배포된다. 수동 재실행: Actions → Build and Deploy → Run workflow.

---

## 10. 데이터·규칙 관리

### 10.1 개인정보 (가장 중요)

- 사건 데이터·글·조사 노트에 **사람 이름·주민번호·전화번호 금지**. 검사 스크립트(FORBIDDEN_KEYS·정규식)가 막지만, 그것만 믿지 않는다.
- 권리자는 `holder_type`(은행·개인·카드사·국가기관)으로만.
- 현황조사서 API는 점유자 실명을 그대로 주지만 `fetch-court-docs.mjs`는 저장하지 않는다. **화면에서 본 이름을 손으로 옮겨 적지 않는다.**
- 서류 PDF·캡처는 `private/`(gitignore) 또는 저장소 밖에.
- 소재지(`case.region`)는 전체 주소(지번·동/호수)를 쓴다 — 법원·온비드가 법률상 공개하는 정보다.

### 10.2 바꾸면 안 되는 것

- 발행 후 **slug·사건 ID**(= 주소). 꼭 바꿔야 하면 가이드는 front matter `aliases`로 옛 주소를 넘긴다.
- `computed` 필드(손으로 수정 금지).
- 본문 면책 문구(템플릿이 자동으로 붙인다 — 본문에 쓰면 중복).

### 10.3 링크 규칙

- 다른 글: `[제목]({{< relref "/guide/<slug>" >}})` — `/guide/...`로 직접 쓰면 하위 경로(`/auction-note/`)가 빠져 깨진다.
- 발행 글이 초안 글을 링크하면 **발행 빌드가 실패한다** → 링크 대상부터 발행하거나 링크를 뺀다.
- 분석 글의 용어 → 가이드 글 자동 링크는 `data/glossary.json`에서 관리한다. 새 가이드를 발행하면 관련 용어를 추가한다.

### 10.4 계산 규칙을 바꿀 때

1. `tools/analysis/rights.mjs` 수정
2. `tools/analysis/rights.test.mjs`에 그 경우의 테스트 추가·수정
3. `node --test tools/analysis/rights.test.mjs` 통과
4. **모든 사건을 다시 계산**(규칙이 바뀌면 기존 결과도 바뀔 수 있다):
   ```bash
   for f in data/cases/*.json; do node tools/analysis/compute.mjs "$(basename "$f" .json)"; done
   ```
5. 발행된 글 중 결론이 바뀐 사건이 있으면 본문 해설도 고친다.

---

## 11. 사이트 구성 관리

| 하고 싶은 것 | 고칠 곳 |
|---|---|
| 분석 분류 추가(예: 오피스텔) | `data/categories.json`에 한 줄 → 분류 페이지·탭·검증 자동 반영. 계산 방식이 다르면 `rights.mjs`에 엔진 추가 |
| 물건 검색 필터 추가 | `layouts/analysissearch/list.html`(JSON·컨트롤)과 `assets/js/analysis-search.js`를 **함께** |
| 홈 화면 구성 | `layouts/home.html`, 물건 카드는 `layouts/_partials/home-case-card.html` |
| 홈 "처음이라면 이 순서로" 가이드 순서 | `data/home.json`의 `start_path` (slug 순서만 바꾸면 됨) |
| 달력 모양 | `layouts/_partials/calendar.html` (평일 5칸, 발행 글만) |
| 사건 표 모양 | `layouts/_shortcodes/case-*.html` |
| 면책 문구 | `layouts/_partials/disclaimer.html`, `disclaimer-analysis.html` |
| 스캔 제외 기준(최저가·공유지분) | `tools/lib/candidate-filter.mjs` |
| 법원 slug 매핑 | `tools/lib/courts.mjs` |
| 소개·개인정보처리방침·연락처 페이지 | site-readiness 스킬 |

- 물건 검색의 인수 위험 배지는 `computed`에서 나온다 — 계산 안 된 사건은 "확인 필요"로 보인다.
- 달력 칩에는 지역·분류만 보인다. 글이 없거나 초안이면 달력에 나오지 않는다.

---

## 12. 문제 해결 FAQ

**Q. 법원경매 스캔이 `BLOCKED` 또는 호출 한도 초과로 멈췄다.**
법원경매정보가 짧은 시간에 몰린 요청을 막은 것이다(약 1시간 차단). **바로 다시 돌리지 말고** 1시간 이상 쉰 뒤 다시 실행한다. 이미 등록된 사건은 목록에서 빠지니 중복되지 않는다. 여러 달을 연달아 스캔하지 않는다.

**Q. `fetch-onbid.mjs`가 브라우저 오류를 낸다.**
`npx playwright install chromium`을 다시 실행한다.

**Q. 사건이 계속 "계산 필요"에 머문다.**
`node tools/analysis/compute.mjs <id>`를 돌려 검증 메시지를 본다. 대부분 법원경매 사건의 `rights[]`가 비어 있거나, 입력을 고친 뒤 다시 계산하지 않은 경우다.

**Q. 매각기일이 지났는데 글이 아직 초안이다.**
매각 전 분석으로서의 가치는 줄었지만, 결과(`result`)를 넣고 "결과까지 본 사례"로 발행할 수 있다. 가치가 낮다고 판단되면 발행하지 않고 둔다.

**Q. 빌드는 되는데 사이트에 글이 안 보인다.**
`draft: true`인지, front matter `date`가 미래인지, Actions 배포가 성공했는지 차례로 본다.

**Q. 실거래가 조회가 502로 실패한다.**
k-skill-proxy가 간헐적으로 실패한다(알려진 문제). 아파트는 자동으로 국토부 사이트로 대체된다. 빌라·상가는 시간을 두고 다시 시도하거나 국토부 실거래가 공개시스템에서 직접 확인한다.

**Q. 검사에서 "금액 출처 없음" FAIL이 난다.**
본문 금액은 사건 데이터에 있는 값(또는 그 합·차)이거나, 같은 줄에 출처 링크가 있어야 한다. 숫자를 데이터에 넣거나 출처를 붙인다.

---

## 13. 명령 요약

| 목적 | 명령 |
|---|---|
| 상태 보기 | `node tools/analysis/status.mjs` |
| 후보 찾기(공매+경매) | `node tools/analysis/scan-daily.mjs --date <YYYY-MM-DD>` |
| 후보 찾기(온비드만) | `node tools/analysis/scan-onbid.mjs --date <날짜>` |
| 후보 찾기(법원만) | `node tools/analysis/scan-court.mjs [--court <코드>] --date <날짜>` |
| 온비드 등록 | `node tools/analysis/fetch-onbid.mjs <물건관리번호> [--type=trust]` |
| 법원경매 등록 | `node tools/analysis/fetch-court.mjs <법원코드> <사건번호> --sale-date <날짜>` |
| 현황조사서 보충 | `node tools/analysis/fetch-court-docs.mjs <id>` |
| 명세서 요약·기일·결과(법원) | `node tools/analysis/fetch-court-result.mjs <id>... --write` |
| 매각 결과(온비드) | `node tools/analysis/fetch-onbid-result.mjs <id> --write` |
| 직접 등록 | `node tools/analysis/new-case.mjs <id> <사건번호> <분류>` |
| 시세(부동산) | `node tools/analysis/fetch-market.mjs <id> [--name <단지명>] [--write]` |
| 시세(자동차) | `node tools/analysis/fetch-car-market.mjs <id> [--model <차종>] [--write]` |
| 계산 | `node tools/analysis/compute.mjs <id>` |
| 엔진 테스트 | `node --test tools/analysis/rights.test.mjs` |
| 분석 글 검사 | `node tools/check/analysis.mjs content/analysis/<id>/index.md` |
| 가이드 글 검사 | `node tools/check/guide.mjs content/guide/<slug>/index.md [--facts\|--verify-links]` |
| 가이드 글감 목록 | `node .claude/skills/write-guide/render-prompt.mjs --list` |
| 자동 초안(여러 편) | `tools/auto/batch.sh <guide\|analysis> <N>` |
| 자동 초안(한 편) | `tools/auto/run-one.sh <guide\|analysis> <id>` |
| 커버 이미지 | `node tools/render-eli5.mjs pipeline/guide/research/<slug>.eli5.json` |
| 로컬 미리보기 | `hugo server -D` |
| 발행 빌드 확인 | `hugo -d /tmp/auction-note-build` |
