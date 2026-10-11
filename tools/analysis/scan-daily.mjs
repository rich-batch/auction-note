#!/usr/bin/env node
// 공매(온비드)와 경매(관심 법원, data/courts-of-interest.json)를 같은 날짜 기준으로 한 번에
// 훑는다. 각자의 스캔 스크립트를 그대로 실행할 뿐이다 — 특히 법원경매 쪽은 세션 공유·
// 법원 전환마다 1분 지연 같은 차단 예방 로직을 scan-court.mjs가 이미 갖고 있어서, 그 로직을
// 다시 만들지 않고 그대로 재사용한다. 사건을 등록하지는 않는다(지금까지와 동일하게
// fetch-onbid.mjs / fetch-court.mjs로 사람이 고른 것만 등록).
//
//   node tools/analysis/scan-daily.mjs --date 2026-10-12
//   node tools/analysis/scan-daily.mjs --date 2026-10-12 --min-price 10000000 --include-share
//
// --min-price·--include-share는 두 스캔에 그대로 전달된다 — 분석 가치가 낮은 물건(최저가가
// 너무 낮은 자투리·공유지분)을 기본으로 걸러 스캔 결과와 이어지는 분석 작업의 토큰을 아낀다
// (기준은 tools/lib/candidate-filter.mjs). 경매 쪽은 관심 법원이 여러 개면 법원 수 x 1분
// 이상 걸릴 수 있다 — 급하면 scan-court.mjs --court <코드>로 법원 하나만 따로 조회한다.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dateArg = args.find(a => a.startsWith('--date='))?.slice('--date='.length)
  ?? (args.includes('--date') ? args[args.indexOf('--date') + 1] : null);
if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  console.error('사용법: scan-daily.mjs --date YYYY-MM-DD [--min-price N] [--include-share]');
  console.error('  공매(온비드)와 경매(관심 법원)를 이 날짜 기준으로 함께 훑는다.');
  process.exit(2);
}

function run(label, script) {
  console.log(`\n${'='.repeat(8)} ${label} ${'='.repeat(8)}`);
  const result = spawnSync('node', [path.join(__dirname, script), ...args], { stdio: 'inherit' });
  if (result.error) console.error(`${label} 실행 실패: ${result.error.message}`);
  else if (result.status !== 0) console.error(`${label} 스캔이 오류로 종료됨(exit ${result.status})`);
}

run('공매(온비드)', 'scan-onbid.mjs');
run('경매(관심 법원)', 'scan-court.mjs');
