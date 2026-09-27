// 권리분석 엔진 테스트. 모든 사건은 규칙 확인용 가상 데이터다.
//   node --test tools/analysis/
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCase, computeCase, inputHash } from './rights.mjs';

const base = over => ({
  id: 'test-2026ta100',
  case: { number: '2026타경100', court: '가상지방법원', category: 'apartment', region: '가상시 가상구 가상동' },
  sale: { appraisal: 500000000, minimum: 400000000, sale_date: '2026-10-01', dividend_deadline: '2026-06-30' },
  rights: [
    { date: '2020-05-10', receipt_no: 100, kind: '근저당권', amount: 300000000, holder_type: '은행' },
    { date: '2025-01-15', receipt_no: 200, kind: '가압류', amount: 50000000, holder_type: '카드사' },
    { date: '2026-02-01', receipt_no: 300, kind: '경매개시결정' },
  ],
  tenants: [],
  ...over,
});
const tenant = over => ({ use: '주거', registered_on: '2021-01-01', fixed_date: '2021-01-01', deposit: 200000000, dividend_claim: false, occupies: true, ...over });

test('가장 빠른 근저당권이 말소기준권리, 뒤 권리는 모두 소멸', () => {
  const k = computeCase(base());
  assert.deepEqual(k.base_right, { index: 0, date: '2020-05-10', kind: '근저당권' });
  assert.deepEqual(k.rights.map(r => r.effect), ['소멸', '소멸', '소멸']);
  assert.equal(k.assumed_total_min, 0);
  assert.equal(k.assumed_total_max, 0);
  assert.equal(k.ownership_risk, false);
});

test('말소기준권리보다 늦게 전입한 임차인은 대항력 없음', () => {
  const k = computeCase(base({ tenants: [tenant({ registered_on: '2022-03-01' })] }));
  assert.equal(k.tenants[0].opposable, false);
  assert.equal(k.tenants[0].assumed_max, 0);
});

test('말소기준권리 접수일과 같은 날 전입하면 대항력 없음 (다음 날 0시에 생기므로)', () => {
  const k = computeCase(base({ tenants: [tenant({ registered_on: '2020-05-10' })] }));
  assert.equal(k.tenants[0].opposable, false);
});

test('하루 앞서 전입하면 대항력 있음, 배당요구 없으면 보증금 전액 인수', () => {
  const k = computeCase(base({ tenants: [tenant({ registered_on: '2020-05-09' })] }));
  assert.equal(k.tenants[0].opposable, true);
  assert.equal(k.tenants[0].effect, '인수');
  assert.equal(k.assumed_total_min, 200000000);
  assert.equal(k.minimum_plus_assumed_max, 600000000);
});

test('대항력 있고 배당요구하면 인수 범위는 0 ~ 보증금', () => {
  const k = computeCase(base({ tenants: [tenant({ registered_on: '2019-01-01', dividend_claim: true, dividend_claim_date: '2026-03-01' })] }));
  assert.equal(k.tenants[0].effect, '일부 인수 가능');
  assert.equal(k.assumed_total_min, 0);
  assert.equal(k.assumed_total_max, 200000000);
});

test('배당요구종기 뒤에 한 배당요구는 없는 것으로 계산', () => {
  const k = computeCase(base({ tenants: [tenant({ registered_on: '2019-01-01', dividend_claim: true, dividend_claim_date: '2026-07-15' })] }));
  assert.equal(k.tenants[0].effect, '인수');
  assert.ok(k.review.some(r => r.includes('배당요구종기')));
});

test('이사 나갔어도 임차권등기가 있으면 대항력 유지', () => {
  const moved = computeCase(base({ tenants: [tenant({ registered_on: '2019-01-01', occupies: false })] }));
  assert.equal(moved.tenants[0].opposable, false);
  const kept = computeCase(base({ tenants: [tenant({ registered_on: '2019-01-01', occupies: false, lease_registered: true })] }));
  assert.equal(kept.tenants[0].opposable, true);
});

test('상가 임차인도 사업자등록일 기준으로 같은 규칙', () => {
  const k = computeCase(base({ tenants: [tenant({ use: '상가', registered_on: '2019-01-01' })] }));
  assert.equal(k.tenants[0].opposable, true);
});

