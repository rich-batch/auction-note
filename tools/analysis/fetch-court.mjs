#!/usr/bin/env node
// 법원경매정보(courtauction.go.kr)를 사건번호로 조회해 data/cases/<id>.json 스켈레톤을 만든다.
// court-auction-notice-search 패키지(https://github.com/NomaDamas/k-skill) 사용 — 안티봇 가드
// (호출 간 지연, 세션당 호출 제한, 차단 시 자동 재시도 금지)가 내장돼 있어 직접 스크래핑하지 않는다.
//   node tools/analysis/fetch-court.mjs <법원코드> <사건번호> --sale-date YYYY-MM-DD [--item 1]
//   예: node tools/analysis/fetch-court.mjs B000211 2026타경50579 --sale-date 2026-10-12
//
// 법원코드·매각기일은 미리 알아야 한다 — node tools/analysis/scan-court.mjs로 찾거나,
// 법원경매정보 사이트에서 직접 확인한 사건번호를 쓴다.
//
// 이 스크립트가 채우는 건 공개 API가 주는 필드뿐이다(사건번호·소재지·물건종류·감정가·최저가·
// 매각기일·배당요구종기·청구금액). 매각물건명세서·등기사항전부증명서·현황조사서는 이 API가
// 제공하지 않는다(court-auction-notice-search 자체 문서에 명시된 한계) — 사람이 서류를 보고
// rights[]·tenants[]·spec_sheet에 채워야 한다.
import fs from 'node:fs';
import { getCaseByCaseNumber, getSaleNoticeDetail } from 'court-auction-notice-search';
import { casePath, casesDir, rel, todayKST, ID_RE } from '../lib/paths.mjs';
import { courtSlug, guessCategoryFromUsage, fullAddress } from '../lib/courts.mjs';

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const [courtCode, caseNumber] = positional;
const saleDate = args.find(a => a.startsWith('--sale-date='))?.slice('--sale-date='.length)
  ?? (args.includes('--sale-date') ? args[args.indexOf('--sale-date') + 1] : null);
const itemSeqArg = args.find(a => a.startsWith('--item='))?.slice('--item='.length)
  ?? (args.includes('--item') ? args[args.indexOf('--item') + 1] : '1');

if (!courtCode || !/^\d{4}타경\d+$/.test(caseNumber ?? '') || !saleDate || !/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) {
  console.error('사용법: fetch-court.mjs <법원코드> <사건번호> --sale-date YYYY-MM-DD [--item 1]');
  console.error('  예: fetch-court.mjs B000211 2026타경50579 --sale-date 2026-10-12');
  console.error('  법원코드·매각기일을 모르면 scan-court.mjs로 먼저 찾는다.');
  process.exit(2);
}

let caseData;
try {
  caseData = await getCaseByCaseNumber({ courtCode, caseNumber });
} catch (e) {
  console.error(`사건 조회 실패: ${e.message}`);
  process.exit(1);
}
if (!caseData.found) {
  console.error(`사건을 찾지 못함: ${caseData.message ?? '(메시지 없음)'}`);
  process.exit(1);
}
const info = caseData.caseInfo;
const judgeDeptCode = info.judgeDeptCode;

let notice;
try {
  notice = await getSaleNoticeDetail({ courtCode, saleDate, judgeDeptCode, bidType: 'date' });
} catch (e) {
  console.error(`매각공고 상세 조회 실패: ${e.message}`);
  console.error('매각기일이 맞는지(연기·변경됐을 수 있음), 법원경매정보 사이트에서 재확인하세요.');
  process.exit(1);
}
const item = notice.items?.find(x => x.caseNumber === caseNumber && x.itemSeq === itemSeqArg);
if (!item) {
  console.error(`${saleDate} 매각공고에서 ${caseNumber} 물건번호 ${itemSeqArg}을 못 찾음(공고 ${notice.items?.length ?? 0}건 중). 매각기일·물건번호를 다시 확인하세요.`);
  process.exit(1);
}

