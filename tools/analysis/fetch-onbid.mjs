#!/usr/bin/env node
// 온비드(한국자산관리공사) 공매 물건을 물건관리번호로 조회해 data/cases/<id>.json 스켈레톤을 만든다.
// 온비드는 URL로 물건을 특정할 수 없어(상세 페이지가 세션 기반 POST 내비게이션) 물건관리번호로 찾는다.
//   node tools/analysis/fetch-onbid.mjs 2022-0200-007090
//   node tools/analysis/fetch-onbid.mjs 2026-0700-036408 --type=trust   (위임기관이 신탁회사인 신탁공매)
//
// 지원하는 재산유형과 법적 근거(온비드 표시를 그대로 받아들인다 — 신탁공매만 예외):
//   압류재산(기본값): 국세징수법 제92조 — court 경매와 같은 구조, 등기 순서로 소멸/인수 계산
//   국유재산·공유재산: 국유재산법 제11조·공유재산법 제8조 — 사권이 소멸된 후에만 취득하는 게
//     원칙이라 rights는 비어 있는 게 정상. 등기 권리·점유 문제는 전부 검토로 남김
//   기타일반재산: 위임기관마다 근거 법령이 달라 등기 권리를 전부 검토로 남기는 최소 계산만 함
//   --type=trust(신탁공매, 사람이 명시해야 함): 신탁법 제4조·제22조 — 등기 접수 순서가 아니라
//     신탁등기 접수일이 기준. 온비드가 이 유형을 별도로 표시하지 않아(보통 "기타일반재산"으로
//     보임) 사람이 옵션으로 확정해야 한다
// 그 외(동산·유가증권 등)는 소멸/인수 개념의 법적 근거를 아직 확인 못 해 사건 파일을 만들지 않고 멈춘다.
//
// 이 스크립트가 채우는 건 온비드 목록 API가 공개하는 필드뿐이다(사건번호·전체 주소·
// 물건종류·면적·감정가·입찰기간·유찰횟수 등). 등기사항전부증명서·공매재산명세·현황조사
// 내용은 사람이 서류를 보고 rights[]·tenants[]·spec_sheet에 채워야 한다 — 자동으로 지어내지 않는다.
// 신탁공매의 case.trust_registered_on(신탁등기 접수일)도 등기사항전부증명서에서만 확인되므로
// 사람이 채워야 한다 — 자동으로 못 채운다.
import fs from 'node:fs';
import { casePath, casesDir, rel, todayKST, ID_RE } from '../lib/paths.mjs';
import { fullAddress, guessCategory, searchOnbid, fetchOnbidRightsAnalysis, buildOnbidRightsAndTenants } from '../lib/onbid.mjs';
import { splitVehicle } from '../lib/vehicle.mjs';

const args = process.argv.slice(2);
const mgmtNo = args.find(a => !a.startsWith('--'));
const typeArg = args.find(a => a.startsWith('--type='))?.slice('--type='.length);
if (!mgmtNo || !/^\d{4}-\d+-\d+$/.test(mgmtNo) || (typeArg && !['trust', 'seized'].includes(typeArg))) {
  console.error('사용법: fetch-onbid.mjs <물건관리번호> [--type=trust]');
  console.error('  물건관리번호 예: 2022-0200-007090 (자릿수는 물건 유형마다 다를 수 있음)');
  console.error('  --type=trust : 위임기관이 신탁회사인 신탁공매로 취급(온비드 재산유형이 "압류재산"이 아닐 때 사람이 명시)');
  process.exit(2);
}