test('선순위 가처분은 인수 + 소유권 상실 위험', () => {
  const c = base();
  c.rights.unshift({ date: '2019-01-01', receipt_no: 1, kind: '가처분' });
  const k = computeCase(c);
  assert.equal(k.base_right.kind, '근저당권');
  assert.equal(k.rights[0].effect, '인수');
  assert.equal(k.ownership_risk, true);
});

test('후순위 가처분은 소멸하지만 사람 확인 요청', () => {
  const c = base();
  c.rights.push({ date: '2025-06-01', receipt_no: 250, kind: '가처분' });
  const k = computeCase(c);
  assert.equal(k.rights.at(-1).effect, '소멸');
  assert.ok(k.review.some(r => r.includes('건물철거')));
});

test('이름만 "가등기"면 성격을 알 수 없어 검토로 분류', () => {
  const c = base();
  c.rights.unshift({ date: '2019-01-01', receipt_no: 1, kind: '가등기' });
  const k = computeCase(c);
  assert.equal(k.rights[0].effect, '검토');
  assert.equal(k.ownership_risk, true);
});

test('선순위 전세권: 배당요구하면 소멸, 안 하면 인수(금액 포함)', () => {
  const claimed = base();
  claimed.rights.unshift({ date: '2019-01-01', receipt_no: 1, kind: '전세권', amount: 100000000, dividend_claim: true });
  assert.equal(computeCase(claimed).rights[0].effect, '소멸');
  const kept = base();
  kept.rights.unshift({ date: '2019-01-01', receipt_no: 1, kind: '전세권', amount: 100000000 });
  const k = computeCase(kept);
  assert.equal(k.rights[0].effect, '인수');
  assert.equal(k.assumed_total_min, 100000000);
});

test('건물 전부 전세권자가 배당요구하면 그 전세권이 말소기준권리', () => {
  const c = base();
  c.rights.unshift({ date: '2019-01-01', receipt_no: 1, kind: '전세권', amount: 100000000, whole_property: true, dividend_claim: true });
  assert.equal(computeCase(c).base_right.kind, '전세권');
});

test('같은 날 접수된 기준권리 후보는 접수번호로 순서를 가림', () => {
  const c = base();
  c.rights = [
    { date: '2020-05-10', receipt_no: 20, kind: '근저당권' },
    { date: '2020-05-10', receipt_no: 10, kind: '가압류' },
  ];
  assert.equal(computeCase(c).base_right.kind, '가압류');
  c.rights.forEach(r => delete r.receipt_no);
  assert.ok(computeCase(c).review.some(r => r.includes('접수번호')));
});

test('매각물건명세서와 계산 결과가 어긋나면 알림', () => {
  const c = base({ spec_sheet: { base_right_text: '2021.01.01 근저당권', surviving_rights_text: '해당사항 없음' } });
  c.rights.unshift({ date: '2019-01-01', receipt_no: 1, kind: '지상권' });
  const k = computeCase(c);
  assert.ok(k.review.some(r => r.includes('인수되는 권리 없음')));
  assert.ok(k.review.some(r => r.includes('최선순위')));
});

test('입찰보증금: 기본 10%, 재매각 20%', () => {
  assert.equal(computeCase(base()).bid_deposit, 40000000);
  const c = base();
  c.sale.resale = true;
  assert.equal(computeCase(c).bid_deposit, 80000000);
  assert.equal(computeCase(base()).minimum_ratio, 80);
});

test('검증: 개인정보 필드·형식 오류를 막음 (전체 주소는 허용)', () => {
  assert.deepEqual(validateCase(base()), []);
  const c = base();
  c.rights[0].holder_name = '홍길동';
  c.case.region = '가상시 가상구 가상동 123-4 가상아파트 101동 202호'; // 전체 주소 — 허용돼야 함
  c.tenants = [tenant({ note: '연락처 010-1234-5678' })];
  c.id = 'test-2026ta999';
  const errors = validateCase(c).join('\n');
  assert.match(errors, /holder_name: 개인정보/);
  assert.doesNotMatch(errors, /region/);
  assert.match(errors, /전화번호/);
  assert.match(errors, /사건번호 토큰/);
});

