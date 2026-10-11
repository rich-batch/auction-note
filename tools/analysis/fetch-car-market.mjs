#!/usr/bin/env node
// 자동차 사건의 "비슷한 차량 시세" 후보를 모은다. 감정가는 중고차 시세를 따라가지 못하므로(연식·주행거리·
// 사고 이력 반영이 늦다) 같은 차종이 실제로 얼마에 거래되는지를 출처별로 따로 본다.
//   node tools/analysis/fetch-car-market.mjs <id> [--model <차종 검색어>] [--months 12] [--years 1] [--write]
//
// 출처 셋(market.trades[].source):
//   onbid  — 온비드 공매 낙찰가. 온비드 "물건입찰결과" 화면(로그인 불필요)에서 같은 차종·비슷한 연식의
//            최근 낙찰 건을 자동으로 찾는다. --write를 주면 market.trades의 onbid 항목을 이 결과로 바꾼다.
//   car365 — 자동차365(국토부·교통안전공단) 평균 매매가. 양도증명서 기준 동일 형식 차량 1년 평균. 자동 조회
//            경로가 없어 사람이 사이트에서 확인해 넣는다(아래에 넣을 형식을 출력).
//   daangn — 당근중고차 매물 호가. k-skill 고지상 자동 수집은 개인적 조회로 한정되고 이 블로그는 공개 사이트라
//            자동으로 긁지 않는다 — 사람이 직접 검색해 비슷한 매물만 넣는다.
// 어떤 사례가 "비슷한가"(연식·주행거리·트림)는 판단이라 결과를 보고 사람이 고른다. --write는 그 판단을 마친 뒤에.
import fs from 'node:fs';
import { loadCase } from '../lib/cases.mjs';
import { casePath, todayKST } from '../lib/paths.mjs';
import { searchOnbidBidResults, onbidResultFor, BID_RESULT_URL } from '../lib/onbid.mjs';

const argv = process.argv.slice(2);
const id = argv.find(a => !a.startsWith('--'));
const opt = k => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
if (!id) { console.error('사용법: node tools/analysis/fetch-car-market.mjs <id> [--model <검색어>] [--months 12] [--years 1] [--write]'); process.exit(2); }

const c = loadCase(id);
if (c.case.category !== 'car') { console.error(`${id}는 자동차 사건이 아님 — 부동산은 fetch-market.mjs`); process.exit(2); }
const v = c.case.vehicle ?? {};

// 차종 검색어: 제조사 이름을 빼고 첫 낱말("현대자동차 쏘나타" → 쏘나타, "BMW 528i xDrive" → 528i)
const MAKERS = /^(현대자동차|현대|기아자동차|기아|제네시스|쌍용|KG모빌리티|르노삼성|르노|쉐보레|한국GM|BMW|벤츠|메르세데스벤츠|아우디|폭스바겐|볼보|렉서스|토요타|도요타|혼다|닛산|포드|지프|테슬라|포르쉐|페라리|람보르기니|재규어|랜드로버|미니|푸조|캐딜락|링컨)$/i;
// 모델명이 제조사 이름뿐이면("제네시스", "재규어") 그 이름 그대로 찾는다 — 재규어처럼 모델을 모르면 비교 범위가 넓어짐을 알린다
const words = (v.model ?? '').split(/\s+/).filter(Boolean);
const keyword = opt('model') ?? words.find(w => !MAKERS.test(w)) ?? words[0];
if (!opt('model') && words.length && words.every(w => MAKERS.test(w))) console.log(`※ 모델명이 "${v.model}"뿐이라 같은 이름의 다른 차종도 섞일 수 있음 — 정확한 모델을 알면 --model로 지정`);
if (!keyword) { console.error('차종 검색어를 정할 수 없음 — --model <검색어>로 지정'); process.exit(2); }

const months = Number(opt('months') ?? 12);
const yearSpan = Number(opt('years') ?? 1);
const today = todayKST();
const ymd = d => d.toISOString().slice(0, 10);
const end = ymd(new Date(Date.parse(today) - 864e5)); // 종료일은 과거만 조회된다
const start = ymd(new Date(Date.parse(today) - months * 30.4 * 864e5));
const num = s => Number(String(s ?? '').replace(/[^\d]/g, '')) || null;

console.log(`온비드 낙찰 사례 조회: 차종 "${keyword}", 개찰일 ${start} ~ ${end}${v.year ? `, 연식 ${v.year - yearSpan}~${v.year + yearSpan}` : ''}`);
const rows = await searchOnbidBidResults({
  srchCltrType: '0002', srchVhcMdlNm: keyword,
  srchOpbdBgdd: start, calOpbdBgdd: start, srchOpbdEndd: end, calOpbdEndd: end,
  pageIndex: '1', pageUnit: '200',
});