let data;
try {
  data = await searchOnbid({ searchCltrMnmtNoYn: 'Y', srchCltrMnmtNo: mgmtNo, pageIndex: '1' });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
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

// 압류재산·국유재산·공유재산·기타일반재산은 온비드 표시 그대로 받아들인다(각각 법적 근거를
// 확인함 — README.md·SKILL.md 참고). 신탁공매만 예외다: 온비드가 "기타일반재산" 등으로만
// 표시해 위임기관 이름으로 짐작해야 해서 --type=trust로 사람이 명시해야 한다.
const SUPPORTED_DIRECT = ['압류재산', '국유재산', '공유재산', '기타일반재산'];
const rawPropType = it.scrnPrptDvsnNm ?? it.prptDvsnNm ?? '(확인 안 됨)';
const isTrustDisposal = typeArg === 'trust';
if (!SUPPORTED_DIRECT.includes(rawPropType) && !isTrustDisposal) {
  console.error(`\n이 물건은 재산 유형이 "${rawPropType}"입니다. 지금 권리분석 엔진은 ${SUPPORTED_DIRECT.join('·')}·신탁공매만 지원합니다`);
  if (/신탁/.test(it.regOrgNm ?? '')) {
    console.error(`위임기관이 "${it.regOrgNm}"이라 신탁회사가 처분하는 신탁공매일 수 있습니다 — 맞으면 --type=trust를 붙여 다시 실행하세요.`);
  } else {
    console.error('(동산·유가증권 등 그 외 유형은 소멸/인수 개념의 법적 근거를 아직 확인 못 해 사건 파일을 만들지 않고 멈춥니다).');
  }
  process.exit(1);
}
if (isTrustDisposal && rawPropType === '압류재산') {
  console.error('이 물건은 온비드 재산유형이 이미 "압류재산"입니다 — --type=trust를 붙이지 말고 다시 실행하세요.');
  process.exit(1);
}
const propType = isTrustDisposal ? '신탁공매' : rawPropType;
const isReviewOnly = ['국유재산', '공유재산', '기타일반재산'].includes(propType);

const id = `onbid-${mgmtNo.replace(/-/g, '')}`;
if (!ID_RE.test(id)) { console.error(`생성된 id가 규칙에 안 맞음: ${id}`); process.exit(1); }
if (fs.existsSync(casePath(id))) { console.error(`이미 있음: ${rel(casePath(id))}`); process.exit(1); }

const category = guessCategory(it.ctgrFullNm);
const region = fullAddress(it.onbidCltrNm) || it.sidoSgkEmd || [it.sdnm, it.sggnm, it.emdNm].filter(Boolean).join(' ');
const saleDate = (it.pbctExctDt || '').slice(0, 10) || null;
const minimumHidden = !it.lowstBidPrc || it.lowstBidPrcHideDivCd !== '0001';

const isCar = category === 'car';
// 자동차는 온비드 물건명에 차량 정보가 섞여 온다 → 보관 장소(region)와 차량 정보(case.vehicle)로 나눈다
const carSplit = isCar ? splitVehicle(region) : null;

// 압류재산·부동산(자동차·신탁공매·국유재산 등 review-only 유형 제외)이면 온비드 물건 상세
// 페이지가 로그인 없이 공개하는 "등기사항증명서 주요정보"·"임대차 정보"·"점유관계"·"배분요구 및
// 채권신고현황" 표를 그대로 읽어 rights[]·tenants[]를 자동으로 채운다(tools/lib/onbid.mjs).
// 등기사항전부증명서 원본을 대신하지는 않는다 — 그래서 애매한 항목은 special[]에 검토로 남는다.
const canAutoFillRights = !isCar && !isReviewOnly && !isTrustDisposal
  && ['apartment', 'villa', 'commercial', 'land'].includes(category ?? '');
let autoRights = null;
if (canAutoFillRights) {
  console.log('\n온비드 물건 상세 페이지에서 등기사항·임대차·점유관계·배분요구현황 조회 중...');
  try {
    const tables = await fetchOnbidRightsAnalysis(it);
    autoRights = buildOnbidRightsAndTenants(tables, category);
    if (!tables.rightsRows.length) {
      console.log('  ⚠ 등기사항증명서 주요정보가 아직 없음(공매 대행 초기라 미공개일 수 있음) — rights[]를 사람이 채워야 함');
    }
  } catch (e) {
    console.log(`  ⚠ 자동 조회 실패(${e.message}) — 사람이 서류를 보고 채워야 함`);
  }
}

const skeleton = {
  id,
  source: {
    checked_at: todayKST(),
    documents: isTrustDisposal
      ? ['공매재산명세', '온비드 공고문(신탁등기 정보가 공개돼 있으면)', '임대차 현황(첨부 자료가 있으면)'] // 등기부(신탁원부)는 유료라 보지 않는다
      : isCar
        ? ['공매재산명세', '자동차등록원부 등본(갑구·을구)']
        : isReviewOnly
          ? ['공고문', '사용허가·대부계약 현황(있으면)']
          : autoRights?.rights?.length
            ? ['온비드 물건 상세 페이지의 "등기사항증명서 주요정보"·"임대차 정보" 공개 요약(자동 조회)', '온비드 물건 상세 페이지의 "배분요구 및 채권신고현황"(권리분석 기초정보, 자동 조회)']
            : ['공매재산명세', '현황조사서(있으면)'], // 실제로 본 공개 자료만 — 등기사항전부증명서는 유료라 보지 않는다
    type: 'onbid',
    note: autoRights?.rights?.length
      ? `온비드 물건관리번호 ${mgmtNo}로 조회. 상세 페이지 공개 요약은 참고자료이며 등기부 순위번호와 무관하다고 명시돼 있음(온비드 안내 문구). 입찰 전 최종 등기사항증명서 재확인 권장.`
      : `온비드 물건관리번호 ${mgmtNo}로 조회 (직접 URL 없음, 온비드 사이트에서 물건관리번호로 재검색)`,
  },
  case: {
    number: mgmtNo,
    item_no: 1,
    court: it.regOrgNm ?? '', // onbid는 "법원"이 아니라 공고기관(캠코 지사·위탁기관)
    kind: isTrustDisposal ? '신탁공매' : `${propType} 매각`,
    category: category ?? '',
    onbid_property_type: propType,
    ...(isTrustDisposal ? { trust_registered_on: null } : {}),
    region: carSplit?.storage ?? region,
    ...(carSplit ? { vehicle: carSplit.vehicle } : {}),
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
  // 국유재산·공유재산·기타일반재산은 rights가 비어 있는 게 정상이라 빈 배열로 둔다 —
  // 등기된 권리가 실제로 있으면 사람이 확인해서 넣는다(이례적인 경우). autoRights가 있으면
  // (압류재산·부동산) 온비드 공개 요약으로 채운 값을 쓰고, 없으면 기존처럼 빈 스텁을 둔다.
  rights: autoRights?.rights?.length ? autoRights.rights : isReviewOnly ? [] : [
    { date: '', receipt_no: null, kind: isCar ? '저당권' : '근저당권', amount: null, holder_type: '은행', note: '' },
  ],
  tenants: autoRights?.tenants ?? [],
  special: autoRights?.special ?? [],
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
} else if (isCar) {
  console.log(`  - rights[]: 자동차등록원부 을구의 저당권 등록사항 전체(자동차는 tenants를 채우지 않음 — 임대차보호법 적용 대상이 아님)`);
  console.log(`  - special[]: 유치권(점유·정비 이력) 여부, 리스·할부 소유권유보 여부 등 등록원부로 안 보이는 사항`);
  console.log(`  - sale.resale / sale.deposit_rate: 재공고·보증금 비율(유찰마다 바뀔 수 있음, 공고문 확인)`);
} else if (isReviewOnly) {
  console.log(`  - rights[]: 원칙적으로 비워 둔다(${propType}은 사권이 소멸된 후에만 취득되는 게 원칙). 등기된 권리가 실제로 있으면 그것도 이례적이니 그대로 입력 — 코드가 전부 검토로 남긴다`);
  console.log(`  - special[]: 사용허가·대부 계약 중인 점유자가 있는지, 물납재산인지 등 공고문·담당 부서로 확인한 사항(tenants는 채우지 않음)`);
  console.log(`  - sale.resale / sale.deposit_rate: 재공고·보증금 비율(공고문 확인)`);
} else if (autoRights?.rights?.length) {
  console.log(`\n온비드 물건 상세 페이지에서 자동으로 채운 것:`);
  console.log(`  - rights[]: ${autoRights.rights.length}건("등기사항증명서 주요정보" 표 그대로 — 등기사항전부증명서 원본은 아니니 입찰 전 최종 대조 권장)`);
  console.log(`  - tenants[]: ${autoRights.tenants.length}건("점유관계"·"임대차 정보"·"배분요구현황" 표에서 확인)`);
  if (autoRights.special.length) {
    console.log(`  - special[]: ${autoRights.special.length}건 자동 검토 표시(권리종류 불명·배당요구 미공개 등 — 사람/AI가 확인)`);
  }
  console.log(`\n그래도 사람이 서류를 보고 채워야 하는 것:`);
  console.log(`  - spec_sheet: 공매재산명세서 기재 내용(원문이 나오면 위 자동 값과 대조)`);
  console.log(`  - sale.resale / sale.deposit_rate: 재공고·보증금 비율(유찰마다 바뀔 수 있음, 공고문 확인)`);
} else {
  console.log(`  - rights[]: 등기사항전부증명서의 갑구·을구 부담 등기 전체(자동 조회 실패 또는 아직 미공개 — 위 경고 참고)`);
  console.log(`  - tenants[]: 공매재산명세·현황조사 내용상 점유자·임차인`);
  console.log(`  - spec_sheet: 공매재산명세서 기재 내용`);
  console.log(`  - sale.resale / sale.deposit_rate: 재공고·보증금 비율(온비드 압류재산은 유찰마다 보증금 비율이 달라질 수 있음, 공고문 확인)`);
}
if (!category) console.log(`  - case.category: "${it.ctgrFullNm}"에서 자동 판단 실패`);
