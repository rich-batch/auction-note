#!/usr/bin/env node
// 실거래가로 market.trades[] 후보를 보여준다(자동으로 쓰지 않는다 — 사람이 비교 가능한 사례만
// 골라 data/cases/<id>.json에 직접 넣는다. CLAUDE.md 원칙: 시세는 사람이 확인한 것만).
//   node tools/analysis/fetch-market.mjs <id> [--months N]
//
// 경로 둘:
//   1) k-skill-proxy(https://github.com/NomaDamas/k-skill, docs/features/real-estate-search.md)
//      — apartment/villa/commercial 다 됨, API 키 불필요. 먼저 시도한다.
//   2) 국토교통부 실거래가공개시스템(rt.molit.go.kr) "자료제공" 페이지를 Playwright로 직접
//      조작해 엑셀을 내려받아 읽는다 — k-skill-proxy가 실패했을 때 apartment만 이걸로
//      대체한다(이 페이지 자체가 아파트(매매) 전용이라 villa·commercial은 못 쓴다).
//      왜 필요한가: k-skill-proxy 자신의 이슈 트래커(NomaDamas/k-skill#569)에 이 라우트
//      (/v1/real-estate/:assetType/:dealType)가 48일간 502를 16,861건 반환했다고 기록돼
//      있다 — 업스트림(MOLIT) 일시 장애를 프록시가 재시도 없이 그대로 넘겨서 생기는
//      상시적인 간헐적 실패다. 이 세션에서도 재시도(백오프 포함)까지 붙여 여러 차례
//      확인했지만 계속 실패해서, 완전히 별도 경로(정부 사이트 직접)를 만들었다.
//
// 지원 분류: apartment(아파트, 경로 1·2 다 됨) · villa(연립다세대, 경로 1만) ·
// commercial(상업업무용, 경로 1만). land·car는 실거래가 신고 체계가 다르다.
import fs from 'node:fs';
import { loadCase } from '../lib/cases.mjs';
import { todayKST } from '../lib/paths.mjs';

const PROXY = 'https://k-skill-proxy.nomadamas.org/v1/real-estate';
const CATEGORY_TO_ASSET = { apartment: 'apartment', villa: 'villa', commercial: 'commercial' };

const [id, ...rest] = process.argv.slice(2);
if (!id) { console.error('사용법: fetch-market.mjs <id> [--months N]'); process.exit(2); }
const monthsArg = rest.find(a => a.startsWith('--months='))?.slice('--months='.length)
  ?? (rest.includes('--months') ? rest[rest.indexOf('--months') + 1] : null);
const months = Number(monthsArg ?? 3);

let c;
try { c = loadCase(id); } catch (e) { console.error(e.message); process.exit(1); }

const asset = CATEGORY_TO_ASSET[c.case?.category];
if (!asset) {
  console.error(`분류 "${c.case?.category}"는 이 실거래가 조회 대상이 아니다(apartment/villa/commercial만 지원 — land·car는 실거래가 신고 체계가 다르다).`);
  process.exit(1);
}

const region = c.case?.region ?? '';
const sigungu = region.split(/\s+/)[1];
if (!sigungu) { console.error(`case.region에서 시군구를 못 뽑음: "${region}"`); process.exit(1); }
const buildingHint = region.replace(/\s*외\s*\d+\s*건\s*$/, '');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 경로 1: k-skill-proxy ──────────────────────────────────────────────
async function getJSON(url, { attempts = 3, baseDelayMs = 1500 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(baseDelayMs * i + Math.random() * 500);
    let res, text;
    try { res = await fetch(url); text = await res.text(); } catch (e) { lastErr = new Error(`네트워크 오류 — ${e.message}`); continue; }
    if (res.ok) { try { return JSON.parse(text); } catch { throw new Error(`JSON 파싱 실패 — 응답: ${text.slice(0, 200)}`); } }
    lastErr = new Error(`HTTP ${res.status} — ${text.slice(0, 150).replace(/\s+/g, ' ')}`);
    if (res.status < 500) throw lastErr;
  }
  throw lastErr;
}

