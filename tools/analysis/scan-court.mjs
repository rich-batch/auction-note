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
// 같은 세션(client)을 공유해야 한다 — 그래서 한 법원 안의 호출은 client 하나를 함께 쓴다.
// 다만 세션 호출 한도(10회)가 법원 12곳 전체에 걸리면 6번째쯤에서 멈추므로 법원마다 client를 새로 만들고,
// 법원을 옮길 때마다 1분을 더 쉰다. 차단(BLOCKED)을 만나면 그 자리에서 전부 멈추고, 한 법원의 호출 한도
// 초과(BUDGET_EXCEEDED)는 그 법원의 남은 공고만 건너뛰고 다음 법원으로 간다 —
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

const EXTRA_DELAY_BETWEEN_COURTS_MS = 60_000; // 패키지 자체 지연 위에 얹는 법원 전환 여유(1분) — 차단 예방

let totalPrinted = 0;
let blocked = false;

for (const [i, courtCode] of courtCodes.entries()) {
  if (blocked) break;
  if (i > 0) await new Promise(r => setTimeout(r, EXTRA_DELAY_BETWEEN_COURTS_MS));
  const client = new CourtAuctionHttpClient({}); // 법원마다 새 세션 — 호출 한도는 법원 단위로

  let notices;
  try {
    notices = await searchSaleNotices({ date: month, courtCode, bidType: 'date', client });
  } catch (e) {
    console.error(`[${courtCode}] 매각공고 목록 조회 실패: ${e.message}`);
    if (e.code === 'BLOCKED') {
      console.error('법원경매정보가 이 IP를 일시 차단했다 — 약 1시간 뒤 다시 시도(자동 재시도 금지). 남은 법원은 다음 실행에서 이어서 조회하면 된다.');
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
      if (e.code === 'BLOCKED') {
        console.error('차단됐다 — 중단. 남은 법원은 다음 실행에서 이어서 조회하면 된다.');
        blocked = true;
        break;
      }
      if (e.code === 'BUDGET_EXCEEDED') {
        console.error(`[${courtCode}] 이 법원의 세션 호출 한도에 도달 — 남은 공고는 건너뛰고 다음 법원으로`);
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
