// 온비드(한국자산관리공사) 물건 검색 API 공용 코드. fetch-onbid.mjs·scan-onbid.mjs가 함께 쓴다.
// 온비드는 URL로 물건을 특정할 수 없다(상세 페이지가 세션 기반 POST 내비게이션) — 그래서 먼저
// 목록 페이지를 열어 실제 브라우저가 보내는 검색 요청 본문(seedBody)을 가로챈 뒤, 그 본문의
// 검색 조건만 바꿔 재요청하는 방식으로 조회한다.
import { chromium } from 'playwright';

export const LIST_URL = 'https://www.onbid.co.kr/op/cltrpbancinf/clbtcltrclg/cltrclbtcltrclg/CltrClbtCltrClgController/mvmnCltrRlstClg.do';
export const SEARCH_PATH = '/op/cltrpbancinf/clbtcltrclg/cltrclbtcltrclg/CltrClbtCltrClgController/inqCltrClbtRlstClg.do';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// 온비드 물건명(onbidCltrNm)은 "시도 시군구 읍면동 지번 건물명 [동/층/호] (도로명)" 형식의 전체 주소다.
// 법원경매정보·온비드가 법률상 공개하는 정보이고 기존 경매정보 서비스도 동일하게 전체 주소를 쓰므로
// 그대로 쓴다 — "외 N건"(여러 필지 묶음 표시)만 정리해서 뺀다.
export function fullAddress(onbidCltrNm = '') {
  return (onbidCltrNm || '').replace(/\s*외\s*\d+\s*건\s*$/, '').trim();
}

// 물건종류(ctgrFullNm) → 이 저장소의 분류 slug(data/categories.json). 확실하지 않으면 사람이 정하도록 null.
export function guessCategory(ctgrFullNm = '') {
  if (/아파트/.test(ctgrFullNm)) return 'apartment';
  if (/다세대|연립|빌라/.test(ctgrFullNm)) return 'villa';
  if (/근린생활|상가|업무|점포/.test(ctgrFullNm)) return 'commercial';
  if (/토지|답|전|임야|대지|과수원|잡종지/.test(ctgrFullNm)) return 'land';
  if (/자동차|차량/.test(ctgrFullNm)) return 'car';
  return null;
}

// 온비드 물건 검색 API를 한 번 호출한다. paramOverrides로 검색 조건(searchCltrMnmtNoYn·
// srchCltrMnmtNo·pageIndex·pageUnit·srchCltrType 등)을 덮어쓴다. 실패하면 던진다.
// 온비드 목록 페이지가 가끔 20초 안에 조용해지지 않아(2026-10-16 배치: srchCltrType=0003 Timeout) 한 유형이 통째로 빠졌다 —
// 시간 초과만 한 번 더, 더 길게 기다려 다시 시도한다. 다른 오류(페이지 구조 변경 등)는 바로 던진다.
export async function searchOnbid(paramOverrides = {}, { retries = 1, timeoutMs = 20000 } = {}) {
  for (let i = 0; ; i++) {
    try { return await searchOnbidOnce(paramOverrides, timeoutMs * (i + 1)); }
    catch (e) {
      if (i >= retries || !/Timeout/i.test(e.message)) throw e;
      console.error(`  온비드 조회 시간 초과 — ${timeoutMs * (i + 2) / 1000}초로 다시 시도`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function searchOnbidOnce(paramOverrides, timeoutMs) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    let seedBody = null;
    page.on('request', req => { if (req.url().includes('inqCltrClbtRlstClg.do') && !seedBody) seedBody = req.postData(); });
    await page.goto(LIST_URL, { waitUntil: 'networkidle', timeout: timeoutMs });
    await page.waitForTimeout(1200);
    if (!seedBody) throw new Error('목록 검색 요청을 가로채지 못함 — 온비드 페이지 구조가 바뀌었을 수 있음. Playwright로 직접 확인 필요');

    const params = new URLSearchParams(seedBody);
    for (const [k, v] of Object.entries(paramOverrides)) params.set(k, v);

    const raw = await page.evaluate(async ({ path, body }) => {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body,
        credentials: 'include',
      });
      return res.text();
    }, { path: SEARCH_PATH, body: params.toString() });

    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('응답 파싱 실패 — 온비드 API 응답 형식이 바뀌었을 수 있음'); }
    return data;
  } finally {
    await browser.close();
  }
}

