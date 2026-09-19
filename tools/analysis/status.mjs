#!/usr/bin/env node
// 사건별 현재 단계와 다음에 할 일을 보여 준다.
//   node tools/analysis/status.mjs
import { listCaseIds, loadCase, caseStage } from '../lib/cases.mjs';

const NEXT = {
  '계산 필요': id => `node tools/analysis/compute.mjs ${id}`,
  '글 작성 대기': id => `analyze-case 스킬로 글 작성 (또는 tools/auto/run-one.sh analysis ${id})`,
  '검토 대기': id => `content/analysis/${id}/index.md 검토 후 draft: false`,
  '발행됨': () => '매각기일까지 대기',
  '결과 입력 필요': id => `data/cases/${id}.json의 result 입력 (법원경매정보 매각결과)`,
  '종료': () => '-',
};

const ids = listCaseIds();
if (!ids.length) { console.log('사건 데이터 없음 (data/cases/*.json). 새 사건: node tools/analysis/new-case.mjs <id> <사건번호>'); process.exit(0); }
for (const id of ids) {
  const c = loadCase(id);
  const stage = caseStage(c);
  console.log(`${id} | ${c.case?.number ?? '?'} | 매각기일 ${c.sale?.sale_date ?? '?'} | ${stage} → ${NEXT[stage](id)}`);
}
