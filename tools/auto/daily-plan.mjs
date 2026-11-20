#!/usr/bin/env node
// 하루 1회 클라우드 예약 작업("경매 노트 매일 분석 글 공개")이 오늘 무엇을 할지 정한다.
// 대상은 **서울 아파트 + 권리관계가 깔끔한 사건**만이다(2026-11-20 운영자 결정).
// 예약 작업이 사건 데이터·스캔 출력·스킬 문서를 통째로 읽지 않도록, 판단에 필요한 것만
// 몇 줄로 출력한다(토큰 절약). 사건을 등록하거나 파일을 바꾸지는 않는다.
//
//   node tools/auto/daily-plan.mjs [--skip id1,id2]   오늘 할 일 한 줄
//   node tools/auto/daily-plan.mjs --check <사건ID>    등록·compute 뒤 "깔끔한가" 판정(CLEAN / NOT_CLEAN <이유>)
//     --skip  이미 열린 PR이 다루는 사건 ID(쉼표). 예약 작업이 GitHub에서 열린 PR을 보고 넘긴다.
//
// 첫 줄이 결론:
//   WRITE <사건ID> <매각기일>                         이미 등록·계산됐고 깔끔한데 글만 없는 사건 — 바로 analyze-case
//   REGISTER court <법원코드> <사건번호> <매각기일>    법원경매 새 후보 — fetch-court.mjs … → compute → --check
//   REGISTER onbid <물건관리번호> <개찰일>            온비드 새 후보 — fetch-onbid.mjs → compute → --check
//   STOP <이유>                                      오늘은 쓸 글이 없다 — 그대로 끝낸다
// 둘째 줄부터는 참고(대안 후보 등). REGISTER 후보가 --check에서 NOT_CLEAN이면 --skip에 그 사건을 더해 다시 돌린다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listCaseIds, loadCase, caseStage, isComputedFresh } from '../lib/cases.mjs';
import { todayKST } from '../lib/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const get = flag => args.find(a => a.startsWith(`--${flag}=`))?.slice(flag.length + 3)
  ?? (args.includes(`--${flag}`) ? args[args.indexOf(`--${flag}`) + 1] : null);
const out = (head, notes = []) => { console.log(head); for (const n of notes) console.log(`  ${n}`); process.exit(0); };

const today = todayKST();
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const isWeekday = d => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w >= 1 && w <= 5; };

const SEOUL_COURTS = ['B000210', 'B000211', 'B000212', 'B000213', 'B000215']; // 서울중앙·동부·남부·북부·서부
const MIN_LEAD_WRITE = 2;  // 이미 등록된 사건: 오늘 PR → 내일 머지라 모레 이후 매각만
const MIN_LEAD_NEW = 4;    // 새 사건: 등록·작성·다음 날 머지까지 여유
const WINDOW_DAYS = 14;
const MIN_PRICE = 100_000_000; // 서울 아파트 최저가 1억 미만은 지분·특수물건일 가능성이 커서 뺀다
// 공고 비고에 이런 말이 있으면 권리관계가 깔끔하지 않다고 보고 후보에서 뺀다.
const RISKY = /유치권|법정지상권|대항력|선순위|임차권|전세권|지분|위반건축|대지권\s*(미등기|없음)|토지별도등기|가처분|가등기|인수|특별매각조건|재매각|농지취득|분묘|맹지|제시외/;

// ---- 깔끔한가: 계산 결과 기준 ----
function cleanReason(c) {
  if (c.case?.category !== 'apartment') return `분류가 아파트가 아님(${c.case?.category})`;
  if (!/^서울/.test(c.case?.region ?? '')) return '서울 소재가 아님';
  if (!isComputedFresh(c)) return 'compute.mjs 결과가 없거나 최신이 아님';
  const k = c.computed;
  if (k.ownership_risk) return '소유권 위험(선순위 가처분·가등기 등)';
  if ((k.assumed_total_max ?? 1) > 0) return `인수 예상액 최대 ${(k.assumed_total_max ?? 0).toLocaleString('ko-KR')}원`;
  if ((k.rights ?? []).some(r => r.effect !== '소멸')) return '소멸하지 않는 권리 있음';
  const stars = Object.fromEntries((k.score?.items ?? []).map(i => [i.key, i.stars]));
  if (stars.tenant_risk != null && stars.tenant_risk < 5) return '대항력 임차인 인수 부담 가능';
  return null;
}

const checkId = get('check');
if (checkId) {
  const why = cleanReason(loadCase(checkId));
  out(why ? `NOT_CLEAN ${why}` : 'CLEAN');
}

const skip = new Set((get('skip') ?? '').split(',').map(s => s.trim()).filter(Boolean));
const registered = listCaseIds().map(loadCase);

// 1) 이미 등록·계산됐고 깔끔한데 글이 없는 사건(가장 싸다 — 스캔·조회가 필요 없다)
const pending = registered
  .filter(c => !skip.has(c.id) && caseStage(c, today) === '글 작성 대기' && c.sale.sale_date >= addDays(today, MIN_LEAD_WRITE) && !cleanReason(c))
  .sort((a, b) => a.sale.sale_date.localeCompare(b.sale.sale_date));
if (pending.length) out(`WRITE ${pending[0].id} ${pending[0].sale.sale_date}`, pending.slice(1, 4).map(c => `다른 대기 사건: ${c.id} ${c.sale.sale_date}`));