// 온비드 물건 상세 페이지는 압류재산·부동산이면 "등기사항증명서 주요정보"·"임대차 정보"·
// "점유관계"·"배분요구 및 채권신고현황" 표를 로그인 없이 그대로 보여준다(입찰자 스스로 권리분석
// 해보라고 온비드가 공개하는 요약 — 등기사항전부증명서 원본은 아니다). 감정평가서 같은 첨부파일은
// 보안 뷰어로만 열리게 막혀 있어(다운로드 불가) 그건 건드리지 않는다 — 표로 공개된 것만 읽는다.
// searchOnbid()가 돌려준 목록 항목(it)을 그대로 받아 상세 페이지로 들어간다.
export async function fetchOnbidRightsAnalysis(it) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(LIST_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(800);
    await page.evaluate(({ a, b, c, d, e, f }) => {
      // eslint-disable-next-line no-undef -- 온비드 페이지가 전역에 정의해 둔 함수
      fn_goCltrDetail(a, b, c, d, e, f);
    }, {
      a: it.cltrScrnGrpCd, b: it.cltrPrptDivCd, c: it.onbidCltrno,
      d: it.onbidPbancNo, e: it.pbctNo, f: it.pbctCdtnNo,
    });
    await page.waitForURL('**/CltrDtlController/**', { timeout: 20000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500); // 등기사항·임대차·점유관계·배분요구 4개 AJAX가 순서대로 채워질 시간

    const readTable = (sel) => page.$eval(sel, el => {
      const table = el.querySelector('table');
      if (!table) return null; // 아직 공개 전(점유관계·배분요구는 입찰시작 7일 전부터 공개)이거나 해당 없음
      const headers = [...table.querySelectorAll('thead th .txt01')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
      return [...table.querySelectorAll('tbody tr')].map(tr => {
        const cells = [...tr.querySelectorAll('td .txt01')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
        const row = {};
        headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
        return row;
      });
    }).catch(() => null);

    const [rightsRows, leaseRows, occupancyRows, bondRows] = await Promise.all([
      readTable('#rgstMtrsCrtiClgDiv'), readTable('#leasInfClgDiv'),
      readTable('#ocpyRelClgDiv'), readTable('#bondDclrPscdClgDiv'),
    ]);
    return { rightsRows: rightsRows ?? [], leaseRows: leaseRows ?? [], occupancyRows: occupancyRows ?? [], bondRows: bondRows ?? [] };
  } finally {
    await browser.close();
  }
}

// 등기 종류(온비드 표 "권리종류")를 이 저장소 rights[].kind 값으로. 온비드는 등기부 문구를
// 그대로 옮기지만 "위임기관"처럼 등기 종류가 아니라 압류를 신청한 쪽을 가리키는 값도 섞여 나온다
// (실제 사례로 확인됨 — 대부분 압류). 모르는 값은 지어내지 않고 원문을 그대로 kind에 넣은 뒤
// special[]로 검토를 남긴다.
const KNOWN_RIGHTS_KINDS = new Set([
  '근저당권', '저당권', '압류', '가압류', '담보가등기', '경매개시결정', '가처분',
  '소유권이전청구권가등기', '지상권', '지역권', '환매특약', '임차권등기', '전세권',
  '가등기', '소유권이전', '소유권보존',
]);

function parseAmount(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/,/g, '').trim();
  if (!cleaned || /미표시|비공개/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw) {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw ?? '') ? raw : null;
}

// 마스킹된 권리자명(예: "박**"=1글자+별 2개, "케*****"=1글자+별 5개, "국************"=매우 긴 마스킹)의
// 패턴만으로 개인/법인/기관을 추정한다 — 이름 자체는 절대 복원하지 않고, 결과에도 "(추정)"을 붙여
// 확정된 사실이 아님을 남긴다. holder_type은 계산에 쓰이지 않는 참고용 필드라 추정이어도 위험이 낮다.
function guessHolderType(name = '') {
  const stars = (name.match(/\*/g) || []).length;
  if (/^국/.test(name) && stars >= 6) return '국가기관(추정)';
  if (stars >= 4) return '법인(추정)';
  return '개인(추정)';
}

function mapRightsRow(row) {
  const rawKind = row['권리종류'] ?? '';
  const name = row['권리자명'] ?? '';
  const date = row['설정일자'] ?? '';
  const amount = parseAmount(row['설정금액']);
  let kind = rawKind;
  let needsReview = null;
  if (KNOWN_RIGHTS_KINDS.has(rawKind)) {
    kind = rawKind;
  } else if (rawKind === '위임기관') {
    kind = '압류'; // 실제 사례에서 "위임기관"으로 표시된 행은 전부 압류였다 — 그래도 추정이라 검토를 남긴다
    needsReview = `rights(${date})가 온비드 표에서 "권리종류: 위임기관"으로 표시됨 — 압류로 추정 기재. 등기사항증명서 원문 확인 시 정정`;
  } else {
    needsReview = `rights(${date})의 온비드 권리종류("${rawKind}")를 이 저장소의 등기 종류로 자동 매핑하지 못함 — 등기사항증명서로 확인 필요`;
  }
  const holder_type = rawKind === '위임기관' ? '기관(추정)' : guessHolderType(name);
  const note = needsReview
    ? `온비드 표 권리종류 원문: "${rawKind}" — 사람 확인 필요`
    : `온비드 공개 요약 기준, 권리자명 마스킹(${name})`;
  return { entry: { date, receipt_no: null, kind, amount, holder_type, note }, needsReview };
}

// 점유관계·임대차 정보·배분요구현황 세 표를 이름으로 이어붙여 tenants[]를 만든다. 세 표가 서로
// 다른 항목만 채워 줄 때가 있어(예: 점유관계엔 확정일이 "미상"인데 임대차 정보엔 있음) 있는 값을
// 우선순위대로 합친다. 배분요구 정보 자체가 아직 없으면(입찰시작 7일 전 이전) 지어내지 않고
// special[]로 재조회 필요를 남긴다.
function mapTenants({ occupancyRows, leaseRows, bondRows, category }) {
  const tenants = [];
  const special = [];
  const use = category === 'commercial' ? '상가' : '주거';
  for (const occ of occupancyRows) {
    const relation = occ['점유관계'] ?? '';
    const name = occ['성명'] ?? '';
    if (relation !== '임차인') {
      special.push({ kind: '점유관계 확인 필요', note: `온비드 점유관계 표: "${relation}"(${name}) — 임차인이 아니면 tenants[]로 넣지 않는다. 현황조사서로 성격 확인` });
      continue;
    }
    const lease = leaseRows.find(r => r['성명'] === name);
    const bond = bondRows.find(r => r['권리종류'] === '임차인' && r['권리자명'] === name);

    const registered_on = parseDate(occ['전입일(사업자등록신청일)']) ?? parseDate(lease?.['전입일']);
    const fixed_date = parseDate(occ['확정일']) ?? parseDate(lease?.['확정(설정)일']);
    const deposit = parseAmount(occ['보증금']) ?? parseAmount(lease?.['보증금(원)']) ?? 0;
    const monthly_rent = parseAmount(occ['차임']) ?? parseAmount(lease?.['차임(월세)(원)']) ?? 0;

    let dividend_claim = false;
    let dividend_claim_date = null;
    let dividendNote;
    if (!bond) {
      dividendNote = '배분요구 정보가 아직 공개 전(입찰시작 7일 전부터 공개) — 매각기일이 가까워지면 다시 조회해서 확인';
      special.push({ kind: '배당요구 확인 필요', note: `임차인(${name}) 배분요구 여부가 아직 공개 전 — 재조회 필요` });
    } else if (bond['배분요구일'] && bond['배분요구일'] !== '배분요구없음') {
      dividend_claim = true;
      dividend_claim_date = parseDate(bond['배분요구일']);
      dividendNote = `온비드 "배분요구 및 채권신고현황"에서 확인 — 배분요구채권액 ${(parseAmount(bond['배분요구채권액']) ?? 0).toLocaleString('ko-KR')}원`;
    } else {
      dividendNote = '온비드 "배분요구 및 채권신고현황"에 배분요구없음으로 표시됨';
    }
    if (!registered_on) {
      special.push({ kind: '전입일 확인 필요', note: `임차인(${name}) 전입일을 온비드 표에서 확인 못함 — 현황조사서로 확인` });
    }

    tenants.push({
      use, registered_on, fixed_date, deposit, monthly_rent,
      dividend_claim, dividend_claim_date, occupies: true, lease_registered: false,
      note: `온비드 물건 상세 페이지 "점유관계"·"임대차 정보"·"배분요구 및 채권신고현황"에서 자동 확인. ${dividendNote}`,
    });
  }
  return { tenants, special };
}

// fetchOnbidRightsAnalysis()가 읽어온 네 표를 이 저장소의 rights[]/tenants[]/special[] 스키마로
// 변환한다. land는 tenants를 채우지 않는 저장소 규칙(SKILL.md)에 맞춰 점유 현황을 special[]로만
// 남긴다. 이 결과는 여전히 "온비드가 옮겨 적은 요약"일 뿐이라 사람이 등기사항증명서 원본과
// 최종 대조하는 걸 대신하지 않는다 — 애매한 항목마다 special[]에 검토 항목을 남기는 이유다.
export function buildOnbidRightsAndTenants({ rightsRows, leaseRows, occupancyRows, bondRows }, category) {
  const rights = [];
  const special = [];
  for (const row of rightsRows ?? []) {
    const { entry, needsReview } = mapRightsRow(row);
    rights.push(entry);
    if (needsReview) special.push({ kind: '등기 종류 불명', note: needsReview });
  }

  let tenants = [];
  if (category === 'land') {
    for (const occ of occupancyRows ?? []) {
      special.push({ kind: '점유 현황(토지)', note: `온비드 점유관계 표: ${occ['점유관계'] ?? '?'} ${occ['성명'] ?? ''} — 토지는 임차인을 tenants[]에 넣지 않는다. 현장 확인 필요` });
    }
  } else if (['apartment', 'villa', 'commercial'].includes(category)) {
    const r = mapTenants({ occupancyRows: occupancyRows ?? [], leaseRows: leaseRows ?? [], bondRows: bondRows ?? [], category });
    tenants = r.tenants;
    special.push(...r.special);
  }
  return { rights, tenants, special };
}

// 온비드 "물건입찰결과" 검색. 목록 검색(searchOnbid)과 같은 방식 — 결과 페이지를 열어 브라우저가 보내는
// 검색 본문을 가로챈 뒤 조건만 바꿔 재요청한다. 로그인 없이 공개되는 화면이다.
// 자동차는 srchCltrType=0002, 차종은 srchVhcMdlNm, 기간은 srchOpbdBgdd~srchOpbdEndd(종료일은 과거만).
// 응답 항목: scrnIndctCltrMngNo(물건관리번호), pbctStatCd(0010 낙찰·0011 유찰·0012 취소), pbctExctDt(개찰일시),
// cltrApslEvlAvgAmt(감정가), lowstBidPrc(최저가), onbidBidAmt(낙찰가 "13,550,000"), totalBid(응찰 수),
// nrtpNm(연식), drvDstcNm(주행거리 "174,366km"), fuelContDsvlmNm(연료·배기량), onbidCltrNm(물건명)
export const BID_RESULT_URL = 'https://www.onbid.co.kr/op/cltrpbancinf/bidrsltmng/cltrbidrslt/CltrBidRsltController/mvmnCltrBidRsltClg.do';
const BID_RESULT_PATH = '/op/cltrpbancinf/bidrsltmng/cltrbidrslt/CltrBidRsltController/cltrBidRsltClg.do';

export async function searchOnbidBidResults(paramOverrides = {}) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    let seedBody = null;
    page.on('request', req => { if (req.url().includes('cltrBidRsltClg.do') && !seedBody) seedBody = req.postData(); });
    await page.goto(BID_RESULT_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1200);
    if (!seedBody) throw new Error('입찰결과 검색 요청을 가로채지 못함 — 온비드 페이지 구조가 바뀌었을 수 있음');

    const params = new URLSearchParams(seedBody);
    for (const [k, v] of Object.entries(paramOverrides)) params.set(k, v);
    const raw = await page.evaluate(async ({ path, body }) => {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body,
        credentials: 'include',
      });
      return res.text();
    }, { path: BID_RESULT_PATH, body: params.toString() });

    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('입찰결과 응답 파싱 실패 — 온비드 응답 형식이 바뀌었을 수 있음'); }
    return data.cltrBidRsltClgInfVOList ?? [];
  } finally {
    await browser.close();
  }
}

