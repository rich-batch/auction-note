#!/usr/bin/env node
// 사건 데이터를 검증하고 권리분석 결과를 data/cases/<id>.json의 "computed"에 써 넣는다.
//   node tools/analysis/compute.mjs <id>     한 건
//   node tools/analysis/compute.mjs --all    전부 (입력이 바뀐 것만 다시 씀)
// computed는 이 스크립트만 쓴다. 사람·AI는 입력(case, sale, rights, tenants, special, spec_sheet)만 고친다.
import fs from 'node:fs';
import { casePath, articleExists } from '../lib/paths.mjs';
import { listCaseIds, loadCase, isComputedFresh } from '../lib/cases.mjs';
import { validateCase, computeCase } from './rights.mjs';

const arg = process.argv[2];
if (!arg) { console.error('사용법: compute.mjs <case-id> | --all'); process.exit(2); }
const ids = arg === '--all' ? listCaseIds() : [arg];
const won = v => v == null ? '미상' : `${v.toLocaleString('ko-KR')}원`;

let failed = false;
for (const id of ids) {
  const c = loadCase(id);
  const errors = validateCase(c);
  if (errors.length) {
    failed = true;
    console.log(`INVALID data/cases/${id}.json`);
    errors.forEach(e => console.log(`- ${e}`));
    continue;
  }
  if (arg === '--all' && isComputedFresh(c)) { console.log(`SKIP ${id} (최신)`); continue; }
  const hadComputed = !!c.computed;
  c.computed = computeCase(c);
  fs.writeFileSync(casePath(id), `${JSON.stringify(c, null, 2)}\n`);

  const k = c.computed;
  console.log(`OK ${id}`);
  console.log(`  말소기준권리: ${k.base_right ? `${k.base_right.date} ${k.base_right.kind}` : '없음'}`);
  k.rights.filter(r => r.effect !== '해당 없음').forEach(r => console.log(`  [${r.effect}] ${r.date} ${r.kind}${r.amount ? ` ${won(r.amount)}` : ''} — ${r.reason}`));
  k.tenants.forEach(t => console.log(`  [임차인 ${t.effect}] ${t.use} ${t.registered_on ?? '일자 미상'} 보증금 ${won(t.deposit)} — ${t.reason}`));
  console.log(`  인수 예상: ${won(k.assumed_total_min)} ~ ${won(k.assumed_total_max)}${k.ownership_risk ? ' + 소유권 상실 위험 권리 있음' : ''}`);
  console.log(`  최저가 ${won(c.sale.minimum)} (감정가의 ${k.minimum_ratio}%), 입찰보증금 ${won(k.bid_deposit)}`);
  if (k.review.length) {
    console.log('  사람이 확인할 것:');
    k.review.forEach(r => console.log(`  ! ${r}`));
  }
  if (hadComputed && articleExists('analysis', id)) {
    console.log(`  ※ 입력이 바뀌어 다시 계산함 — content/analysis/${id}/index.md가 새 결과와 맞는지 검토`);
  }
}
process.exit(failed ? 1 : 0);