test('입력 해시: result를 바꿔도 그대로, market이나 권리를 바꾸면 달라짐', () => {
  const c = base();
  const h = inputHash(c);
  c.result = { outcome: '매각', winning_bid: 410000000 };
  assert.equal(inputHash(c), h);
  c.market = { trades: [{ date: '2026-01-01', price: 450000000, area_m2: 84, floor: 5 }] };
  assert.notEqual(inputHash(c), h);
  const h2 = inputHash(c);
  c.rights[0].amount = 1;
  assert.notEqual(inputHash(c), h2);
});

test('검증: 주말 매각기일은 막음(달력이 평일만 그림)', () => {
  assert.match(validateCase(base({ sale: { ...base().sale, sale_date: '2026-10-03' } })).join('\n'), /주말/);
  assert.match(validateCase(base({ sale: { ...base().sale, sale_date: '2026-10-04' } })).join('\n'), /주말/);
  assert.deepEqual(validateCase(base({ sale: { ...base().sale, sale_date: '2026-10-05' } })), []);
});

test('분류: 목록에 없으면 오류, 자동차는 엔진 미구현, 토지는 임차인 입력 금지', () => {
  const withCase = over => base({ case: { ...base().case, ...over } });
  assert.match(validateCase(withCase({ category: '아파트' })).join('\n'), /case\.category/);
  assert.match(validateCase(withCase({ category: 'car' })).join('\n'), /계산 엔진이 아직 없음/);
  for (const category of ['apartment', 'villa', 'commercial', 'land']) assert.deepEqual(validateCase(withCase({ category })), []);
  assert.match(validateCase(base({ case: { ...base().case, category: 'land' }, tenants: [tenant()] })).join('\n'), /토지 임차인/);
});

test('source.type: 온비드 공매는 물건관리번호 형식과 id, 압류재산 여부를 검증', () => {
  const onbid = base({
    id: 'onbid-20260800044459',
    source: { checked_at: '2026-09-19', type: 'onbid' },
    case: { ...base().case, number: '2026-0800-044459', onbid_property_type: '압류재산' },
  });
  assert.deepEqual(validateCase(onbid), []);

  const badNumber = base({ id: 'onbid-2026080044459x', source: { type: 'onbid' }, case: { ...base().case, number: '2026타경100', onbid_property_type: '압류재산' } });
  assert.match(validateCase(badNumber).join('\n'), /온비드 물건관리번호/);

  const badId = base({ id: 'onbid-wrong', source: { type: 'onbid' }, case: { ...base().case, number: '2026-0800-044459', onbid_property_type: '압류재산' } });
  assert.match(validateCase(badId).join('\n'), /"onbid-20260800044459"을 포함해야 함/);

  const notSeized = base({ id: 'onbid-20260800044459', source: { type: 'onbid' }, case: { ...base().case, number: '2026-0800-044459', onbid_property_type: '기타일반재산' } });
  assert.match(validateCase(notSeized).join('\n'), /압류재산.*만 지원/);
});

test('분류: 토지는 법정지상권·지목·농지취득자격증명을 확인 항목으로 남김', () => {
  const land = computeCase(base({ case: { ...base().case, category: 'land' } })).review.join('\n');
  assert.match(land, /법정지상권/);
  assert.match(land, /맹지/);
  assert.match(land, /농지취득자격증명/);
  assert.doesNotMatch(computeCase(base()).review.join('\n'), /농지취득자격증명/);
});

test('시세갭: market.trades 없으면 null이고 review에 남김, 있으면 시세 평균과 차이를 계산', () => {
  const withoutMarket = computeCase(base());
  assert.equal(withoutMarket.price_gap, null);
  assert.ok(withoutMarket.review.some(r => r.includes('시세 데이터')));

  const withMarket = computeCase(base({ market: { trades: [{ date: '2026-01-01', price: 500000000, area_m2: 84, floor: 5 }] } }));
  assert.equal(withMarket.price_gap.market_avg, 500000000);
  assert.equal(withMarket.price_gap.trade_count, 1);
  // 인수 부담 없는 사건: 최저가(400000000) 대비 시세 갭 = 100000000
  assert.equal(withMarket.price_gap.gap_min, 100000000);
  assert.equal(withMarket.price_gap.gap_max, 100000000);
});

