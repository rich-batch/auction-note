# 사건 데이터 (`data/cases/<id>.json`)

물건 분석 글의 **사실 원본**. 사람이 서류를 보고 입력하고(`computed` 제외), Hugo 표·계산 도구·검사 스크립트·AI가 모두 이 파일을 읽는다.

- 새 파일(법원경매): `node tools/analysis/new-case.mjs <id> <사건번호> <분류>`
- 새 파일(온비드, 자동 조회): `node tools/analysis/fetch-onbid.mjs <물건관리번호> [--type=trust]` — 최초 1회 `npx playwright install chromium` 필요. `--type=trust` 없으면 압류재산(국세징수법 제92조), 있으면 신탁공매(신탁법 제4조·제22조)로 취급
- 계산: `node tools/analysis/compute.mjs <id>` (검증 실패 시 무엇이 틀렸는지 알려 줌)
- 단계 확인: `node tools/analysis/status.mjs`
- 엔진 테스트: `node --test tools/analysis/rights.test.mjs`

**저장소와 사이트는 공개 상태다.** 이름·주민번호·전화번호는 넣지 않는다(검증이 막는다). 서류 원본(PDF·캡처)은 저장소 밖이나 gitignore된 `private/`에 둔다. 소재지(`case.region`)는 전체 주소(지번·동/호수 포함)를 넣는다 — 법원경매정보·온비드가 법률상 공개하는 정보다.

## ID

court: `<법원>-<연도>ta<번호>[-<물건번호>]` — 예: `seoul-central-2026ta12345`, 물건번호 2번이면 `seoul-central-2026ta12345-2`.
onbid: `onbid-<물건관리번호에서 하이픈만 뺀 숫자>` — 예: 물건관리번호 `2022-0200-007090`이면 `onbid-20220200007090` (`fetch-onbid.mjs`가 자동으로 이 규칙대로 만든다).
이 ID가 파일 이름, 글 폴더(`content/analysis/<id>/`), 주소(`/analysis/<id>/`)를 겸한다. 발행 후 바꾸지 않는다.

## 필드

| 필드 | 필수 | 내용 · 어디서 |
|---|---|---|
| `id` | ✓ | 위 규칙. 파일 이름과 같아야 함 |
| `source.checked_at` | ✓ | 서류를 확인한 날(YYYY-MM-DD). 글 서론의 "기준일"이 된다 |
| `source.documents` | | 확인한 서류 이름 |
| `source.url` | | 물건 정보를 본 원본 링크(법원경매정보 등). 참고용 — 이 페이지가 로그인·캡차로 막혀 있어도 링크 자체는 남겨 둔다 |
| `source.type` | | `court`(법원경매, 기본값) 또는 `onbid`(온비드 공매). 사건번호 형식·id 규칙이 달라진다 |
| `case.number` | ✓ | court: `2026타경12345`. onbid: 물건관리번호 `2022-0200-007090`(자릿수는 물건 유형마다 다를 수 있음) |
| `case.item_no` | | 물건번호 (1이면 표에 안 나옴) |
| `case.court` | ✓ | court: `서울중앙지방법원`. onbid: 공고기관(예: `한국자산관리공사`) |
| `case.kind` | | court: `임의경매` / `강제경매`. onbid: `압류재산 공매` 또는 `신탁공매` |
| `case.onbid_property_type` | onbid만 ✓ | 온비드 재산 유형. **`압류재산` 또는 `신탁공매`만 지원.** 그 외(국유재산 등)는 말소기준권리·인수 개념의 법적 근거를 아직 확인 못 해 이 엔진으로 계산하지 않는다(`fetch-onbid.mjs`가 자동으로 막음, `--type=trust`로 신탁공매를 사람이 확정) |
| `case.trust_registered_on` | 신탁공매만 ✓ | 신탁등기 접수일(YYYY-MM-DD, 등기사항전부증명서에서 확인). 신탁법 제4조상 임차인 대항력의 기준일 — 없으면 `compute.mjs`가 INVALID |
| `case.category` | ✓ | 분류 slug: `apartment` `villa` `commercial` `land` `car` (`data/categories.json`). 분류마다 페이지·계산 방식이 달라진다. 오피스텔 등 목록에 없는 물건은 분류를 먼저 추가한다 |
| `case.region` | ✓ | **전체 주소**(지번·건물명·동/호수 포함, 예: `서울특별시 강동구 상일동 554-38 이편한세상고덕어반브릿지 제1001동 제3층 제331호`). 법원경매정보·온비드가 법률상 공개하는 정보라 그대로 쓴다. 사람 이름·주민번호·전화번호만 계속 금지 |
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
| `computed.price_gap` | 자동 | `market.trades`가 있을 때만 계산되는 시세 평균과 최저가(+인수 부담)의 차이. 판단(저평가·시세차익 등)이 아니라 차이라는 사실만 낸다. 없으면 `null` |
| `computed.score` | 자동 | 지금 사건 데이터로 계산 가능한 객관 지표(가격 수준·권리 인수 위험·임차인 위험·확인 필요 사항 수, 시세가 있으면 시세갭)를 0~5점으로 낸 것. "입찰 추천"이 아니라 확인 지표 요약 — 결론은 내지 않는다 |

