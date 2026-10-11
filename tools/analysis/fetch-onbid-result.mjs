#!/usr/bin/env node
// 온비드 사건의 매각 결과를 온비드 "물건입찰결과"(로그인 불필요)에서 찾아 보여 주고, --write면 result에 넣는다.
//   node tools/analysis/fetch-onbid-result.mjs <id> [--write]
// 분석한 회차(sale.sale_date) 결과가 result.outcome이 되고, 그 뒤 회차(예: 첫 회차 유찰 → 다음 회차 낙찰)는 result.later에 쌓인다.
// 결과 페이지(/results/<id>/)와 분석 글 맨 위 배너가 이 값으로 자동으로 그려진다.
import fs from 'node:fs';
import { loadCase } from '../lib/cases.mjs';
import { casePath, todayKST } from '../lib/paths.mjs';
import { searchOnbidBidResults, onbidResultFor } from '../lib/onbid.mjs';

const id = process.argv[2];
if (!id || id.startsWith('--')) { console.error('사용법: node tools/analysis/fetch-onbid-result.mjs <id> [--write]'); process.exit(2); }
const c = loadCase(id);
if (c.source?.type !== 'onbid') { console.error(`${id}는 온비드 사건이 아님 — 법원경매 결과는 법원경매정보에서 확인해 직접 넣는다`); process.exit(2); }

const today = todayKST();
const day = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const start = day(c.sale.sale_date, -7);
const end = day(today, -1); // 종료일은 과거만 조회된다
const rows = await searchOnbidBidResults({
  srchCltrType: c.case.category === 'car' ? '0002' : '0001',
  srchCltrMnmtNo: c.case.number,
  srchOpbdBgdd: start, calOpbdBgdd: start, srchOpbdEndd: end, calOpbdEndd: end,
  pageIndex: '1', pageUnit: '50',
});
const result = onbidResultFor(c, rows, today);
if (!result) { console.log(`분석한 회차(${c.sale.sale_date}) 결과가 아직 공개되지 않음`); process.exit(0); }

const won = n => (n == null ? '-' : `${n.toLocaleString('ko-KR')}원`);
console.log(`${c.sale.sale_date} (분석한 회차): ${result.outcome}${result.winning_bid ? ` ${won(result.winning_bid)}` : ''}, 응찰 ${result.bidders ?? 0}명`);
for (const r of result.later ?? []) console.log(`${r.date} (이후 회차, 최저가 ${won(r.minimum)}): ${r.outcome}${r.winning_bid ? ` ${won(r.winning_bid)}` : ''}, 응찰 ${r.bidders ?? 0}명`);

if (process.argv.includes('--write')) {
  const file = casePath(id);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.result = result;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`\n${file}의 result를 바꿨다(이전 값은 덮어씀). result는 계산에 쓰이지 않아 compute.mjs는 다시 돌리지 않아도 된다.`);
}