test('확인 지표 점수: 항목마다 0~5점, 시세 없으면 시세 지표는 빠지고 나머지로 종합', () => {
  const k = computeCase(base());
  const keys = k.score.items.map(x => x.key);
  assert.deepEqual(keys, ['price', 'rights_risk', 'tenant_risk', 'review_load']);
  for (const item of k.score.items) if (item.stars != null) assert.ok(item.stars >= 0 && item.stars <= 5);
  assert.ok(k.score.total_stars >= 0 && k.score.total_stars <= 5);
  assert.equal(k.score.has_price_gap, false);

  const withMarket = computeCase(base({ market: { trades: [{ date: '2026-01-01', price: 500000000, area_m2: 84, floor: 5 }] } }));
  assert.ok(withMarket.score.items.some(x => x.key === 'price_gap'));
  assert.equal(withMarket.score.has_price_gap, true);
});

test('확인 지표 점수: 선순위 가처분처럼 소유권 상실 위험이 있으면 권리 인수 위험 0점', () => {
  const c = base();
  c.rights.unshift({ date: '2019-01-01', receipt_no: 1, kind: '가처분' });
  const k = computeCase(c);
  const risk = k.score.items.find(x => x.key === 'rights_risk');
  assert.equal(risk.stars, 0);
});

test('확인 지표 점수: 인수하는 임차인 보증금이 미상이면 권리 인수 위험은 확인 필요(null)', () => {
  const c = base({ tenants: [tenant({ registered_on: '2020-05-09', deposit: null })] }); // 대항력 있고 배당요구 안 함 → 인수, 보증금 미상
  const k = computeCase(c);
  const risk = k.score.items.find(x => x.key === 'rights_risk');
  assert.equal(risk.stars, null);
  assert.equal(k.score.rated_count, k.score.items.length - 1);
});

// ── 신탁공매(신탁법 제4조·제22조) ──────────────────────────────────────
const trustBase = over => ({
  id: 'onbid-20260700099999',
  source: { checked_at: '2026-09-27', type: 'onbid' },
  case: {
    number: '2026-0700-099999', court: '무궁화신탁', category: 'apartment',
    onbid_property_type: '신탁공매', trust_registered_on: '2021-06-01',
    region: '가상시 가상구 가상동 123 가상빌딩 201호',
  },
  sale: { appraisal: 500000000, minimum: 400000000, sale_date: '2026-10-01' },
  rights: [{ date: '2020-05-10', receipt_no: 100, kind: '근저당권', amount: 300000000, holder_type: '은행' }],
  tenants: [],
  ...over,
});

test('신탁공매: source.type=onbid인데 onbid_property_type이 압류재산·신탁공매가 아니면 막음, 신탁공매는 trust_registered_on 필수', () => {
  const bad = trustBase({ case: { ...trustBase().case, onbid_property_type: '기타일반재산' } });
  assert.match(validateCase(bad).join('\n'), /압류재산 또는 신탁공매만 지원/);

  const noDate = trustBase();
  delete noDate.case.trust_registered_on;
  assert.match(validateCase(noDate).join('\n'), /trust_registered_on/);

  assert.deepEqual(validateCase(trustBase()), []);
});

test('신탁공매: 등기 권리는 소멸/인수를 판정하지 않고 전부 "검토"로 남긴다', () => {
  const k = computeCase(trustBase());
  assert.equal(k.disposal_type, '신탁공매');
  assert.equal(k.base_right, null);
  assert.equal(k.rights[0].effect, '검토');
  assert.ok(k.review.some(r => r.includes('말소기준권리 개념이 적용되지 않음')));
  assert.equal(k.assumed_total_min, null);
  assert.equal(k.assumed_total_max, null);
});

test('신탁공매: 임차인 전입일이 신탁등기일보다 앞이면 대항력 유지 가능성, 뒤면 수탁자 동의 필요로 구분해 review에 남긴다', () => {
  const before = computeCase(trustBase({ tenants: [tenant({ registered_on: '2021-01-01' })] })); // 신탁등기(06-01)보다 앞
  assert.equal(before.tenants[0].effect, '검토');
  assert.ok(before.review.some(r => r.includes('신탁 전 전입') || r.includes('대항력을 유지할 가능성이 높')));

  const after = computeCase(trustBase({ tenants: [tenant({ registered_on: '2022-01-01' })] })); // 신탁등기 뒤
  assert.ok(after.review.some(r => r.includes('수탁자 동의 없이 설정된 임대차는 원칙적으로 매수인에게 대항하지 못')));
});
