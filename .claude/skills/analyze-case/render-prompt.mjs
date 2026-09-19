#!/usr/bin/env node
// 물건 분석 글 작성 지시문을 만든다.
//   render-prompt.mjs --list            사건별 단계
//   render-prompt.mjs --case <id>       한 건 (단계가 "글 작성 대기"여야 함, --revise면 기존 글 고쳐쓰기)
//   render-prompt.mjs --next 1          글 작성 대기 중 매각기일이 가까운 순 N건
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { articlePath, listArticles, researchPath, rel, todayKST } from '../../../tools/lib/paths.mjs';
import { listCaseIds, loadCase, caseStage } from '../../../tools/lib/cases.mjs';
import { loadGlossary, relrefFor } from '../../../tools/lib/glossary.mjs';
import { categoryName } from '../../../tools/lib/categories.mjs';

const skillDir = path.dirname(fileURLToPath(import.meta.url));
const args = {};
const argv = process.argv.slice(2);
argv.forEach((a, i) => {
  if (a.startsWith('--')) args[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
});

const today = todayKST();
const cases = listCaseIds().map(id => { const c = loadCase(id); return { c, stage: caseStage(c, today) }; });

if (args.list) {
  if (!cases.length) console.log('사건 데이터 없음 (data/cases/*.json)');
  for (const { c, stage } of cases) console.log(`${c.id} | ${c.case.number} | 매각기일 ${c.sale.sale_date} | ${stage}`);
  process.exit(0);
}

let targets;
if (args.case) {
  const t = cases.find(x => x.c.id === args.case);
  if (!t) { console.error(`사건 데이터 없음: data/cases/${args.case}.json`); process.exit(1); }
  if (t.stage === '계산 필요') { console.error(`계산이 최신이 아님: node tools/analysis/compute.mjs ${args.case} 먼저 실행`); process.exit(1); }
  if (t.stage !== '글 작성 대기' && !args.revise) { console.log(`SKIPPED: ${args.case} (단계: ${t.stage}) — 고쳐 쓰려면 --revise`); process.exit(0); }
  targets = [t.c];
} else {
  const n = Number(args.next ?? 1);
  targets = cases
    .filter(x => x.stage === '글 작성 대기' && x.c.sale.sale_date >= today)
    .sort((x, y) => x.c.sale.sale_date.localeCompare(y.c.sale.sale_date))
    .slice(0, n)
    .map(x => x.c);
  if (!targets.length) { console.log('생성할 대상 없음 (글 작성 대기이면서 매각기일이 지나지 않은 사건 없음)'); process.exit(0); }
}

const tpl = fs.readFileSync(path.join(skillDir, 'templates', 'analysis.md'), 'utf8');
const won = v => v == null ? '미상' : `${v.toLocaleString('ko-KR')}원`;

function computedSummary(c) {
  const k = c.computed;
  const lines = [`- 말소기준권리: ${k.base_right ? `${k.base_right.date} ${k.base_right.kind}` : '정하지 못함'}`];
  k.rights.filter(x => x.effect !== '해당 없음').forEach(x => lines.push(`- 등기 [${x.effect}] ${x.date} ${x.kind}${x.amount ? ` ${won(x.amount)}` : ''} — ${x.reason}`));
  k.tenants.forEach(t => lines.push(`- 임차인 ${t.index + 1} [${t.effect}] ${t.use} ${t.registered_on ?? '일자 미상'}, 보증금 ${won(t.deposit)}, 인수 ${won(t.assumed_min)} ~ ${won(t.assumed_max)} — ${t.reason}`));
  if (!k.tenants.length) lines.push('- 임차인: 매각물건명세서상 없음');
  lines.push(`- 매수인 인수 예상 합계: ${won(k.assumed_total_min)} ~ ${won(k.assumed_total_max)}${k.ownership_risk ? ' (+ 소유권 상실 위험 권리 있음)' : ''}`);
  lines.push(`- 최저가 + 인수 예상: ${won(k.minimum_plus_assumed_min)} ~ ${won(k.minimum_plus_assumed_max)}`);
  lines.push(`- 최저가는 감정가의 ${k.minimum_ratio}%, 입찰보증금 ${won(k.bid_deposit)}(최저가의 ${Math.round(k.deposit_rate * 100)}%)`);
  return lines.join('\n');
}

const glossary = loadGlossary();
const glossaryText = glossary.map(t => {
  if (t.state === 'published') return `- ${t.term} → 링크: [${t.term}](${relrefFor(t.guide)})`;
  if (t.state === 'none') return `- ${t.term} → 가이드 없음 (보고의 "가이드 후보"에 적어라)`;
  return `- ${t.term} → 가이드 ${t.state === 'draft' ? '초안' : '예정'}(${t.guide}) — 링크하지 마라`;
}).join('\n');

const existing = listArticles('analysis').map(id => {
  const text = fs.readFileSync(articlePath('analysis', id), 'utf8');
  return `- ${text.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? id} (/analysis/${id})`;
}).join('\n') || '(없음)';

for (const c of targets) {
  const input = { ...c };
  delete input.computed;
  const vars = {
    id: c.id,
    number: c.case.number,
    category_name: categoryName(c.case.category),
    category_note: c.case.category === 'land'
      ? '## 토지 사건 추가 지침\n- 임차인이 없는 사건으로 다룬다. `## 임차인과 점유`는 "점유 현황" 관점(실제 점유자·지상 건물·농작물)으로 짧게 쓰고, 소제목 이름은 그대로 둔다.\n- 위 review의 법정지상권·지목/맹지·농지취득자격증명은 `## 입찰 전 확인할 것`에 빠짐없이 옮긴다.\n- 지목·면적·용도지역이 사건 데이터에 없으면 지어내지 말고 `[확인 필요: …]`.\n'
      : '',
    date: today,
    checked_at: c.source?.checked_at ?? '(없음)',
    article_path: rel(articlePath('analysis', c.id)),
    research_path: rel(researchPath('analysis', c.id)),
    case_json: JSON.stringify(input, null, 2),
    computed_summary: computedSummary(c),
    review: c.computed.review.map(x => `- ${x}`).join('\n') || '(없음)',
    glossary: glossaryText,
    existing_analyses: existing,
  };
  console.log(`\n=== JOB mode=${args.revise ? 'revise' : 'new'} case=${c.id} number=${c.case.number} output=${vars.article_path} research=${vars.research_path}`);
  console.log(tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m));
}
