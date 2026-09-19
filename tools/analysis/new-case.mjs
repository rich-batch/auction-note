#!/usr/bin/env node
// 빈 사건 데이터 파일을 만든다. 값은 사람이 매각물건명세서·등기사항전부증명서·현황조사서를 보고 채운다.
//   node tools/analysis/new-case.mjs seoul-central-2026ta12345 2026타경12345 apartment
//   (분류: data/categories.json — apartment villa commercial land car)
import fs from 'node:fs';
import { casePath, casesDir, ID_RE, rel, todayKST } from '../lib/paths.mjs';
import { CATEGORIES, categoryBySlug } from '../lib/categories.mjs';

const [id, number, category = ''] = process.argv.slice(2);
if (!id || !number) { console.error(`사용법: new-case.mjs <id> <사건번호> [분류]  예: new-case.mjs seoul-central-2026ta12345 2026타경12345 apartment\n분류: ${CATEGORIES.map(c => c.slug).join(' ')}`); process.exit(2); }
if (category && !categoryBySlug(category)) { console.error(`분류는 ${CATEGORIES.map(c => c.slug).join(' / ')} 중 하나`); process.exit(2); }
if (!ID_RE.test(id)) { console.error('id는 영문 소문자·숫자·하이픈'); process.exit(2); }
if (fs.existsSync(casePath(id))) { console.error(`이미 있음: ${rel(casePath(id))}`); process.exit(1); }

const tpl = {
  id,
  source: { checked_at: todayKST(), documents: ['매각물건명세서', '등기사항전부증명서', '현황조사서'], note: '' },
  case: { number, item_no: 1, court: '', kind: '임의경매', category, region: '', area_m2: null },
  sale: { appraisal: 0, minimum: 0, failed_rounds: 0, sale_date: '', dividend_deadline: null, resale: false },
  rights: [
    { date: '', receipt_no: null, kind: '근저당권', amount: null, holder_type: '은행', note: '' },
  ],
  tenants: [],
  special: [],
  spec_sheet: { base_right_text: '', surviving_rights_text: '', superficies_text: '', remarks: '' },
  market: { trades: [], source_url: null, checked_at: null },
  result: { outcome: null, winning_bid: null, bidders: null, checked_at: null },
};
fs.mkdirSync(casesDir, { recursive: true });
fs.writeFileSync(casePath(id), `${JSON.stringify(tpl, null, 2)}\n`);
console.log(`만듦: ${rel(casePath(id))}\n필드 설명: tools/analysis/README.md`);
