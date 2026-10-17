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
import { titleSkeleton, riskTags, OBJECT_RULE } from '../../../tools/lib/title.mjs';

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
  if (k.price_gap) lines.push(`- 시세: ${k.price_gap.basis_label} 평균 ${won(k.price_gap.market_avg)}(${k.price_gap.trade_count}건), 최저가와 차이 ${won(k.price_gap.diff_minimum)}(떠안을 금액 제외) / 최저가+인수부담 기준 ${won(k.price_gap.gap_min)} ~ ${won(k.price_gap.gap_max)}`);
  else lines.push('- 시세: market.trades 없음 — 가격 수준 별점은 감정가 대비(자동차는 별점 없음)');
  lines.push(`- 확인 지표 점수: 종합 ${k.score.total_stars ?? '확인 필요'} / 5 (계산 가능 ${k.score.rated_count}개)`);
  k.score.items.forEach(x => lines.push(`  - ${x.label}: ${x.value} → ${x.stars ?? '확인 필요'}점 — ${x.note}`));
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

// 같은 구·동에서 이미 발행한 분석 글 — 본문에서 "이 블로그가 앞서 본 옆 사건"으로 비교·링크한다(초안은 링크 금지)
const published = listArticles('analysis').filter(id => /^draft:\s*false\s*$/m.test(fs.readFileSync(articlePath('analysis', id), 'utf8')));
const district = r => (r ?? '').split(/\s+/).slice(0, 2).join(' ');
const dong = r => (r ?? '').split(/\s+/).slice(0, 3).join(' ');
function nearby(c) {
  const rows = published.filter(id => id !== c.id).map(id => { try { return loadCase(id); } catch { return null; } })
    .filter(o => o && district(o.case.region) === district(c.case.region))
    .map(o => {
      const r = o.result ?? {};
      const last = (r.later ?? []).at(-1) ?? r;
      const res = last.outcome ? `${last.outcome}${last.winning_bid ? ` ${won(last.winning_bid)}` : ''}${last.bidders ? `, 응찰 ${last.bidders}명` : ''}` : '결과 미입력';
      const k = o.computed ?? {};
      return `- ${dong(o.case.region) === dong(c.case.region) ? '[같은 동] ' : ''}${o.case.region} | ${categoryName(o.case.category)} | 감정가 ${won(o.sale?.appraisal)} · 최저가 ${won(o.sale?.minimum)} | 인수 예상 ${won(k.assumed_total_min)} ~ ${won(k.assumed_total_max)} | 결과: ${res} | 링크: [${o.case.number}]({{< relref "/analysis/${o.id}" >}})`;
    });
  return rows.join('\n') || '(같은 구에서 발행한 분석 글 없음)';
}

