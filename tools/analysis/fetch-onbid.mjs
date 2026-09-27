#!/usr/bin/env node
// 온비드(한국자산관리공사) 공매 물건을 물건관리번호로 조회해 data/cases/<id>.json 스켈레톤을 만든다.
// 온비드는 URL로 물건을 특정할 수 없어(상세 페이지가 세션 기반 POST 내비게이션) 물건관리번호로 찾는다.
//   node tools/analysis/fetch-onbid.mjs 2022-0200-007090
//   node tools/analysis/fetch-onbid.mjs 2026-0700-036408 --type=trust   (위임기관이 신탁회사인 신탁공매)
//
// 지금은 두 유형만 지원한다 — 국유재산 등 그 외 유형은 말소기준권리·인수 개념의 법적 근거를
// 아직 확인 못 해 사건 파일을 만들지 않고 멈춘다.
//   압류재산(기본값, 자동 판단): 국세징수법 제92조 — court 경매와 같은 구조
//   --type=trust(신탁공매, 사람이 명시해야 함): 신탁법 제4조·제22조 — 등기 접수 순서가 아니라
//     신탁등기 접수일이 기준이라 압류재산과 자동으로 구분이 안 돼 옵션으로 사람이 확정해야 한다
//
// 이 스크립트가 채우는 건 온비드 목록 API가 공개하는 필드뿐이다(사건번호·전체 주소·
// 물건종류·면적·감정가·입찰기간·유찰횟수 등). 등기사항전부증명서·공매재산명세·현황조사
// 내용은 사람이 서류를 보고 rights[]·tenants[]·spec_sheet에 채워야 한다 — 자동으로 지어내지 않는다.
// 신탁공매의 case.trust_registered_on(신탁등기 접수일)도 등기사항전부증명서에서만 확인되므로
// 사람이 채워야 한다 — 자동으로 못 채운다.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { casePath, casesDir, rel, todayKST, ID_RE } from '../lib/paths.mjs';

const args = process.argv.slice(2);
const mgmtNo = args.find(a => !a.startsWith('--'));
const typeArg = args.find(a => a.startsWith('--type='))?.slice('--type='.length);
if (!mgmtNo || !/^\d{4}-\d+-\d+$/.test(mgmtNo) || (typeArg && !['trust', 'seized'].includes(typeArg))) {
  console.error('사용법: fetch-onbid.mjs <물건관리번호> [--type=trust]');
  console.error('  물건관리번호 예: 2022-0200-007090 (자릿수는 물건 유형마다 다를 수 있음)');
  console.error('  --type=trust : 위임기관이 신탁회사인 신탁공매로 취급(온비드 재산유형이 "압류재산"이 아닐 때 사람이 명시)');
  process.exit(2);
}

const LIST_URL = 'https://www.onbid.co.kr/op/cltrpbancinf/clbtcltrclg/cltrclbtcltrclg/CltrClbtCltrClgController/mvmnCltrRlstClg.do';
const SEARCH_PATH = '/op/cltrpbancinf/clbtcltrclg/cltrclbtcltrclg/CltrClbtCltrClgController/inqCltrClbtRlstClg.do';

// 온비드 물건명(onbidCltrNm)은 "시도 시군구 읍면동 지번 건물명 [동/층/호] (도로명)" 형식의 전체 주소다.
// 법원경매정보·온비드가 법률상 공개하는 정보이고 기존 경매정보 서비스도 동일하게 전체 주소를 쓰므로
// 그대로 쓴다 — "외 N건"(여러 필지 묶음 표시)만 정리해서 뺀다.
function fullAddress(onbidCltrNm = '') {
  return (onbidCltrNm || '').replace(/\s*외\s*\d+\s*건\s*$/, '').trim();
}

// 물건종류(ctgrFullNm) → 이 저장소의 분류 slug(data/categories.json). 확실하지 않으면 사람이 정하도록 null.
function guessCategory(ctgrFullNm = '') {
  if (/아파트/.test(ctgrFullNm)) return 'apartment';
  if (/다세대|연립|빌라/.test(ctgrFullNm)) return 'villa';
  if (/근린생활|상가|업무|점포/.test(ctgrFullNm)) return 'commercial';
  if (/토지|답|전|임야|대지|과수원|잡종지/.test(ctgrFullNm)) return 'land';
  if (/자동차|차량/.test(ctgrFullNm)) return 'car';
  return null;
}

const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' });