function pick(r, ...keys) { for (const k of keys) if (r[k] != null) return r[k]; return undefined; }
function parsePrice(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  if (Number.isNaN(n)) return null;
  return n < 100000 ? n * 10000 : n; // 만원 단위면 원 단위로 환산
}
const thisMonth = todayKST().slice(0, 7).replace('-', '');
function monthsBack(ym, n) {
  const y = Number(ym.slice(0, 4)); const m = Number(ym.slice(4, 6));
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function tryProxy(lawdCd) {
  const out = [];
  let anyOk = false;
  for (let i = 0; i < months; i++) {
    const ym = monthsBack(thisMonth, i);
    try {
      const data = await getJSON(`${PROXY}/${asset}/trade?lawd_cd=${lawdCd}&deal_ymd=${ym}`);
      anyOk = true;
      const rows = data.results ?? data.items ?? data.data ?? (Array.isArray(data) ? data : []);
      console.log(`  [프록시] ${ym}: ${rows.length}건`);
      for (const r of rows) {
        out.push({
          name: pick(r, 'aptNm', 'aptName', 'mhouseNm', 'buildingName', 'offiNm'),
          date: pick(r, 'dealYear') && pick(r, 'dealMonth') ? `${pick(r, 'dealYear')}-${String(pick(r, 'dealMonth')).padStart(2, '0')}-${String(pick(r, 'dealDay') ?? 1).padStart(2, '0')}` : ym.replace(/(\d{4})(\d{2})/, '$1-$2'),
          price: parsePrice(pick(r, 'dealAmount', 'dealAmt', 'price')),
          area: pick(r, 'excluUseAr', 'area', 'exclusiveArea'),
          floor: pick(r, 'floor'),
        });
      }
    } catch (e) {
      console.error(`  [프록시] ${ym} 실패: ${e.message}`);
    }
  }
  return anyOk ? out : null;
}

// ── 경로 2: 국토교통부 실거래가공개시스템 직접 다운로드(아파트만) ─────────────
async function tryMolitDirect() {
  if (asset !== 'apartment') return null;
  console.log('  [MOLIT 직접] Playwright로 rt.molit.go.kr "자료제공" 페이지에서 엑셀 내려받는 중...');
  const { chromium } = await import('playwright');
  const XLSX = (await import('xlsx')).default;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' });
    await page.goto('https://rt.molit.go.kr/pt/xls/xls.do?mobileAt=', { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(800);
    const sidoName = region.split(/\s+/)[0];
    await page.selectOption('#srhSidoCd', { label: sidoName });
    await page.waitForTimeout(800);
    const sggOptions = await page.$$eval('#srhSggCd option', els => els.map(e => ({ value: e.value, text: e.textContent.trim() })));
    const match = sggOptions.find(o => o.text === sigungu);
    if (!match) { console.error(`  [MOLIT 직접] 시군구 "${sigungu}"를 드롭다운에서 못 찾음`); return null; }
    await page.selectOption('#srhSggCd', match.value);
    await page.waitForTimeout(800);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      page.evaluate(() => window.fnExcelDown && window.fnExcelDown()),
    ]);
    if (!download) { console.error('  [MOLIT 직접] 다운로드 실패(버튼이 없거나 페이지 구조가 바뀌었을 수 있음)'); return null; }
    const buf = fs.readFileSync(await download.path());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    const headerIdx = rows.findIndex(r => r[0] === 'NO');
    if (headerIdx < 0) { console.error('  [MOLIT 직접] 예상한 표 헤더(NO로 시작)를 못 찾음 — 사이트 형식이 바뀌었을 수 있음'); return null; }
    const header = rows[headerIdx];
    const col = name => header.indexOf(name);
    const iDong = col('시군구'), iJibun = col('번지'), iName = col('단지명'), iArea = col('전용면적(㎡)'),
      iYm = col('계약년월'), iDay = col('계약일'), iPrice = col('거래금액(만원)'), iFloor = col('층'), iCancel = col('해제사유발생일'),
      iDealType = col('거래유형');
    const notCancelled = rows.slice(headerIdx + 1).filter(r => r[0] != null && r[iCancel] === '-'); // 해제(취소)된 거래는 뺀다
    const direct = iDealType >= 0 ? notCancelled.filter(r => r[iDealType] === '직거래') : [];
    const data = iDealType >= 0 ? notCancelled.filter(r => r[iDealType] !== '직거래') : notCancelled; // 직거래는 시세 왜곡(증여성 저가 등) 가능성이 커서 뺀다
    console.log(`  [MOLIT 직접] ${data.length}건(해제된 거래·직거래 ${direct.length}건 제외, ${sidoName} ${sigungu} 최근 1년)`);
    return data.map(r => ({
      name: r[iName],
      dong: r[iDong],
      jibun: r[iJibun],
      date: `${String(r[iYm]).slice(0, 4)}-${String(r[iYm]).slice(4, 6)}-${String(r[iDay]).padStart(2, '0')}`,
      price: Number(String(r[iPrice]).replace(/,/g, '')) * 10000,
      area: Number(r[iArea]),
      floor: r[iFloor],
    }));
  } finally {
    await browser.close();
  }
}