const id = `${courtSlug(courtCode)}-${caseNumber.replace('타경', 'ta')}`;
if (!ID_RE.test(id)) { console.error(`생성된 id가 규칙에 안 맞음: ${id}`); process.exit(1); }
if (fs.existsSync(casePath(id))) { console.error(`이미 있음: ${rel(casePath(id))}`); process.exit(1); }

const category = guessCategoryFromUsage(item.usage);
const isCar = category === 'car';
const kind = /임의/.test(info.caseName ?? '') ? '임의경매' : /강제/.test(info.caseName ?? '') ? '강제경매' : (info.caseName ?? '');

const skeleton = {
  id,
  source: {
    checked_at: todayKST(),
    documents: isCar
      ? ['자동차등록원부 등본(갑구·을구)']
      : ['매각물건명세서', '현황조사서'], // 실제로 확인한 서류만. 등기사항전부증명서는 사람이 열람해 rights[]를 채운 뒤에 추가한다
    type: 'court',
    note: `법원경매정보 courtauction.go.kr — court-auction-notice-search로 조회(사건 조회 + ${saleDate} 매각공고 상세). 청구금액 ${info.claimAmount?.toLocaleString('ko-KR') ?? '미상'}원.${item.remarks ? ` 공고 비고: "${item.remarks}"` : ''}`,
  },
  case: {
    number: caseNumber,
    item_no: Number(itemSeqArg),
    court: info.courtName ?? '',
    kind,
    category: category ?? '',
    region: fullAddress(item.address),
    area_m2: null,
  },
  sale: {
    appraisal: item.appraisedPrice ?? 0,
    minimum: item.minimumSalePrice ?? 0,
    failed_rounds: 0,
    sale_date: saleDate,
    dividend_deadline: caseData.claimDeadline?.deadlineDate ?? null,
    resale: false,
  },
  rights: [
    { date: '', receipt_no: null, kind: isCar ? '저당권' : '근저당권', amount: null, holder_type: '은행', note: '' },
  ],
  tenants: [],
  special: [],
  spec_sheet: { base_right_text: '', surviving_rights_text: '', superficies_text: '', remarks: '' },
  market: { trades: [], source_url: null, checked_at: null },
  result: { outcome: null, winning_bid: null, bidders: null, checked_at: null },
};

fs.mkdirSync(casesDir, { recursive: true });
fs.writeFileSync(casePath(id), `${JSON.stringify(skeleton, null, 2)}\n`);

console.log(`만듦: ${rel(casePath(id))}`);
console.log(`\n법원경매정보에서 자동으로 채운 값:`);
console.log(`  법원: ${info.courtName} ${info.judgeDeptName ?? ''}`);
console.log(`  물건: ${fullAddress(item.address)}`);
console.log(`  물건종류: ${item.usage} → category: ${category ?? '(자동 판단 실패 — 사람이 data/categories.json 보고 채워야 함)'}`);
console.log(`  감정가: ${(item.appraisedPrice ?? 0).toLocaleString('ko-KR')}원, 최저가: ${(item.minimumSalePrice ?? 0).toLocaleString('ko-KR')}원`);
console.log(`  매각기일: ${saleDate}, 배당요구종기: ${caseData.claimDeadline?.deadlineDate ?? '미상'}`);
if (item.remarks) console.log(`  ⚠ 공고 비고(중요할 수 있음): ${item.remarks}`);
console.log(`\n사람이 서류를 보고 채워야 하는 것(자동으로 채우지 않음 — 이 API가 제공 안 함):`);
if (isCar) {
  console.log(`  - rights[]: 자동차등록원부(을구 저당권 등록사항) — 정부24 등에서 직접 열람`);
  console.log(`  - special[]: 유치권 여부 등`);
} else {
  console.log(`  - rights[]: 등기사항전부증명서의 갑구·을구 부담 등기 전체`);
  console.log(`  - tenants[]: 매각물건명세서·현황조사서상 점유자·임차인`);
  console.log(`  - spec_sheet: 매각물건명세서 기재 내용(최선순위 설정, 인수되는 권리 등)`);
}
if (!category) console.log(`  - case.category: "${item.usage}"에서 자동 판단 실패`);