let seedBody = null;
page.on('request', req => { if (req.url().includes('inqCltrClbtRlstClg.do') && !seedBody) seedBody = req.postData(); });
await page.goto(LIST_URL, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(1200);

if (!seedBody) {
  console.error('목록 검색 요청을 가로채지 못함 — 온비드 페이지 구조가 바뀌었을 수 있음. Playwright로 직접 확인 필요');
  await browser.close();
  process.exit(1);
}

const params = new URLSearchParams(seedBody);
params.set('searchCltrMnmtNoYn', 'Y');
params.set('srchCltrMnmtNo', mgmtNo);
params.set('pageIndex', '1');

const raw = await page.evaluate(async ({ path, body }) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body,
    credentials: 'include',
  });
  return res.text();
}, { path: SEARCH_PATH, body: params.toString() });
await browser.close();

let data;
try { data = JSON.parse(raw); } catch { console.error('응답 파싱 실패 — 온비드 API 응답 형식이 바뀌었을 수 있음'); process.exit(1); }
if (!data.success || !Number(data.totalCount)) {
  console.error(`물건관리번호 ${mgmtNo}를 찾지 못함 (totalCount=${data.totalCount ?? '?'})`);
  process.exit(1);
}
const rows = data.cltrInfVOList.filter(x => x.scrnIndctCltrMngNo === mgmtNo);
if (!rows.length) { console.error(`응답에 물건관리번호 ${mgmtNo}가 없음 — 온비드가 다른 물건을 돌려줌`); process.exit(1); }

// 압류재산은 한 물건에 향후 여러 회차(감액되는 최저가)가 한꺼번에 예약 공고돼 있을 수 있다.
// "입찰중"이 있으면 그중 마감이 가장 가까운 것, 없으면 "입찰시작 전" 중 가장 이른 회차를 고른다.
let it;
if (rows.length === 1) {
  it = rows[0];
} else {
  const ongoing = rows.filter(x => /^입찰중/.test(x.remainTime ?? ''));
  const pool = ongoing.length ? ongoing : rows.filter(x => /^입찰시작 전/.test(x.remainTime ?? ''));
  if (!pool.length) { console.error(`물건관리번호 ${mgmtNo}의 회차 ${rows.length}건이 모두 마감됨 — 이미 끝난 물건일 수 있음`); process.exit(1); }
  pool.sort((a, b) => (a.pbctBegnDtm ?? '').localeCompare(b.pbctBegnDtm ?? ''));
  it = pool[0];
  console.log(`⚠ 물건관리번호 ${mgmtNo}에 예약된 회차가 ${rows.length}건 있음 — 그중 가장 가까운 회차(${it.pbctBegnDtm} ~ ${it.pbctDdlnDt})를 선택함. 최저가는 회차마다 자동으로 낮아짐(다음 회차 ${pool[1] ? `최저가 ${pool[1].lowstBidPrc.toLocaleString('ko-KR')}원` : '없음'})`);
}

const rawPropType = it.scrnPrptDvsnNm ?? it.prptDvsnNm ?? '(확인 안 됨)';
const isTrustDisposal = typeArg === 'trust';
if (rawPropType !== '압류재산' && !isTrustDisposal) {
  console.error(`\n이 물건은 재산 유형이 "${rawPropType}"입니다. 지금 권리분석 엔진은 "압류재산"과 "신탁공매"만 지원합니다`);
  if (/신탁/.test(it.regOrgNm ?? '')) {
    console.error(`위임기관이 "${it.regOrgNm}"이라 신탁회사가 처분하는 신탁공매일 수 있습니다 — 맞으면 --type=trust를 붙여 다시 실행하세요.`);
  } else {
    console.error('(국유재산 등 그 외 유형은 말소기준권리·인수 개념의 법적 근거를 아직 확인 못 해 사건 파일을 만들지 않고 멈춥니다).');
  }
  process.exit(1);
}
if (isTrustDisposal && rawPropType === '압류재산') {
  console.error('이 물건은 온비드 재산유형이 이미 "압류재산"입니다 — --type=trust를 붙이지 말고 다시 실행하세요.');
  process.exit(1);
}
const propType = isTrustDisposal ? '신탁공매' : rawPropType;

const id = `onbid-${mgmtNo.replace(/-/g, '')}`;
if (!ID_RE.test(id)) { console.error(`생성된 id가 규칙에 안 맞음: ${id}`); process.exit(1); }
if (fs.existsSync(casePath(id))) { console.error(`이미 있음: ${rel(casePath(id))}`); process.exit(1); }

