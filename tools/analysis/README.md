# 사건 데이터 (`data/cases/<id>.json`)

물건 분석 글의 **사실 원본**. 사람이 서류를 보고 입력하고(`computed` 제외), Hugo 표·계산 도구·검사 스크립트·AI가 모두 이 파일을 읽는다.

- 새 파일: `node tools/analysis/new-case.mjs <id> <사건번호>`
- 계산: `node tools/analysis/compute.mjs <id>` (검증 실패 시 무엇이 틀렸는지 알려 줌)
- 단계 확인: `node tools/analysis/status.mjs`
- 엔진 테스트: `node --test tools/analysis/rights.test.mjs`

**저장소와 사이트는 공개 상태다.** 이름·주민번호·전화번호·번지·동호수는 넣지 않는다(검증이 막는다). 서류 원본(PDF·캡처)은 저장소 밖이나 gitignore된 `private/`에 둔다.

## ID

`<법원>-<연도>ta<번호>[-<물건번호>]` — 예: `seoul-central-2026ta12345`, 물건번호 2번이면 `seoul-central-2026ta12345-2`. 이 ID가 파일 이름, 글 폴더(`content/analysis/<id>/`), 주소(`/analysis/<id>/`)를 겸한다. 발행 후 바꾸지 않는다.

## 필드

| 필드 | 필수 | 내용 · 어디서 |
|---|---|---|
| `id` | ✓ | 위 규칙. 파일 이름과 같아야 함 |
| `source.checked_at` | ✓ | 서류를 확인한 날(YYYY-MM-DD). 글 서론의 "기준일"이 된다 |
| `source.documents` | | 확인한 서류 이름 |
| `case.number` | ✓ | `2026타경12345` |
| `case.item_no` | | 물건번호 (1이면 표에 안 나옴) |
| `case.court` | ✓ | `서울중앙지방법원` |
| `case.kind` | | `임의경매` / `강제경매` |
| `case.property_type` | ✓ | `아파트`, `다세대`, `오피스텔`, `상가` 등 |
| `case.region` | ✓ | **법정동까지만** (`서울특별시 강남구 역삼동`) |
| `case.area_m2` | | 전용면적 ㎡ |
| `sale.appraisal` | ✓ | 감정가 (원, 정수) |
| `sale.minimum` | ✓ | 이번 회차 최저매각가격 (원, 정수) |
| `sale.failed_rounds` | | 유찰 횟수 |
| `sale.sale_date` | ✓ | 매각기일 |
| `sale.dividend_deadline` | | 배당요구종기 (있으면 임차인 배당요구 기한을 검사) |
| `sale.resale` | | 재매각이면 `true` (보증금 20%) |
| `sale.deposit_rate` | | 특별매각조건으로 보증금 비율이 다르면 (예: `0.2`) |
| `rights[]` | ✓ | 등기사항전부증명서 갑구·을구의 **모든** 부담 등기. 경매개시결정 기입등기도 넣는다 |
| `rights[].date` | ✓ | 접수일 |
| `rights[].receipt_no` | | 접수번호. 같은 날 접수가 여럿이면 필수 |
| `rights[].kind` | ✓ | `근저당권` `저당권` `압류` `가압류` `담보가등기` `경매개시결정` `가처분` `소유권이전청구권가등기` `지상권` `지역권` `환매특약` `임차권등기` `전세권` `가등기`(성격 불명) `소유권이전` `소유권보존` |
| `rights[].amount` | | 채권최고액·청구금액·전세금 (원) |
| `rights[].holder_type` | | `은행`, `개인`, `카드사`, `국가기관` 등 (이름 금지) |
| `rights[].whole_property` / `dividend_claim` / `applicant` | | 전세권만: 건물 전부 여부, 배당요구 여부, 경매신청자 여부 |
| `tenants[]` | ✓ | 매각물건명세서의 점유자·임차인. 없으면 `[]` |
| `tenants[].use` | ✓ | `주거` / `상가` |
| `tenants[].registered_on` | | 전입일(주거) 또는 사업자등록 신청일(상가). 모르면 비움 → review |
| `tenants[].fixed_date` | | 확정일자 |
| `tenants[].deposit` / `monthly_rent` | | 보증금 / 월세 (원) |
| `tenants[].dividend_claim` | ✓ | 배당요구 여부 |
| `tenants[].dividend_claim_date` | | 배당요구일 (종기 이후면 없는 것으로 계산) |
| `tenants[].occupies` | ✓ | 현재 점유 여부 (현황조사서) |
| `tenants[].lease_registered` | | 임차권등기 여부 (이사 가도 대항력 유지) |
| `special[]` | | 등기로 판단할 수 없는 사항: `{ "kind": "유치권 신고", "note": "공사대금 주장" }`. 모두 review로 간다 |
| `spec_sheet.base_right_text` | | 매각물건명세서 "최선순위 설정" 칸 그대로 (계산과 대조) |
| `spec_sheet.surviving_rights_text` | | "매각으로 소멸되지 않는 권리" 칸 그대로 (계산과 대조) |
| `spec_sheet.superficies_text` / `remarks` | | 지상권 개요 / 비고 |
| `market.trades[]` | | 사람이 확인한 실거래 사례 `{ "date", "price", "area_m2", "floor" }`. 있을 때만 글에 시세를 쓴다 |
| `market.source_url` / `checked_at` | | 실거래가 출처와 확인일 |
| `result.outcome` | | 매각기일 뒤: `매각` / `유찰` / `변경` / `취하` / `재매각` |
| `result.winning_bid` / `bidders` / `checked_at` | | 매각가격, 응찰자 수, 확인일 |
| `computed` | 자동 | `compute.mjs`만 쓴다. 손으로 고치지 않는다 |

`computed.input_hash`는 입력(`case`·`sale`·`rights`·`tenants`·`special`·`spec_sheet`)의 해시다. 입력을 고치면 달라져서 검사가 "다시 계산하라"고 알려 준다. `market`·`result`는 판정에 영향이 없어 해시에서 빠진다.

## 단계 (파일에 적지 않고 매번 계산)

`계산 필요` → `글 작성 대기` → `검토 대기`(draft) → `발행됨` → `결과 입력 필요`(매각기일 지남) → `종료`
