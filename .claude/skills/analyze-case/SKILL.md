---
name: analyze-case
description: 특정 경매 물건(사건번호) 권리분석 글(content/analysis)을 data/cases/<id>.json 사건 데이터로 쓴다 — 사건 데이터 검증·권리 계산(tools/analysis/compute.mjs) → 법령 근거 조사 노트 → 표는 shortcode로 자동, 본문은 해설 → 검사. 새 사건 데이터 파일 만들기, 사건 단계 확인, 매각 결과 입력 안내도 한다. "물건 분석 써줘", "사건 분석", "<사건번호> 분석", "다음 분석 글", "사건 등록", "매각 결과 입력" 요청 시 사용. 개념 설명 가이드 글은 write-guide 스킬.
argument-hint: [<case-id> | 다음 | 등록 <id> <사건번호> | 상태 | 결과 <case-id>]
---

# analyze-case

특정 경매 사건 하나의 권리관계를 설명하는 글을 쓴다. 입찰 권유가 아니라 **공개 자료로 권리분석을 해 보는 기록**이다. 저장소 구조와 공통 규칙은 루트 `CLAUDE.md`.

핵심 분업: **사실은 사람이 데이터로 넣고, 판정은 코드가 계산하고, AI는 해설만 쓴다.**

| 단계 | 누가 | 무엇 |
|---|---|---|
| 1. 사건 등록 | 사람 | 매각물건명세서·등기사항전부증명서·현황조사서를 보고 `data/cases/<id>.json` 입력 |
| 2. 계산 | 코드 | `node tools/analysis/compute.mjs <id>` → 말소기준권리·인수/소멸·대항력·인수 예상액을 `computed`에 기록 |
| 3. 글 | AI (이 스킬) | 계산 결과를 해설하는 글 초안, `[확인 필요]` 표시 |
| 4. 발행 | 사람 | `[확인 필요]` 해소 → `draft: false` |
| 5. 결과 | 사람 | 매각기일 뒤 `result` 입력 → 글의 매각 결과 표가 다음 빌드에 자동 갱신 |

경로(글 하나 = 사건 ID 하나, 예: `seoul-central-2026ta12345`):

| 무엇 | 경로 |
|---|---|
| 사건 데이터 (사실 + 계산 결과 + 매각 결과) | `data/cases/<id>.json` — 필드 설명 `tools/analysis/README.md` |
| 글 | `content/analysis/<id>/index.md` |
| 조사 노트 (법령 근거) | `pipeline/analysis/research/<id>.md` |
| 검사 | `node tools/check/analysis.mjs content/analysis/<id>/index.md` |

## 모드

| 요청 | 할 일 |
|---|---|
| "상태", "분석할 거 있어?" | `node tools/analysis/status.mjs` 결과를 보여 주고 다음 할 일 안내 |
| "등록 <id> <사건번호>" | `node tools/analysis/new-case.mjs <id> <사건번호>`로 빈 파일을 만들고, 사람이 채울 필드를 `tools/analysis/README.md` 기준으로 안내. **값을 대신 지어내거나 웹에서 긁어 채우지 않는다** |
| "<id> 분석", "다음 분석 글" | 아래 **새 글** |
| "<id> 고쳐 써줘" | `render-prompt.mjs --case <id> --revise`로 새 글과 같은 절차, 원래 `date` 유지 |
| "결과 <id>" | 사람에게 매각결과(결과·매각가격·응찰자 수·확인일)를 받아 `result`에 넣는다. 글은 고치지 않아도 표가 자동 갱신된다 |

## 새 글

1. **계산 최신화.** `node tools/analysis/compute.mjs <id>`. `INVALID`면 멈추고 무엇을 고쳐야 하는지 사람에게 보고한다(데이터를 추측으로 고치지 않는다).
2. **지시문 받기.**
   ```bash
   node .claude/skills/analyze-case/render-prompt.mjs --case <id>
   node .claude/skills/analyze-case/render-prompt.mjs --next 1
   ```
3. `=== JOB` 블록대로 0단계(조사 노트) → 1단계(글) → 2단계(셀프 리뷰) → 검사. FAIL은 PASS까지 고친다.
4. **로컬 확인.** `hugo -D -d <스크래치 폴더>` 빌드가 에러 없이 끝나는지(사건 데이터가 없거나 `computed`가 없으면 shortcode가 빌드를 멈춘다).
5. **보고.** 템플릿의 보고 항목 + 사람이 발행 전 해야 할 일(`[확인 필요]` 해소, 최신 매각물건명세서와 대조).

## 계산 도구가 하는 것 / 못 하는 것

**한다** (`tools/analysis/rights.mjs`, 테스트 `node --test tools/analysis/rights.test.mjs`):
- 말소기준권리: (근)저당권·압류·가압류·담보가등기·경매개시결정 중 가장 빠른 접수(같은 날이면 접수번호), 건물 전부 전세권 + 배당요구
- 등기 권리 인수/소멸: 말소기준권리보다 앞서면 인수, 뒤면 소멸. 선순위 전세권은 배당요구 시 소멸
- 임차인 대항력: 점유(또는 임차권등기) + 전입·사업자등록일이 말소기준권리 접수일보다 **하루 이상 앞설 때**
- 인수 예상액: 대항력 있고 배당요구 안 함 → 보증금 전액 / 배당요구함 → 0 ~ 보증금(배당 순위 미계산)
- 입찰보증금(기본 10%, 재매각 20%), 감정가 대비 최저가 비율
- 매각물건명세서 기재(최선순위 설정, 인수 권리)와 대조해 어긋나면 review

**못 한다 → review로 남김**: 배당표(누가 얼마 배당받는지), 소액임차인 최우선변제, 유치권·법정지상권·분묘기지권, 후순위 가처분의 성격, 가등기의 성격(담보/보전), 대지권 미등기·토지별도등기 등 `special`에 적힌 사항.

규칙을 바꾸거나 추가할 때는 `rights.mjs`와 `rights.test.mjs`를 함께 고치고 테스트를 통과시킨다. 법령 근거를 주석에 남긴다.

## 자주 막히는 곳

| 증상 | 원인 / 해결 |
|---|---|
| 검사 "computed가 오래됨" | 데이터를 고친 뒤 compute를 안 돌림. 다시 돌리고 글이 새 결과와 맞는지 확인 |
| 검사 "사건 데이터에 없는 금액" | 본문에 계산해서 만든 숫자. 데이터 값(또는 두 값의 합·차)으로 바꾸거나 지운다. 필요한 값이면 사람이 데이터에 넣는다 |
| 빌드 에러 "data/cases/…json이 없음" | front matter `case`와 파일 이름이 다름 |
| 시세를 쓰고 싶음 | 사람이 `market.trades`에 실거래 사례와 `source_url`을 넣은 뒤에만 |
| 매각기일이 연기·변경됨 | 사람이 `sale.sale_date`를 고치고 compute 재실행(입력 해시가 바뀜) |
