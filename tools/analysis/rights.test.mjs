// 권리분석 엔진 테스트. 모든 사건은 규칙 확인용 가상 데이터다.
//   node --test tools/analysis/
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCase, computeCase, inputHash } from './rights.mjs';

const base = over => ({
  id: 'test-2026ta100',
  case: { number: '2026타경100', court: '가상지방법원', property_type: '아파트', region: '가상시 가상구 가상동' },
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

test('검증: 개인정보 필드·번지·형식 오류를 막음', () => {
  assert.deepEqual(validateCase(base()), []);
  const c = base();
  c.rights[0].holder_name = '홍길동';
  c.case.region = '가상시 가상구 가상동 123-4';
  c.tenants = [tenant({ note: '연락처 010-1234-5678' })];
  c.id = 'test-2026ta999';
  const errors = validateCase(c).join('\n');
  assert.match(errors, /holder_name: 개인정보/);
  assert.match(errors, /법정동까지만/);
  assert.match(errors, /전화번호/);
  assert.match(errors, /사건번호 토큰/);
});

test('입력 해시: result나 market을 바꿔도 그대로, 권리를 바꾸면 달라짐', () => {
  const c = base();
  const h = inputHash(c);
  c.result = { outcome: '매각', winning_bid: 410000000 };
  c.market = { trades: [] };
  assert.equal(inputHash(c), h);
  c.rights[0].amount = 1;
  assert.notEqual(inputHash(c), h);
});

test('검증: 주말 매각기일은 막음(달력이 평일만 그림)', () => {
  assert.match(validateCase(base({ sale: { ...base().sale, sale_date: '2026-10-03' } })).join('\n'), /주말/);
  assert.match(validateCase(base({ sale: { ...base().sale, sale_date: '2026-10-04' } })).join('\n'), /주말/);
  assert.deepEqual(validateCase(base({ sale: { ...base().sale, sale_date: '2026-10-05' } })), []);
});