// 매번 새 세션이라 의존성이 없을 수 있다 — 조용히 설치
if (!fs.existsSync(path.join(ROOT, 'node_modules', 'court-auction-notice-search'))) {
  spawnSync('npm', ['ci', '--no-audit', '--no-fund', '--silent'], { cwd: ROOT, stdio: 'ignore', timeout: 5 * 60_000 });
}

const from = addDays(today, MIN_LEAD_NEW);
const to = addDays(today, WINDOW_DAYS);
const registeredNumbers = new Set(registered.map(c => c.case?.number).filter(Boolean));
const notes = [];

// 2) 법원경매: 서울 5개 법원, 매각공고 목록(월 단위) → 기간 안 공고 상세 → 아파트·비고 깨끗·미등록
const { searchSaleNotices, getSaleNoticeDetail, CourtAuctionHttpClient } = await import('court-auction-notice-search');
const months = [...new Set([from.slice(0, 7), to.slice(0, 7)])];
const dayNo = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000);
const courts = SEOUL_COURTS.map((_, i) => SEOUL_COURTS[(dayNo + i) % SEOUL_COURTS.length]); // 날마다 다른 법원부터
const found = [];
let blocked = false;
for (const [ci, code] of courts.entries()) {
  if (blocked || found.length >= 3) break;
  if (ci > 0) await new Promise(r => setTimeout(r, 60_000)); // 법원 전환 1분 — 차단 예방(scan-court.mjs와 같은 기준)
  const client = new CourtAuctionHttpClient({});
  try {
    const notices = [];
    for (const m of months) notices.push(...(await searchSaleNotices({ date: m, courtCode: code, bidType: 'date', client })).items);
    const targets = notices.filter(n => n.saleDate >= from && n.saleDate <= to && isWeekday(n.saleDate)).sort((a, b) => a.saleDate.localeCompare(b.saleDate));
    let hits = 0;
    for (const n of targets) {
      const detail = await getSaleNoticeDetail(n, { client });
      for (const it of detail.items) {
        if (registeredNumbers.has(it.caseNumber) || skip.has(it.caseNumber)) continue;
        if (!/아파트/.test(it.usage ?? '')) continue;
        if (RISKY.test(`${it.usage ?? ''} ${it.remarks ?? ''}`)) continue;
        if ((it.minimumSalePrice ?? 0) < MIN_PRICE) continue;
        if (found.some(f => f.caseNumber === it.caseNumber)) continue;
        found.push({ code, caseNumber: it.caseNumber, date: n.saleDate, min: it.minimumSalePrice, addr: it.address });
        hits++;
      }
      if (found.length >= 3) break;
    }
    if (!hits) notes.push(`법원 ${code}: ${from}~${to} 깔끔한 서울 아파트 후보 없음(공고 ${targets.length}건)`);
  } catch (e) {
    if (e.code === 'BLOCKED') { blocked = true; notes.push(`법원경매정보 차단(${code}) — 오늘은 중단, 자동 재시도 금지`); }
    else if (e.code === 'BUDGET_EXCEEDED') notes.push(`법원 ${code}: 세션 호출 한도 — 남은 공고는 내일`);
    else notes.push(`법원 ${code} 조회 실패: ${String(e.message).slice(0, 120)}`);
  }
}
if (found.length) {
  found.sort((a, b) => a.date.localeCompare(b.date));
  const [f, ...rest] = found;
  const addr = a => (typeof a === 'string' ? a : JSON.stringify(a ?? '')).slice(0, 60);
  out(`REGISTER court ${f.code} ${f.caseNumber} ${f.date}`, [
    `최저가 ${(f.min ?? 0).toLocaleString('ko-KR')}원 | ${addr(f.addr)}`,
    ...rest.map(x => `대안: court ${x.code} ${x.caseNumber} ${x.date}`), ...notes]);
}

// 3) 온비드: 서울 아파트(압류재산 등) — scan-onbid.mjs 출력에서 고른다
const r = spawnSync('node', [path.join(ROOT, 'tools', 'analysis', 'scan-onbid.mjs'), '--days', String(WINDOW_DAYS), '--min-price', String(MIN_PRICE)], { encoding: 'utf8', timeout: 6 * 60_000 });
if (r.status !== 0) notes.push(`온비드 스캔 오류: ${((r.stderr ?? '').split('\n').find(l => /Error|실패/.test(l)) ?? `exit ${r.status}`).trim().slice(0, 120)}`);
const rows = [...(r.stdout ?? '').matchAll(/^(\d{4}-\d+-\d+) \| (\d{4}-\d{2}-\d{2}) \| [^|]+\| ([^|]+)\| (.+)$/gm)]
  .map(m => ({ no: m[1], date: m[2], ctgr: m[3].trim(), name: m[4].trim() }))
  .filter(x => x.date >= from && isWeekday(x.date) && /아파트/.test(x.ctgr) && /서울/.test(x.name) && !RISKY.test(x.name) && !skip.has(x.no));
if (rows.length) out(`REGISTER onbid ${rows[0].no} ${rows[0].date}`, [rows[0].name.slice(0, 80), ...rows.slice(1, 3).map(x => `대안: onbid ${x.no} ${x.date}`), ...notes]);
notes.push(`온비드: ${from}~${to} 서울 아파트 후보 없음`);

out('STOP 오늘 쓸 깔끔한 서울 아파트 후보 없음', notes);