// 입찰결과 목록에서 이 사건의 결과를 사건 데이터의 result 모양으로 만든다.
//   - outcome·winning_bid·bidders: 분석한 회차(sale.sale_date) 결과
//   - later: 그 뒤 회차들 [{ date, minimum, outcome, winning_bid, bidders }] — 첫 회차가 유찰되고 다음 회차에 팔린 경우를 보여 주려고
// 분석한 회차 결과가 아직 공개되지 않았으면 null.
export function onbidResultFor(c, rows, today) {
  const num = s => Number(String(s ?? '').replace(/[^\d]/g, '')) || null;
  const own = rows
    .filter(r => r.scrnIndctCltrMngNo === c.case.number && ['0010', '0011'].includes(r.pbctStatCd))
    .sort((a, b) => a.pbctExctDt.localeCompare(b.pbctExctDt));
  const pick = r => {
    const sold = r.pbctStatCd === '0010';
    return { date: r.pbctExctDt.slice(0, 10), minimum: num(r.lowstBidPrc), outcome: sold ? '매각' : '유찰', winning_bid: sold ? num(r.onbidBidAmt) : null, bidders: num(r.totalBid) };
  };
  const main = own.find(r => r.pbctExctDt.slice(0, 10) === c.sale.sale_date);
  if (!main) return null;
  const m = pick(main);
  const later = own.filter(r => r.pbctExctDt.slice(0, 10) > c.sale.sale_date).map(pick);
  return { outcome: m.outcome, winning_bid: m.winning_bid, bidders: m.bidders, ...(later.length ? { later } : {}), checked_at: today };
}