`computed.input_hash`는 입력(`case`·`sale`·`rights`·`tenants`·`special`·`spec_sheet`·`market`)의 해시다. 입력을 고치면 달라져서 검사가 "다시 계산하라"고 알려 준다. `market`은 시세갭·확인 지표 점수 계산에 쓰이므로 해시에 포함된다. `result`(매각 결과)는 어떤 계산에도 쓰이지 않아 해시에서 빠진다.

## 온비드 압류재산 — 정보 확보 체크리스트

`fetch-onbid.mjs`가 자동으로 채우는 것과, 사람이 나중에 채워야 하는 것을 시점별로 나눈다. 항목마다 "언제 확인 가능한가"가 다르므로 이 순서로 점검한다.

**A. 물건 상세 페이지에서 즉시 확인 가능 (무료, 로그인 불필요, `fetch-onbid.mjs`가 자동 입력)**
- 물건관리번호, 재산유형(압류재산인지), 공고기관, 소재지(전체 주소), 물건종류, 면적
- 감정평가금액, 회차별 공매예정가격, 입찰기간, 개찰일시, 유찰횟수, 입찰보증금율(통상 10%)
- 등기사항증명서 주요정보(권리종류·권리자 유형·설정일자·설정금액) — **공매대행 의뢰 시점 기준 요약**이라 참고용. 접수번호가 없고 등기부 순위번호와 무관하다고 온비드가 명시
- 임대차 정보(임차인 보증금·확정일·전입일) — 감정평가서·배분요구서 기준
- 정정내역(유의사항) — 대지권미등기 등 특이사항이 있으면 여기 나옴

**B. 입찰 시작 7일 전부터만 확인 가능 (국세징수법 제77조제2항 — 법정 시한, 더 일찍 볼 방법 없음)**
- 공매재산명세서: **임차인의 배당(배분)요구 여부**와 그 일자. `tenants[].dividend_claim`은 이게 없으면 확정할 수 없다 — 지어내지 말고 이 시점까지 기다린다.

**C. 사람이 직접 서류·현장으로 확인해야 하는 것**
- 최신 등기사항전부증명서(온비드 요약은 참고용, 입찰 전 재확인 필수 — 인터넷등기소, 소액 유료)
- 실제 점유 현황(현장 방문), 관리비 체납 여부(관리사무소)

**D. `compute.mjs`가 계산하는 것**
- 말소기준권리, 등기 인수/소멸, 임차인 대항력, 인수 예상액, 확인 지표 점수, 시세갭(시세를 넣었을 때만)

## 단계 (파일에 적지 않고 매번 계산)

`계산 필요` → `글 작성 대기` → `검토 대기`(draft) → `발행됨` → `결과 입력 필요`(매각기일 지남) → `종료`
