#!/usr/bin/env node
// 아직 글이 없는 대상 ID를 우선순위대로 한 줄에 하나씩 출력한다 (자동화 배치용).
//   node tools/pending.mjs guide [N]      keywords.csv priority 순, content/guide/<slug>/가 없는 slug
//   node tools/pending.mjs analysis [N]   단계가 "글 작성 대기"이고 매각기일이 지나지 않은 사건, 매각기일 가까운 순
import fs from 'node:fs';
import { parseCSV } from './lib/csv.mjs';
import { articleExists, keywordsPath, todayKST } from './lib/paths.mjs';
import { listCaseIds, loadCase, caseStage } from './lib/cases.mjs';

const [type, n = '1'] = process.argv.slice(2);
const limit = Number(n);
let ids;
if (type === 'guide') {
  ids = parseCSV(fs.readFileSync(keywordsPath, 'utf8'))
    .filter(r => r.slug && r.priority)
    .sort((a, b) => Number(a.priority) - Number(b.priority))
    .filter(r => !articleExists('guide', r.slug))
    .map(r => r.slug);
} else if (type === 'analysis') {
  const today = todayKST();
  ids = listCaseIds().map(loadCase)
    .filter(c => caseStage(c, today) === '글 작성 대기' && c.sale.sale_date >= today)
    .sort((a, b) => a.sale.sale_date.localeCompare(b.sale.sale_date))
    .map(c => c.id);
} else {
  console.error('사용법: pending.mjs <guide|analysis> [N]');
  process.exit(2);
}
ids.slice(0, limit).forEach(id => console.log(id));
