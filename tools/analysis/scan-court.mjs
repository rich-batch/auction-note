#!/usr/bin/env node
// 법원경매정보(courtauction.go.kr)에서 특정 날짜(들)에 매각기일이 잡힌 물건 후보를 나열한다.
// court-auction-notice-search(https://github.com/NomaDamas/k-skill) 사용 — 안티봇 가드 내장.
// 사건을 등록하지는 않는다 — 후보만 보여주고, 관심 있는 사건번호를 사람이 골라서
// node tools/analysis/fetch-court.mjs <법원코드> <사건번호> --sale-date <날짜>로 등록한다.
//
//   node tools/analysis/scan-court.mjs --court B000211 --date 2026-10
//   node tools/analysis/scan-court.mjs --court B000211 --date 2026-10-12   (그 날짜만 필터)
//   node tools/analysis/scan-court.mjs --date 2026-10-12                  (--court 생략 시
//                                        data/courts-of-interest.json에 등록한 법원을 순서대로 조회)
//
// 법원코드를 모르면: node tools/analysis/scan-court.mjs --courts 로 60개 법원 목록을 본다.
// 법원경매정보는 짧은 시간에 요청이 몰리면 IP를 1시간 차단한다. 이 패키지는 세션 하나
// 안에서 호출 간 최소 지연·세션당 호출 한도를 강제하는데, 그 보호가 실제로 걸리려면 호출들이
// 같은 세션(client)을 공유해야 한다 — 그래서 이 스크립트는 법원을 여러 개 순회할 때도
// client 하나를 만들어 모든 호출에 넘긴다. 그래도 법원을 옮길 때마다 1분을 더 쉬고,
// 차단(BLOCKED)이나 세션 호출 한도 초과(BUDGET_EXCEEDED)를 만나면 그 자리에서 멈춘다 —
// 남은 법원은 다음 실행에서 이어서 조회하면 된다(이미 등록된 사건은 자동으로 제외되니
// 다시 돌려도 중복되지 않는다).
// 분석 가치가 낮은 물건(최저가 너무 낮음·공유지분)은 기본으로 목록에서 생략한다(토큰 절약,
// tools/lib/candidate-filter.mjs). --min-price=0 --include-share로 전부 볼 수 있다.
import { getCourtCodes, searchSaleNotices, getSaleNoticeDetail, CourtAuctionHttpClient } from 'court-auction-notice-search';
import { listCaseIds, loadCase } from '../lib/cases.mjs';
import { guessCategoryFromUsage, fullAddress, loadCourtsOfInterest } from '../lib/courts.mjs';
import { evaluateCandidate, parseFilterArgs, formatSkippedSummary } from '../lib/candidate-filter.mjs';

const args = process.argv.slice(2);
const get = (flag) => args.find(a => a.startsWith(`--${flag}=`))?.slice(flag.length + 3)
  ?? (args.includes(`--${flag}`) ? args[args.indexOf(`--${flag}`) + 1] : null);

if (args.includes('--courts')) {
  const { items } = await getCourtCodes();
  for (const c of items) console.log(`${c.code}  ${c.name}`);
  process.exit(0);
}

const courtArg = get('court');
const dateArg = get('date');
if (!dateArg || !/^\d{4}-\d{2}(-\d{2})?$/.test(dateArg)) {
  console.error('사용법: scan-court.mjs [--court <법원코드>] --date <YYYY-MM 또는 YYYY-MM-DD> [--min-price N] [--include-share]');
  console.error('  --court를 생략하면 data/courts-of-interest.json에 등록한 법원을 순서대로 조회한다.');
  console.error('  법원코드 목록: scan-court.mjs --courts');
  process.exit(2);
}
const filterOpts = parseFilterArgs(args);

let courtCodes;
if (courtArg) {
  courtCodes = [courtArg];
} else {
  courtCodes = loadCourtsOfInterest();
  if (!courtCodes.length) {
    console.error('--court가 없고 data/courts-of-interest.json에 등록된 관심 법원도 없다.');
    console.error('그 파일의 "courts" 배열에 법원 코드를 채우거나 --court <코드>를 직접 준다. 법원코드 목록: scan-court.mjs --courts');
    process.exit(2);
  }
}

const month = dateArg.slice(0, 7);
const exactDate = dateArg.length === 10 ? dateArg : null;

const registeredNumbers = new Set(listCaseIds().map(id => loadCase(id).case?.number).filter(Boolean));