// 이 사건 자체의 결과가 보이면 result 입력에 쓸 수 있게 따로 알려 준다
const own = rows.filter(r => r.scrnIndctCltrMngNo === c.case.number && ['0010', '0011'].includes(r.pbctStatCd)).sort((a, b) => a.pbctExctDt.localeCompare(b.pbctExctDt));
for (const r of own) console.log(`\n이 사건 결과(온비드 공개): ${r.pbctExctDt} ${r.pbctStatNm}${r.pbctStatCd === '0010' ? ` ${r.onbidBidAmt}원, 응찰 ${r.totalBid}명` : ''} ${r.pbctExctDt.slice(0, 10) === c.sale.sale_date ? ' ← 분석한 회차(sale.sale_date) — result에 넣는 값' : ' (다른 회차)'}`);
// 이 사건 차량의 주행거리·연료/배기량은 온비드 입찰결과에 공개돼 있다 — --write 때 case.vehicle에 채운다(비어 있을 때만)
const ownInfo = rows.find(r => r.scrnIndctCltrMngNo === c.case.number && (r.drvDstcNm || r.fuelContDsvlmNm));
const ownVehicle = ownInfo ? { mileage_km: num(ownInfo.drvDstcNm), fuel: ownInfo.fuelContDsvlmNm ?? null } : null;
if (ownVehicle) console.log(`이 차량(온비드 공개): 주행거리 ${ownVehicle.mileage_km?.toLocaleString('ko-KR') ?? '?'}km, ${ownVehicle.fuel ?? '연료 미상'}`);

const seen = new Set();
const trades = rows
  .filter(r => r.pbctStatCd === '0010' && r.scrnIndctCltrMngNo !== c.case.number)
  // 연식이 공개되지 않은 낙찰 건(다른 기관 이용 공매 등)은 비슷한지 확인할 수 없어 뺀다
  .filter(r => !v.year || (num(r.nrtpNm) && Math.abs(num(r.nrtpNm) - v.year) <= yearSpan))
  .filter(r => !seen.has(r.scrnIndctCltrMngNo) && seen.add(r.scrnIndctCltrMngNo))
  .map(r => ({
    source: 'onbid',
    date: r.pbctExctDt.slice(0, 10),
    price: num(r.onbidBidAmt),
    year: num(r.nrtpNm),
    mileage_km: num(r.drvDstcNm),
    bidders: num(r.totalBid),
    ref: r.scrnIndctCltrMngNo,
  }))
  .filter(t => t.price);

if (!trades.length) {
  console.log(`\n조건에 맞는 낙찰 사례 없음 — --model로 검색어를 바꾸거나(예: 트림 빼고 모델명만) --months·--years를 넓혀 본다`);
} else {
  console.log(`\n낙찰 사례 ${trades.length}건 (같은 물건관리번호는 최근 1건만)`);
  console.log('개찰일     | 물건관리번호        | 연식 | 주행거리   | 낙찰가          | 응찰');
  for (const t of trades) console.log(`${t.date} | ${t.ref.padEnd(18)} | ${t.year ?? '?'} | ${t.mileage_km != null ? `${t.mileage_km.toLocaleString('ko-KR')}km`.padEnd(10) : '?'.padEnd(10)} | ${t.price.toLocaleString('ko-KR').padStart(13)}원 | ${t.bidders ?? '?'}명`);
  const avg = Math.round(trades.reduce((s, t) => s + t.price, 0) / trades.length);
  console.log(`평균 낙찰가 ${avg.toLocaleString('ko-KR')}원 · 이 사건 최저가 ${c.sale.minimum.toLocaleString('ko-KR')}원${v.year ? ` · 이 차 ${v.year}년식` : ''}`);
}

if (argv.includes('--write')) {
  const file = casePath(id);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const done = [];
  if (trades.length) {
    const others = (data.market?.trades ?? []).filter(t => t.source !== 'onbid');
    data.market = { ...(data.market ?? {}), trades: [...others, ...trades], checked_at: today, source_url: BID_RESULT_URL };
    done.push(`market.trades에 온비드 낙찰 사례 ${trades.length}건(기존 onbid 항목은 교체)`);
  }
  if (ownVehicle) {
    const veh = data.case.vehicle ?? {};
    data.case.vehicle = { ...veh, mileage_km: veh.mileage_km ?? ownVehicle.mileage_km, fuel: veh.fuel ?? ownVehicle.fuel };
    done.push('case.vehicle 주행거리·연료(비어 있던 칸만)');
  }
  // 분석한 회차(sale.sale_date)의 결과가 공개돼 있고 result가 비어 있으면 채운다(이후 회차는 result.later로)
  const res = onbidResultFor(data, rows, today);
  if (res && !data.result?.outcome) {
    data.result = res;
    done.push(`result(${res.outcome}${res.later ? ` + 이후 회차 ${res.later.length}건` : ''})`);
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`\n${file}: ${done.length ? done.join(', ') + ' 반영' : '바꾼 것 없음'}. 다음: node tools/analysis/compute.mjs ${id}`);
} else if (trades.length) {
  console.log(`\n비슷하지 않은 사례(연식·주행거리 차이가 큰 것)가 섞였으면 --years·--model로 좁힌 뒤 --write로 넣는다.`);
}

console.log(`
사람이 확인해 넣을 출처 (market.trades에 한 줄씩):
  자동차365 평균 매매가 — https://www.car365.go.kr → 중고차의 모든 것 > 시세 및 매물차량 > 평균매매가조회${v.plate ? ` (차량번호 ${v.plate}로 동일 형식 차량 조회)` : ''}
    { "source": "car365", "date": "${today}", "price": <평균 매매가(원)>, "year": ${v.year ?? '<연식>'}, "note": "동일 형식 1년 평균" }
  당근중고차 매물 호가 — 당근 중고차에서 "${keyword}" 검색, 연식·주행거리가 비슷한 판매 중 매물만
    { "source": "daangn", "date": "${today}", "price": <판매가(원)>, "year": <연식>, "mileage_km": <주행거리>, "url": "<매물 주소>" }`);
