#!/usr/bin/env node
// 법원경매 사건의 기일 내역(회차별 최저가·결과)과 매각물건명세서 요약(최선순위 설정·매각으로 소멸되지
// 않는 권리)을 법원경매정보 물건상세에서 읽어 온다.
//   node tools/analysis/fetch-court-result.mjs <id> [<id> ...] [--write]
//
// --write 하면 data/cases/<id>.json에 반영한다:
//   result          분석한 회차(sale.sale_date)의 결과 + 그 뒤 회차(later[]) — 결과 페이지·배너가 자동 갱신
//   sale.failed_rounds  분석한 회차 이전에 유찰된 횟수(공고 데이터와 어긋나던 값을 바로잡는다)
//   spec_sheet.base_right_text / surviving_rights_text  비어 있을 때만 채운다(사람이 넣은 값은 그대로)
//   rights[0]       rights에 날짜 있는 권리가 없으면 명세서 "최선순위 설정"의 날짜·종류(등기부는 유료라 보지 않는다)
//   case.area_m2    비어 있으면 물건상세 "전유" 면적
// 다음 회차(아직 결과 없음)는 콘솔에 보여 주기만 한다 — 그 회차를 분석할지는 사람이 정한다.
//
// 원본 응답은 private/court/<id>.goods.json에 저장한다(이해관계인 실명이 섞여 있어 저장소 밖 — private/는
// gitignore). 법원경매정보는 요청이 몰리면 IP를 1시간 차단하므로 사건 사이에 쉬고, 차단되면 그 자리에서 멈춘다.
import fs from 'node:fs';
import path from 'node:path';
import { getCaseByCaseNumber, CourtAuctionHttpClient } from 'court-auction-notice-search';
import { loadCase } from '../lib/cases.mjs';
import { casePath, rel, todayKST } from '../lib/paths.mjs';
import { courtCodeFromId } from '../lib/courts.mjs';
import { CourtDocsHttpClient, fetchGoodsDetail } from '../lib/court-docs.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
const ids = args.filter(a => !a.startsWith('--'));
if (!ids.length) { console.error('사용법: fetch-court-result.mjs <id> [<id> ...] [--write]'); process.exit(2); }

const PAUSE_BETWEEN_CASES_MS = 15_000;
// 기일 결과 코드(auctnDxdyRsltCd). 002는 회차마다 최저가가 저감되는 공고로 확인했다.
// 모르는 코드는 원문 코드 그대로 남기고 경고한다 — 추측해서 이름 붙이지 않는다.
const RESULT_LABEL = { '001': '매각', '002': '유찰' };
const ymd = s => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
const today = todayKST();

let first = true;

