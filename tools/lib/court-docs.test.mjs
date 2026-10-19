import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTenantsFromStatusReport } from './court-docs.mjs';

// 다세대 여러 호실을 물건번호별로 파는 사건: 현황조사서는 사건 전체 호실을 한꺼번에 돌려준다.
const data = {
  dlt_ordTsRlet: [
    { objctSeq: 1, auctnPossRltnCd: '02', printSt: '경기도 수원시 권선구 덕영대로 1053, 1층101호 (세류동,발리빌)' },
    { objctSeq: 2, auctnPossRltnCd: '02', printSt: '경기도 수원시 권선구 덕영대로 1053, 2층201호 (세류동,발리빌)' },
    { objctSeq: 9, auctnPossRltnCd: '09', printSt: '경기도 수원시 권선구 덕영대로 1053, 4층402호 (세류동,발리빌)' },
  ],
  dlt_ordTsLserLtn: [
    { objctSeq: 1, auctnIntrpsDvsCd: '0001562', auctnLesUsgCd: '02', mvinDtlCtt: '2021.07.07' },
    { objctSeq: 2, auctnIntrpsDvsCd: '0001562', auctnLesUsgCd: '01', mvinDtlCtt: '2021.08.17' },
  ],
};

test('region과 같은 호실의 임차인만 쓴다', () => {
  const { tenants, special } = buildTenantsFromStatusReport(data, { region: '경기도 수원시 권선구 덕영대로 1053, 2층201호 (세류동,발리빌)' });
  assert.equal(tenants.length, 1);
  assert.equal(tenants[0].registered_on, '2021-08-17');
  assert.equal(special.filter(s => s.kind === '점유관계 확인 필요').length, 0);
});

test('일치하는 호실이 없으면 전부 쓴다', () => {
  const { tenants } = buildTenantsFromStatusReport(data, { region: '다른 주소' });
  assert.equal(tenants.length, 2);
  assert.equal(buildTenantsFromStatusReport(data).tenants.length, 2);
});