for (const c of targets) {
  const input = { ...c };
  delete input.computed;
  const vars = {
    id: c.id,
    number: c.case.number,
    category_name: categoryName(c.case.category),
    category_note: c.case.category === 'land'
      ? '## 토지 사건 추가 지침\n- 임차인이 없는 사건으로 다룬다. `## 임차인과 점유`는 "점유 현황" 관점(실제 점유자·지상 건물·농작물)으로 짧게 쓰고, 소제목 이름은 그대로 둔다.\n- 위 review의 법정지상권·지목/맹지·농지취득자격증명은 `## 입찰 전 확인할 것`에 빠짐없이 옮긴다.\n- 지목·면적·용도지역이 사건 데이터에 없으면 지어내지 말고 `[확인 필요: …]`.\n'
      : c.case.category === 'car'
        ? '## 자동차 사건 추가 지침\n- 이 사건은 임차인이 없다 — 자동차에는 주택임대차보호법 같은 대항력 있는 임차권 개념 자체가 없다(민사집행규칙 제108조가 부동산 강제경매 규정을 준용하되 "등기"를 "등록"으로 볼 뿐). `## 임차인과 점유`는 "점유 현황" 관점(현재 보관 장소·유치권 위험)으로 짧게 쓰고, **소제목 이름은 "## 임차인과 점유" 그대로 둔다**(검사 스크립트가 이 이름을 찾는다).\n- `## 권리분석`에서 "말소기준권리"라는 말을 쓰지 마라 — `computed.base_right`는 항상 없다. 대신 등록된 담보물권이 순서와 무관하게 전부 소멸한다는 것(국세징수법 제92조제1항)과 그 이유를 한 문단으로 짧게 설명한다.\n- 입력 서류는 등기사항전부증명서가 아니라 자동차등록원부·공매재산명세서라고 정확히 쓴다.\n- `## 확인 지표 요약`: 자동차의 "가격 수준"은 감정가가 아니라 비슷한 차량 시세 대비로 매긴다(감정가는 중고차 시세를 반영하지 못한다고 한 문장으로 설명) — 시세가 없으면 별점 없이 참고용이다. 가격은 "비슷한 차량 시세"(computed.price_gap.by_source)로 말한다: 출처별 평균과 최저가의 차이를 그대로 전하고, 출처 성격(온비드 낙찰가 = 같은 공매에서 실제 팔린 값, 자동차365 = 양도증명서 기준 평균, 당근 = 판매 희망가라 실거래보다 높게 나옴)을 밝힌다. 비교 사례와 연식·주행거리 차이가 크면 그 점도 쓴다. 시세 데이터가 없으면 "이 글에서는 비슷한 차 시세를 확인하지 못했다"와 확인할 곳(자동차365 평균매매가조회)을 `## 입찰 전 확인할 것`에 쓴다.\n'
        : ['국유재산', '공유재산'].includes(c.case.onbid_property_type)
          ? `## ${c.case.onbid_property_type} 사건 추가 지침\n- 이 사건은 임차인이 없다 — ${c.case.onbid_property_type}은 사권(私權)이 소멸된 후에만 취득되는 것이 원칙(${c.case.onbid_property_type === '공유재산' ? '공유재산법 제8조' : '국유재산법 제11조'})이라 대항력 판정 자체가 생기지 않는다. \`## 임차인과 점유\`는 "점유 현황" 관점(사용허가·대부 사용자가 있는지, review 항목)으로 짧게 쓰고, **소제목 이름은 "## 임차인과 점유" 그대로 둔다**(검사 스크립트가 이 이름을 찾는다).\n- \`## 권리분석\`에서 "말소기준권리"라는 말을 쓰지 마라 — \`computed.base_right\`는 항상 없다. rights가 비어 있으면 그게 정상이라는 것을, 있으면 왜 이례적인지(review 항목)를 설명한다.\n- 입력 서류는 등기사항전부증명서가 아니라 공고문·사용허가·대부계약 현황이라고 정확히 쓴다.\n`
          : c.case.onbid_property_type === '기타일반재산'
            ? '## 기타일반재산 사건 추가 지침\n- 위임기관마다 매각 근거 법령이 달라 등기·점유 관계를 코드가 전부 검토로 남긴다는 것을 `## 권리분석`에서 분명히 밝힌다. "말소기준권리"라는 말을 쓰지 마라.\n- `## 임차인과 점유`는 "점유 현황"으로 쓰고, 위임기관·공고문을 직접 확인해야 한다는 review 항목을 옮긴다.\n'
            : '',
    title_skeleton: titleSkeleton(c),
    risk_tags: riskTags(c).map(t => `"${t}"`).join(', '),
    object_rule: OBJECT_RULE[c.case.category] ?? '물건을 알아볼 수 있는 이름',
    date: today,
    checked_at: c.source?.checked_at ?? '(없음)',
    // 참고 자료·조사 노트에 적을 사건 자료 줄 — 이 블로그가 실제로 본 공개 자료만. 등기사항전부증명서는 유료라 열람하지 않는다
    source_line: c.source?.type === 'onbid'
      ? `[온비드 공매재산명세](https://www.onbid.co.kr/) — 물건관리번호 ${c.case.number} 물건 상세·공매재산명세서·온비드 공개 등기 요약 (확인일 ${c.source?.checked_at ?? '(없음)'})`
      : `[대법원 법원경매정보 · ${c.case.number} 사건 검색](https://www.courtauction.go.kr/) — 매각물건명세서 요약(최선순위 설정·매각으로 소멸되지 않는 권리)·현황조사서·기일 내역 (확인일 ${c.source?.checked_at ?? '(없음)'})`,
    article_path: rel(articlePath('analysis', c.id)),
    research_path: rel(researchPath('analysis', c.id)),
    case_json: JSON.stringify(input, null, 2),
    computed_summary: computedSummary(c),
    review: c.computed.review.map(x => `- ${x}`).join('\n') || '(없음)',
    glossary: glossaryText,
    existing_analyses: existing,
    nearby_cases: nearby(c),
  };
  console.log(`\n=== JOB mode=${args.revise ? 'revise' : 'new'} case=${c.id} number=${c.case.number} output=${vars.article_path} research=${vars.research_path}`);
  console.log(tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m));
}
