#!/usr/bin/env node
// 온비드에서 특정 날짜(또는 앞으로 N일 안)에 매각(개찰)되는 물건 후보를 찾아 나열한다.
// 사건을 등록하지는 않는다 — 후보만 보여주고, 관심 있는 것만 사람이 골라서
// node tools/analysis/fetch-onbid.mjs <물건관리번호>로 등록한다.
//
//   node tools/analysis/scan-onbid.mjs --date 2026-10-05     그 날 개찰하는 물건만
//   node tools/analysis/scan-onbid.mjs --days 7               오늘부터 7일 안에 개찰하는 물건 (기본 7)
//
// 이미 data/cases/*.json에 등록된 물건(사건번호로 대조)은 목록에서 뺀다.
// 분석 가치가 낮은 물건(최저가 너무 낮음·공유지분)은 기본으로 목록에서 생략한다(토큰 절약,
// tools/lib/candidate-filter.mjs). --min-price=0 --include-share로 전부 볼 수 있다.
// 지원하는 재산유형(압류재산·국유재산·공유재산·기타일반재산)만 보여준다 — 신탁공매는 온비드가
// 재산유형을 따로 표시하지 않아 이 목록만으로 못 찾는다(위임기관 이름에 "신탁"이 있으면 후보로
// 표시). 그 외(동산·유가증권 등)는 지금 계산 엔진이 없어 후보로 의미가 없어 뺀다.
//
// 온비드의 검색 조건(srchCltrType)은 물건 유형별로 여러 풀로 나뉘어 있는 것으로 보이는데
// (예: 압류재산 부동산은 대체로 0002·0003, 국유재산·공유재산·기타일반재산은 0001에서 많이
// 보임) 정확한 분류 기준까지는 확인하지 못했다 — 그래서 알려진 값을 모두 조회해 합친다.
// 결과가 이상하게 적으면 온비드 사이트에서 직접 검색해 대조해 보는 것을 권장한다.
import { listCaseIds, loadCase } from '../lib/cases.mjs';
import { todayKST } from '../lib/paths.mjs';
import { guessCategory, searchOnbid } from '../lib/onbid.mjs';
import { evaluateCandidate, parseFilterArgs, formatSkippedSummary } from '../lib/candidate-filter.mjs';

const args = process.argv.slice(2);
const dateArg = args.find(a => a.startsWith('--date='))?.slice('--date='.length)
  ?? (args.includes('--date') ? args[args.indexOf('--date') + 1] : null);
const daysArg = args.find(a => a.startsWith('--days='))?.slice('--days='.length)
  ?? (args.includes('--days') ? args[args.indexOf('--days') + 1] : null);
if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  console.error('사용법: scan-onbid.mjs --date YYYY-MM-DD | --days N [--min-price N] [--include-share]');
  process.exit(2);
}
const filterOpts = parseFilterArgs(args);

const today = todayKST();
const [fromDate, toDate] = dateArg ? [dateArg, dateArg] : [today, addDays(today, Number(daysArg ?? 7))];

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const SUPPORTED_TYPES = ['압류재산', '국유재산', '공유재산', '기타일반재산'];
// 경험적으로 이 값들에서 대상 재산유형이 나왔다(위 파일 주석 참고) — 온비드 분류 기준 전체를
// 확인한 건 아니라서 값을 늘려야 할 수도 있다.
const SRCH_CLTR_TYPES = ['0001', '0002', '0003'];

const seen = new Map(); // scrnIndctCltrMngNo → row
for (const t of SRCH_CLTR_TYPES) {
  let data;
  try {
    data = await searchOnbid({ pageIndex: '1', pageUnit: '300', srchCltrType: t });
  } catch (e) {
    console.error(`srchCltrType=${t} 조회 실패: ${e.message}`);
    continue;
  }
  for (const it of data.cltrInfVOList ?? []) {
    const mgmt = it.scrnIndctCltrMngNo;
    if (mgmt && !seen.has(mgmt)) seen.set(mgmt, it);
  }
}

const registeredNumbers = new Set(listCaseIds().map(id => loadCase(id).case?.number).filter(Boolean));

const candidates = [...seen.values()].filter(it => {
  const type = it.scrnPrptDvsnNm ?? it.prptDvsnNm;
  if (!SUPPORTED_TYPES.includes(type)) return false;
  if (!/^\d{4}-\d+-\d+$/.test(it.scrnIndctCltrMngNo ?? '')) return false;
  if (!/^입찰(중|시작 전)/.test(it.remainTime ?? '')) return false;
  const saleDate = (it.pbctExctDt || '').slice(0, 10);
  if (!saleDate || saleDate < fromDate || saleDate > toDate) return false;
  if (registeredNumbers.has(it.scrnIndctCltrMngNo)) return false;
  return true;
}).sort((a, b) => (a.pbctExctDt ?? '').localeCompare(b.pbctExctDt ?? ''));

const rangeLabel = dateArg ? dateArg : `${fromDate} ~ ${toDate}`;
if (!candidates.length) {
  console.log(`${rangeLabel}에 개찰하는 후보 없음 (지원 재산유형: ${SUPPORTED_TYPES.join('·')}, 이미 등록된 사건 제외)`);
  console.log('결과가 예상보다 적으면 온비드 사이트(condition 검색)에서 직접 대조해 보세요 — 검색 조건 풀을 다 알지 못한다.');
  process.exit(0);
}

const skipped = new Map();
const worthCandidates = [];
for (const it of candidates) {
  const { worth, reason } = evaluateCandidate(
    { minimumPrice: it.lowstBidPrc || null, text: it.onbidCltrNm ?? '' },
    filterOpts,
  );
  if (worth) worthCandidates.push(it);
  else skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
}

if (!worthCandidates.length) {
  console.log(`${rangeLabel}에 개찰하는 후보 ${candidates.length}건 모두 분석 가치 낮아 생략됨.`);
  console.log(formatSkippedSummary(skipped));
  process.exit(0);
}

console.log(`${rangeLabel}에 개찰하는 후보 ${worthCandidates.length}건 (이미 등록된 사건·분석 가치 낮은 물건 제외)\n`);
for (const it of worthCandidates) {
  const type = it.scrnPrptDvsnNm ?? it.prptDvsnNm;
  const category = guessCategory(it.ctgrFullNm);
  const appraisal = (it.cltrApslEvlAvgAmt ?? 0).toLocaleString('ko-KR');
  const minimum = it.lowstBidPrc ? it.lowstBidPrc.toLocaleString('ko-KR') : '비공개';
  const saleDate = (it.pbctExctDt || '').slice(0, 10);
  const trustHint = /신탁/.test(it.regOrgNm ?? '') ? ' [위임기관에 "신탁" 포함 — 신탁공매 후보일 수 있음, --type=trust로 확인]' : '';
  console.log(`${it.scrnIndctCltrMngNo} | ${saleDate} | ${type} | ${it.ctgrFullNm}${category ? '' : '(분류 자동판단 실패)'} | ${it.onbidCltrNm}`);
  console.log(`  감정가 ${appraisal}원, 최저가 ${minimum}원, 유찰 ${it.uscbdCnt ?? 0}회, ${it.remainTime}${trustHint}`);
}
const skipSummary = formatSkippedSummary(skipped);
if (skipSummary) console.log(`\n${skipSummary}`);
console.log(`\n관심 있는 물건은: node tools/analysis/fetch-onbid.mjs <물건관리번호>`);