// ── 실행 ─────────────────────────────────────────────────────────────
console.log(`시군구 "${sigungu}"로 지역코드 조회 중...`);
let lawdCd = null;
try {
  const regionData = await getJSON(`${PROXY}/region-code?q=${encodeURIComponent(sigungu)}`);
  lawdCd = regionData.results?.[0]?.lawd_cd;
  if (lawdCd) console.log(`지역코드: ${lawdCd} (${regionData.results[0].name})`);
} catch (e) {
  console.error(`지역코드 조회 실패(프록시 문제일 수 있음, 계속 진행): ${e.message}`);
}

let trades = lawdCd ? await tryProxy(lawdCd) : null;
let source = 'k-skill-proxy';
if (!trades) {
  console.log('프록시 경로 실패 — MOLIT 직접 다운로드로 전환');
  trades = await tryMolitDirect();
  source = 'rt.molit.go.kr 직접 다운로드';
}

if (!trades) {
  console.error(`\n${asset === 'apartment' ? '두 경로 다' : '프록시 경로가'} 실패했다.${asset !== 'apartment' ? ` villa·commercial은 현재 k-skill-proxy만 지원하는데 그게 안 됨(NomaDamas/k-skill#569 — 알려진 간헐적 502).` : ''} 사람이 https://rt.molit.go.kr 에서 직접 확인해서 market.trades에 넣어라.`);
  process.exit(1);
}

const parsed = trades.map(t => ({ ...t, looksLikeSameBuilding: t.name && buildingHint.includes(String(t.name).replace(/\s/g, '')) }));

// 가격/면적(원/㎡)이 같은 단지 내 중앙값의 60% 미만인 거래는 증여성 저가 매매 등으로 보고 뺀다.
// 단지 전체(예: 관악구 전체)를 기준으로 중앙값을 내면 단지·평형이 섞여 의미가 없어지므로
// 반드시 "같은 단지로 보이는" 그룹 안에서만 비교한다. 표본이 너무 적으면 중앙값이 의미 없어 거르지 않는다.
function dropLowOutliersWithinGroup(list) {
  const withUnit = list.filter(t => t.price && t.area).map(t => ({ ...t, unitPrice: t.price / t.area }));
  if (withUnit.length < 5) return { kept: list, dropped: [] };
  const sorted = [...withUnit].map(t => t.unitPrice).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = median * 0.6;
  const dropped = list.filter(t => t.price && t.area && t.price / t.area < threshold);
  const kept = list.filter(t => !(t.price && t.area && t.price / t.area < threshold));
  return { kept, dropped };
}
const { kept: sameBuilding, dropped: lowOutliers } = dropLowOutliersWithinGroup(parsed.filter(p => p.looksLikeSameBuilding));
if (lowOutliers.length) {
  console.log(`\n같은 단지 내 시세 대비 지나치게 낮은 거래 ${lowOutliers.length}건 제외(같은 단지 원/㎡ 중앙값의 60% 미만 — 증여성 저가 거래 등으로 추정):`);
  for (const p of lowOutliers) console.log(`  ${p.date} | ${p.name ?? '?'} ${p.area ?? '?'}㎡ | ${p.price ? p.price.toLocaleString('ko-KR') + '원' : '?'}`);
}
const others = parsed.filter(p => !p.looksLikeSameBuilding);

console.log(`\n총 ${parsed.length}건 조회됨(${source}). 물건 소재지: "${region}"\n`);
if (sameBuilding.length) {
  console.log('■ 같은 단지/건물명으로 보이는 거래(우선 검토):');
  for (const p of sameBuilding) console.log(`  ${p.date} | ${p.name ?? '?'} ${p.area ?? '?'}㎡ ${p.floor ?? '?'}층 | ${p.price ? p.price.toLocaleString('ko-KR') + '원' : '가격 파싱 실패'}`);
} else {
  console.log('■ 같은 단지/건물명으로 보이는 거래: 없음(건물명이 case.region과 안 겹침 — 아래 전체 목록에서 직접 확인)');
}
if (others.length) {
  console.log(`\n■ 같은 법정동의 다른 거래(참고, ${others.length}건 중 최대 10건):`);
  for (const p of others.slice(0, 10)) console.log(`  ${p.date} | ${p.name ?? '?'} ${p.area ?? '?'}㎡ ${p.floor ?? '?'}층 | ${p.price ? p.price.toLocaleString('ko-KR') + '원' : '가격 파싱 실패'}`);
}

console.log(`\n사람이 확인 후, 비교 가능한 사례만 골라 data/cases/${id}.json의 market.trades[]에 { "date", "price", "area_m2", "floor" } 형태로 직접 넣어라. market.source_url은 "${source === 'k-skill-proxy' ? `${PROXY}/${asset}/trade` : 'https://rt.molit.go.kr/pt/xls/xls.do'}", market.checked_at은 오늘 날짜로.`);