for (const id of ids) {
  if (!first) await new Promise(r => setTimeout(r, PAUSE_BETWEEN_CASES_MS));
  first = false;

  let c;
  try { c = loadCase(id); } catch (e) { console.error(`${id}: ${e.message}`); continue; }
  const courtCode = courtCodeFromId(id);
  if (!courtCode || !/^\d{4}타경\d+$/.test(c.case?.number ?? '')) { console.error(`${id}: 법원경매 사건이 아님`); continue; }

  let goods, found;
  try {
    found = await getCaseByCaseNumber({ courtCode, caseNumber: c.case.number, client: new CourtAuctionHttpClient({}) }); // 패키지 세션 호출 한도(10회)가 사건마다 새로 시작되도록
    if (!found.found) { console.error(`${id}: 사건을 찾지 못함 (${found.message ?? ''})`); continue; }
    fs.mkdirSync('private/court', { recursive: true });
    fs.writeFileSync(path.join('private/court', `${id}.case.json`), JSON.stringify(found, null, 1));
    const { finalDispositionCode: ultmt, suspensionStatusCode: susp } = found.caseInfo;
    if ((ultmt && ultmt !== '000') || (susp && susp !== '00')) console.log(`\n■ ${id}: 사건 종국·정지 코드 종국=${ultmt} 정지=${susp} — 매각 절차가 끝났거나 멈췄을 수 있다(private/court/${id}.case.json 확인)`);
    goods = await fetchGoodsDetail({ client: new CourtDocsHttpClient({}), courtCode, csNo: found.caseInfo.caseNumber, itemSeq: c.case.item_no ?? 1 });
  } catch (e) {
    console.error(`${id}: 조회 실패 — ${e.message}`);
    if (e.code === 'BLOCKED' || e.code === 'BUDGET_EXCEEDED') { console.error('차단·호출 한도 — 여기서 멈춘다. 약 1시간 뒤 남은 사건부터 다시 실행'); process.exit(1); }
    continue;
  }
  fs.writeFileSync(path.join('private/court', `${id}.goods.json`), JSON.stringify(goods, null, 1));

  const info = goods?.dspslGdsDxdyInfo ?? {};
  // 물건상세의 기일 내역(전체 회차)을 쓰고, 매각된 물건처럼 물건상세가 비어 오면 사건 상세의 기일 내역(최근 회차)으로 대신한다.
  // 매각가는 사건 상세 물건 목록의 dspslAmt(그 물건의 마지막 매각기일 매각가)에서 온다.
  const caseData = found?.raw?.data ?? {};
  const itemSeq = c.case.item_no ?? 1;
  const sold = (caseData.dlt_dspslGdsDspslObjctLst ?? []).find(o => o.dspslGdsSeq === itemSeq);
  const source = goods?.gdsDspslDxdyLst?.length ? goods.gdsDspslDxdyLst : (caseData.dlt_rletCsGdsDtsDxdyInf ?? []).filter(r => r.dspslGdsSeq === itemSeq);
  const rounds = source
    .filter(r => r.auctnDxdyKndCd === '01') // 01 = 매각기일 (02 = 매각결정기일)
    .map(r => {
      const date = ymd(r.dxdyYmd);
      const outcome = r.auctnDxdyRsltCd ? (RESULT_LABEL[r.auctnDxdyRsltCd] ?? `코드 ${r.auctnDxdyRsltCd}`) : null;
      const winning_bid = outcome === '매각' && sold && ymd(sold.dspslDxdyYmd) === date ? Number(sold.dspslAmt) || null : null;
      return { date, minimum: Number(r.tsLwsDspslPrc) || (sold && ymd(sold.dspslDxdyYmd) === date ? Number(sold.fstPbancLwsDspslPrc) || null : null), code: r.auctnDxdyRsltCd ?? null, outcome, winning_bid };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  console.log(`\n■ ${id} ${c.case.number} — 유찰 ${info.flbdNcnt ?? '?'}회, 최선순위 설정: ${info.tprtyRnkHypthcStngDts ?? '(없음)'}`);
  if (info.ndstrcRghCtt) console.log(`  매각으로 소멸되지 않는 권리: ${info.ndstrcRghCtt}`);
  for (const r of rounds) {
    console.log(`  ${r.date} 최저 ${r.minimum?.toLocaleString() ?? '-'}원 → ${r.outcome ?? '(예정)'}${r.winning_bid ? ` ${r.winning_bid.toLocaleString()}원` : ''}`);
    if (r.code && !RESULT_LABEL[r.code]) console.log(`  ⚠ 모르는 결과 코드 ${r.code} — private/court/${id}.goods.json·.case.json 원본 확인`);
  }

  const idx = rounds.findIndex(r => r.date === c.sale.sale_date);
  if (idx < 0) { console.log(`  분석 회차(${c.sale.sale_date})가 기일 내역에 없음 — 기일이 바뀌었을 수 있다. 쓰지 않음`); continue; }
  const analyzed = rounds[idx];
  const failedBefore = rounds.slice(0, idx).filter(r => r.code === '002').length;
  const upcoming = rounds.slice(idx + 1).find(r => !r.code && r.date >= today);
  if (upcoming) console.log(`  다음 회차: ${upcoming.date} 최저 ${upcoming.minimum?.toLocaleString()}원`);

  if (!write) continue;
  const raw = fs.readFileSync(casePath(id), 'utf8');
  const data = JSON.parse(raw);
  // 사건 상세 대체 경로는 최근 회차만 담고 있어 유찰 횟수를 셀 수 없다 — 물건상세 전체 내역이 있을 때만 고친다
  if (goods?.gdsDspslDxdyLst?.length && data.sale.failed_rounds !== failedBefore) {
    console.log(`  sale.failed_rounds ${data.sale.failed_rounds} → ${failedBefore}`);
    data.sale.failed_rounds = failedBefore;
  }
  if (analyzed.minimum && data.sale.minimum !== analyzed.minimum) console.log(`  ⚠ sale.minimum(${data.sale.minimum})과 기일 내역 최저가(${analyzed.minimum})가 다름 — 확인 필요, 자동으로 바꾸지 않음`);
  data.spec_sheet ??= {};
  if (!data.spec_sheet.base_right_text && info.tprtyRnkHypthcStngDts) data.spec_sheet.base_right_text = info.tprtyRnkHypthcStngDts;
  if (!data.spec_sheet.surviving_rights_text && info.ndstrcRghCtt) data.spec_sheet.surviving_rights_text = info.ndstrcRghCtt;
  // 말소기준권리: 등기부(유료)를 보지 않으므로 명세서 "최선순위 설정"(예: "2023.06.20. 근저당권")의 날짜·종류를 rights[0]에 옮긴다.
  // rights[]에 날짜 있는 권리가 이미 있으면(사람이 넣었으면) 건드리지 않는다.
  const KIND = { '근저당': '근저당권', '개시결정': '경매개시결정' };
  const top = /^(\d{4})\.(\d{2})\.(\d{2})\.?\s*(.+)$/.exec((info.tprtyRnkHypthcStngDts ?? '').trim());
  if (top && !(data.rights ?? []).some(r => r.date)) {
    const kind = KIND[top[4].trim()] ?? top[4].trim();
    const holder = data.rights?.[0]?.holder_type ?? null;
    data.rights = [{ date: `${top[1]}-${top[2]}-${top[3]}`, receipt_no: null, kind, amount: null, holder_type: /저당/.test(kind) ? holder : null,
      note: `매각물건명세서 "최선순위 설정"(법원경매정보 물건상세, ${today} 조회) — 등기부는 보지 않음(유료). 금액·접수번호·후순위 등기는 미확인` }];
    console.log(`  rights[0] → ${data.rights[0].date} ${kind}(명세서 최선순위 설정)`);
  }
  // 전용면적: 물건상세 건물 목록의 "전유" 행(예: "철근콘크리트조 / 84.92㎡")에서 면적이 하나뿐일 때만 채운다
  if (data.case.area_m2 == null) {
    const own = (goods?.bldSdtrDtlLstAll ?? []).flat().filter(b => b.rletDvsDts === '전유');
    const areas = own.flatMap(b => [...(b.bldSdtrDtlDts ?? '').matchAll(/([\d.]+)㎡/g)].map(m => Number(m[1])));
    if (own.length === 1 && areas.length === 1) { data.case.area_m2 = areas[0]; console.log(`  case.area_m2 → ${areas[0]}㎡(전유)`); }
  }
  if (analyzed.code) {
    data.result = {
      outcome: analyzed.outcome,
      winning_bid: analyzed.winning_bid,
      bidders: data.result?.bidders ?? null,
      checked_at: today,
      later: rounds.slice(idx + 1).filter(r => r.code).map(r => ({ date: r.date, minimum: r.minimum, outcome: r.outcome, winning_bid: r.winning_bid, bidders: null })),
    };
  }
  fs.writeFileSync(casePath(id), JSON.stringify(data, null, 2) + '\n');
  console.log(`  → ${rel(casePath(id))} 갱신${analyzed.code ? '' : ' (분석 회차 결과 아직 없음)'} — 다음: node tools/analysis/compute.mjs ${id}`);
}