const category = guessCategory(it.ctgrFullNm);
const region = fullAddress(it.onbidCltrNm) || it.sidoSgkEmd || [it.sdnm, it.sggnm, it.emdNm].filter(Boolean).join(' ');
const saleDate = (it.pbctExctDt || '').slice(0, 10) || null;
const minimumHidden = !it.lowstBidPrc || it.lowstBidPrcHideDivCd !== '0001';

const skeleton = {
  id,
  source: {
    checked_at: todayKST(),
    documents: isTrustDisposal
      ? ['등기사항전부증명서(신탁원부 포함)', '임대차 현황(첨부 자료가 있으면)']
      : ['공매재산명세', '등기사항전부증명서', '현황조사서(있으면)'],
    type: 'onbid',
    note: `온비드 물건관리번호 ${mgmtNo}로 조회 (직접 URL 없음, 온비드 사이트에서 물건관리번호로 재검색)`,
  },
  case: {
    number: mgmtNo,
    item_no: 1,
    court: it.regOrgNm ?? '', // onbid는 "법원"이 아니라 공고기관(캠코 지사·위탁기관)
    kind: isTrustDisposal ? '신탁공매' : '압류재산 공매',
    category: category ?? '',
    onbid_property_type: propType,
    ...(isTrustDisposal ? { trust_registered_on: null } : {}),
    region,
    area_m2: it.landSqms || it.bldSqms || null,
  },
  sale: {
    appraisal: it.cltrApslEvlAvgAmt ?? 0,
    minimum: minimumHidden ? 0 : it.lowstBidPrc,
    failed_rounds: Number(it.uscbdCnt ?? 0),
    sale_date: saleDate,
    dividend_deadline: null,
    resale: false,
  },
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
fs.writeFileSync(casePath(id), `${JSON.stringify(skeleton, null, 2)}\n`);

console.log(`만듦: ${rel(casePath(id))}`);
console.log(`\n온비드에서 자동으로 채운 값:`);
console.log(`  물건: ${region}`);
console.log(`  물건종류: ${it.ctgrFullNm} → category: ${category ?? '(자동 판단 실패 — 사람이 data/categories.json 보고 채워야 함)'}`);
console.log(`  감정가: ${(it.cltrApslEvlAvgAmt ?? 0).toLocaleString('ko-KR')}원, 면적: ${skeleton.case.area_m2 ?? '미상'}㎡`);
console.log(`  입찰기간: ${it.pbctBegnDtm} ~ ${it.pbctDdlnDt}, 개찰(매각기일 대응): ${saleDate ?? '미상'}`);
console.log(`  유찰횟수(추정): ${skeleton.sale.failed_rounds}회`);
if (minimumHidden) console.log(`  ⚠ 최저입찰가격이 온비드에서 "비공개" 처리됨 — sale.minimum을 사람이 직접 확인해서 채워야 계산이 됨`);
console.log(`\n사람이 서류를 보고 채워야 하는 것(자동으로 채우지 않음):`);
if (isTrustDisposal) {
  console.log(`  - case.trust_registered_on: 신탁등기 접수일(등기사항전부증명서에서 확인) — 없으면 compute.mjs가 INVALID로 막음`);
  console.log(`  - rights[]: 등기사항전부증명서의 갑구·을구 부담 등기 전체(신탁공매는 소멸/인수를 코드가 판정하지 않고 전부 review로 남김)`);
  console.log(`  - tenants[]: 임대차 현황(있으면 온비드 첨부 PDF) + 전입일 — PDF의 "임대차 기간"은 전입일이 아니므로 그대로 쓰지 말 것`);
  console.log(`  - special[]: 수탁자 동의 여부 등 신탁원부·계약서로 확인한 사항`);
} else {
  console.log(`  - rights[]: 등기사항전부증명서의 갑구·을구 부담 등기 전체`);
  console.log(`  - tenants[]: 공매재산명세·현황조사 내용상 점유자·임차인`);
  console.log(`  - spec_sheet: 공매재산명세서 기재 내용`);
  console.log(`  - sale.resale / sale.deposit_rate: 재공고·보증금 비율(온비드 압류재산은 유찰마다 보증금 비율이 달라질 수 있음, 공고문 확인)`);
}
if (!category) console.log(`  - case.category: "${it.ctgrFullNm}"에서 자동 판단 실패`);