const client = new CourtAuctionHttpClient({});
const EXTRA_DELAY_BETWEEN_COURTS_MS = 60_000; // 패키지 자체 지연 위에 얹는 법원 전환 여유(1분) — 차단 예방

let totalPrinted = 0;
let blocked = false;

for (const [i, courtCode] of courtCodes.entries()) {
  if (blocked) break;
  if (i > 0) await new Promise(r => setTimeout(r, EXTRA_DELAY_BETWEEN_COURTS_MS));

  let notices;
  try {
    notices = await searchSaleNotices({ date: month, courtCode, bidType: 'date', client });
  } catch (e) {
    console.error(`[${courtCode}] 매각공고 목록 조회 실패: ${e.message}`);
    if (e.code === 'BLOCKED' || e.code === 'BUDGET_EXCEEDED') {
      console.error('법원경매정보가 이 IP를 일시 차단했거나 세션 호출 한도에 도달했다 — 약 1시간 뒤 다시 시도(자동 재시도 금지). 남은 법원은 다음 실행에서 이어서 조회하면 된다.');
      blocked = true;
    }
    continue;
  }

  const targetNotices = exactDate ? notices.items.filter(n => n.saleDate === exactDate) : notices.items;
  if (!targetNotices.length) {
    console.log(`[${courtCode}] ${dateArg}에 예정된 매각공고 없음(월 전체 공고 ${notices.items.length}건 중).`);
    continue;
  }

  let printedForCourt = 0;
  for (const n of targetNotices) {
    let detail;
    try {
      detail = await getSaleNoticeDetail(n, { client });
    } catch (e) {
      console.error(`[${courtCode}] ${n.saleDate} ${n.judgeDeptName} 상세 조회 실패: ${e.message}`);
      if (e.code === 'BLOCKED' || e.code === 'BUDGET_EXCEEDED') {
        console.error('차단됐거나 세션 호출 한도에 도달했다 — 중단. 남은 법원은 다음 실행에서 이어서 조회하면 된다.');
        blocked = true;
        break;
      }
      continue;
    }
    const registeredExcluded = detail.items.filter(it => !registeredNumbers.has(it.caseNumber));
    if (!registeredExcluded.length) continue;

    const courtSkipped = new Map();
    const candidates = [];
    for (const it of registeredExcluded) {
      const { worth, reason } = evaluateCandidate(
        { minimumPrice: it.minimumSalePrice || null, text: `${it.usage ?? ''} ${it.remarks ?? ''}` },
        filterOpts,
      );
      if (worth) candidates.push(it);
      else courtSkipped.set(reason, (courtSkipped.get(reason) ?? 0) + 1);
    }
    if (!candidates.length) {
      const skipSummary = formatSkippedSummary(courtSkipped);
      if (skipSummary) console.log(`[${courtCode}] ${n.saleDate} ${n.judgeDeptName ?? ''}: ${skipSummary}`);
      continue;
    }
    console.log(`\n=== [${courtCode}] ${n.saleDate} ${n.courtName} ${n.judgeDeptName ?? ''} (${n.salePlace ?? ''}) — 후보 ${candidates.length}건(이미 등록된 사건·분석 가치 낮은 물건 제외) ===`);
    for (const it of candidates) {
      const category = guessCategoryFromUsage(it.usage);
      console.log(`${it.caseNumber} 물건${it.itemSeq} | ${it.usage}${category ? '' : '(분류 자동판단 실패)'} | ${fullAddress(it.address)}`);
      console.log(`  감정가 ${(it.appraisedPrice ?? 0).toLocaleString('ko-KR')}원, 최저가 ${(it.minimumSalePrice ?? 0).toLocaleString('ko-KR')}원${it.remarks ? ` | 비고: ${it.remarks}` : ''}`);
      printedForCourt++;
    }
    const skipSummary = formatSkippedSummary(courtSkipped);
    if (skipSummary) console.log(`  (${skipSummary})`);
  }
  if (!printedForCourt && !blocked) console.log(`[${courtCode}] ${dateArg}에 새 후보 없음(전부 이미 등록됐거나 공고 자체가 없음).`);
  totalPrinted += printedForCourt;
}

if (totalPrinted) console.log(`\n관심 있는 물건은: node tools/analysis/fetch-court.mjs <법원코드> <사건번호> --sale-date <매각기일>`);
