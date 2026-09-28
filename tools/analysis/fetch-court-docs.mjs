#!/usr/bin/env node
// data/cases/<id>.json(법원경매 사건)에 딸린 첨부서류 중 법원경매정보가 캡차·로그인 없이
// 공개하는 두 가지를 자동으로 확인한다.
//   node tools/analysis/fetch-court-docs.mjs <id>
//
// 확인하는 것 / 못 하는 것(법원경매정보 자체 제약):
//   현황조사서  — 점유관계·전입일 등 구조화된 사실만 자동 확인. 점유자 실명은 이 API가
//                마스킹 없이 그대로 주지만(개인정보) 이 스크립트는 절대 저장하지 않는다
//                (tools/lib/court-docs.mjs 상단 설명). 보증금·확정일자는 이 서류에 없음.
//   물건상세    — "최선순위 설정"(말소기준권리 후보)을 참고용으로만 콘솔에 보여준다.
//                rights[]는 여전히 사람이 등기사항전부증명서로 채우고 compute.mjs로 계산한다
//                — 이 값은 그 결과와 맞는지 눈으로 대조하는 용도일 뿐 case 파일에 쓰지 않는다.
//   첨부 사진    — 법원경매정보에 등록된 사진 개수(유형별)를 자동으로 파악해 source.documents에
//                "사진"을 추가한다. 원본 이미지는 저작권 정책 때문에 내려받지 않는다(개수만).
//   감정평가서  — 법원경매정보가 PDF로만 제공하고 "무단 복제·링크 시 형사처벌" 경고가 붙어
//                있어 내용을 자동으로 옮기지 않는다. 감정가 숫자는 이미 fetch-court.mjs가
//                채운다.
//   매각물건명세서·등기사항전부증명서 — 자동 확인 경로를 못 찾음(등기 열람은 인터넷등기소
//                연계 유료서비스로 확인됨). 계속 사람이 법원경매정보 사이트에서 직접 확인.
//
// tenants[]가 이미 채워져 있으면(사람이 이미 손댔으면) 덮어쓰지 않고 참고용으로만 출력한다.
import fs from 'node:fs';
import { loadCase } from '../lib/cases.mjs';
import { casePath, rel, todayKST } from '../lib/paths.mjs';
import { courtCodeFromId } from '../lib/courts.mjs';
import { getCaseByCaseNumber } from 'court-auction-notice-search';
import { CourtDocsHttpClient, fetchStatusReport, fetchGoodsDetail, buildTenantsFromStatusReport, extractBaseRightHint, summarizeCasePhotos } from '../lib/court-docs.mjs';

const [id] = process.argv.slice(2);
if (!id) { console.error('사용법: fetch-court-docs.mjs <id>'); process.exit(2); }

let c;
try { c = loadCase(id); } catch (e) { console.error(e.message); process.exit(1); }

const courtCode = courtCodeFromId(id);
if (!courtCode) { console.error(`id "${id}"에서 법원코드를 못 뽑음(court 사건 ID 형식이 아니거나 tools/lib/courts.mjs COURT_SLUGS에 없는 법원)`); process.exit(1); }
const caseNumber = c.case?.number;
if (!/^\d{4}타경\d+$/.test(caseNumber ?? '')) { console.error(`case.number가 court 형식이 아님: "${caseNumber}"`); process.exit(1); }
const itemSeq = c.case?.item_no ?? 1;

console.log(`${caseNumber} (${courtCode}) 내부 사건번호 조회 중...`);
let csNo;
try {
  const found = await getCaseByCaseNumber({ courtCode, caseNumber });
  if (!found.found) { console.error(`사건을 찾지 못함: ${found.message ?? '(메시지 없음)'}`); process.exit(1); }
  csNo = found.caseInfo.caseNumber; // court-auction-notice-search가 내부 numeric csNo를 caseInfo.caseNumber로 노출
} catch (e) {
  console.error(`사건 조회 실패: ${e.message}`);
  process.exit(1);
}

const client = new CourtDocsHttpClient({});

console.log('현황조사서 조회 중...');
let statusData;
try {
  statusData = await fetchStatusReport({ client, courtCode, csNo });
} catch (e) {
  console.error(`현황조사서 조회 실패: ${e.message}`);
  if (e.code === 'BLOCKED' || e.code === 'BUDGET_EXCEEDED') process.exit(1);
  statusData = null;
}

console.log('물건상세(최선순위 설정 등) 조회 중...');
let goodsData;
try {
  goodsData = await fetchGoodsDetail({ client, courtCode, csNo, itemSeq });
} catch (e) {
  console.error(`물건상세 조회 실패: ${e.message}`);
  goodsData = null;
}

if (statusData) {
  const { tenants, special } = buildTenantsFromStatusReport(statusData);
  console.log(`\n■ 현황조사서 — 점유관계 확인됨 ${tenants.length}건(임차인), 검토 항목 ${special.length}건`);
  for (const s of special) console.log(`  - [${s.kind}] ${s.note}`);

  if (tenants.length || special.length) {
    if ((c.tenants ?? []).length) {
      // tenants[]를 사람이 이미 손댔다는 뜻 — 현황조사서 재조회 결과를 덮어쓰지 않고 참고용으로만 보여준다.
      console.log(`\n${rel(casePath(id))}의 tenants[]가 이미 채워져 있어 자동으로 덮어쓰지 않음. 아래 내용을 참고해 직접 반영하세요:`);
      if (tenants.length) console.log(JSON.stringify(tenants, null, 2));
    } else {
      const existingNotes = new Set((c.special ?? []).map(s => s.note));
      const newSpecial = special.filter(s => !existingNotes.has(s.note)); // 재실행해도 같은 항목이 중복 쌓이지 않게
      if (tenants.length) c.tenants = tenants;
      if (newSpecial.length) c.special = [...(c.special ?? []), ...newSpecial];
      c.source = { ...c.source, checked_at: todayKST(), note: `${c.source?.note ?? ''} / 법원경매정보 현황조사서(pgj15B/selectCurstExmndc.on)로 확인, 이름은 저장하지 않음`.trim() };
      fs.writeFileSync(casePath(id), `${JSON.stringify(c, null, 2)}\n`);
      console.log(`\n${rel(casePath(id))}에 반영: tenants[] ${tenants.length}건, special[] ${newSpecial.length}건. node tools/analysis/compute.mjs ${id}로 다시 계산하세요.`);
    }
  }
} else {
  console.log('\n■ 현황조사서: 조회 실패 — 위 오류 참고');
}

if (goodsData) {
  const hint = extractBaseRightHint(goodsData);
  console.log(`\n■ 물건상세 — 법원경매정보가 표시하는 최선순위 설정: ${hint ?? '(없음/조사 전)'}`);
  console.log('  rights[]를 등기사항전부증명서로 채운 뒤 compute.mjs의 말소기준권리 결과와 이 값이 맞는지 대조하세요(참고용 — case 파일에는 쓰지 않음).');

  const photos = summarizeCasePhotos(goodsData);
  if (photos.total > 0) {
    const byTypeStr = photos.byType.map(t => `${t.code}×${t.count}`).join(', ');
    console.log(`\n■ 첨부 사진 — 법원경매정보에 총 ${photos.total}장 등록됨(유형 코드별: ${byTypeStr} — 라벨 코드표는 못 찾아 코드 그대로)`);
    console.log('  원본 이미지는 저작권 정책상 자동으로 내려받지 않음 — 필요하면 법원경매정보 사이트에서 직접 확인.');
    const docs = new Set(c.source?.documents ?? []);
    if (!docs.has('사진')) {
      docs.add('사진');
      c.source = { ...c.source, documents: [...docs], checked_at: todayKST() };
      fs.writeFileSync(casePath(id), `${JSON.stringify(c, null, 2)}\n`);
      console.log(`  ${rel(casePath(id))} source.documents에 "사진" 추가.`);
    }
  } else {
    console.log('\n■ 첨부 사진 — 법원경매정보에 등록된 사진 없음');
  }
}

console.log('\n여전히 사람이 확인해야 하는 것: 매각물건명세서(인수되는 권리 전체), 등기사항전부증명서(rights[] 전체, 유료·인터넷등기소), 감정평가서 본문(저작권 경고 있음 — 감정가 숫자만 이미 자동 확인됨), 첨부 사진 원본(개수만 자동 확인, 실제 이미지는 사이트에서).');
