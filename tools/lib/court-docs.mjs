// 법원경매정보(courtauction.go.kr)의 현황조사서·물건상세 엔드포인트.
// court-auction-notice-search(fetch-court.mjs가 쓰는 패키지)의 공개 API는 매각공고 목록·상세와
// 사건 단건 조회만 다루고(ENDPOINT_PATHS: notices/noticeDetail/caseDetail/propertySearch/courts),
// 현황조사서·물건상세(최선순위 설정 등)는 다루지 않는다(패키지 README: "❌ 매각물건 사진 /
// 매각물건명세서 PDF / 감정평가서 PDF — 별도 follow-up 이슈"). 그 두 엔드포인트는 실제로는
// 인증도 캡차도 없는 평범한 JSON POST라 이 파일에서 같은 방식(웜업 GET으로 쿠키 확보 → 세션당
// 호출 간 최소 지연 + jitter)으로 직접 호출한다 — court-auction-notice-search의
// CourtAuctionHttpClient와 같은 기본값(2000ms 지연, 1000ms jitter, 세션당 10회)을 그대로 따른다.
//
// ⚠ 개인정보: 현황조사서 API는 매각공고 목록·사건조회 API와 달리 점유자 실명을 마스킹 없이
// 그대로 돌려준다(intrpsNm 필드, 그리고 lesDts·gdsPossCtt 같은 서술형 텍스트에도 이름이 섞여
// 나온다). 이 파일의 매핑 함수는 그 두 필드를 절대 결과에 담지 않는다 — 구조화된 사실
// (점유관계 코드, 용도 코드, 전입일)만 뽑아 쓴다. CLAUDE.md: "사람 이름만 계속 마스킹한다."

const BASE_URL = 'https://www.courtauction.go.kr';
const WARMUP_PATH = '/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ159M00.xml&pgjId=159M00';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ENDPOINT_PATHS = {
  statusReport: '/pgj/pgj15B/selectCurstExmndc.on',
  goodsDetail: '/pgj/pgj15B/selectAuctnCsSrchRslt.on',
};

function delay(ms) { return ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve(); }
function jitter(min, jitterMs) { return Math.max(0, min) + Math.floor(Math.random() * Math.max(0, jitterMs)); }

export class CourtDocsHttpClient {
  constructor(options = {}) {
    this.minDelayMs = options.minDelayMs ?? 2000;
    this.jitterMs = options.jitterMs ?? 1000;
    this.maxCallsPerSession = options.maxCallsPerSession ?? 10;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.cookieJar = new Map();
    this.warmedUp = false;
    this.callsSoFar = 0;
    this.lastCallAt = 0;
  }

  buildHeaders(extra = {}) {
    const cookie = [...this.cookieJar].map(([k, v]) => `${k}=${v}`).join('; ');
    return {
      'User-Agent': USER_AGENT,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      Origin: BASE_URL,
      Referer: `${BASE_URL}${WARMUP_PATH}`,
      'X-Requested-With': 'XMLHttpRequest',
      ...(cookie ? { Cookie: cookie } : {}),
      ...extra,
    };
  }

  ingestSetCookie(headers) {
    const lines = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
    for (const line of lines) {
      const seg = line.split(';')[0];
      const i = seg.indexOf('=');
      if (i > 0) this.cookieJar.set(seg.slice(0, i).trim(), seg.slice(i + 1).trim());
    }
  }

  async warmup() {
    if (this.warmedUp) return;
    const res = await fetch(`${BASE_URL}${WARMUP_PATH}`, { method: 'GET', headers: this.buildHeaders(), redirect: 'manual' });
    this.ingestSetCookie(res.headers);
    this.warmedUp = true;
  }

  async postJson(endpointKey, body) {
    const path = ENDPOINT_PATHS[endpointKey];
    if (!path) throw new Error(`알 수 없는 엔드포인트: ${endpointKey}`);
    await this.warmup();
    if (this.callsSoFar >= this.maxCallsPerSession) {
      const err = new Error(`세션당 호출 한도(${this.maxCallsPerSession}회) 초과 — 새 클라이언트를 만들거나 잠시 후 다시 시도`);
      err.code = 'BUDGET_EXCEEDED';
      throw err;
    }
    if (this.lastCallAt > 0) {
      const wait = jitter(this.minDelayMs, this.jitterMs) - (Date.now() - this.lastCallAt);
      if (wait > 0) await delay(wait);
    }
    this.callsSoFar += 1;
    this.lastCallAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: this.buildHeaders({ 'Content-Type': 'application/json; charset=UTF-8' }),
        body: JSON.stringify(body || {}),
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    this.ingestSetCookie(res.headers);
    if (!res.ok) { const err = new Error(`법원경매정보 요청 실패 HTTP ${res.status} (${path})`); err.code = 'UPSTREAM_ERROR'; throw err; }
    const payload = await res.json();
    if (payload?.data?.ipcheck === false) {
      const err = new Error('법원경매정보가 이 IP를 일시 차단했다(ipcheck=false) — 약 1시간 뒤 다시 시도(자동 재시도 금지)');
      err.code = 'BLOCKED';
      throw err;
    }
    return payload;
  }
}

export async function fetchStatusReport({ client, courtCode, csNo, ordTsCnt = '' }) {
  const payload = await client.postJson('statusReport', {
    dma_srchCurstExmn: { cortOfcCd: courtCode, csNo, auctnInfOriginDvsCd: '2', ordTsCnt },
  });
  return payload.data;
}

export async function fetchGoodsDetail({ client, courtCode, csNo, itemSeq }) {
  const payload = await client.postJson('goodsDetail', {
    dma_srchGdsDtlSrch: { csNo, cortOfcCd: courtCode, dspslGdsSeq: itemSeq, pgmId: 'PGJ15AF01', srchInfo: { menuNm: '경매사건검색', sideDvsCd: '2' } },
  });
  return payload.data?.dma_result; // 실제 필드(dspslGdsDxdyInfo 등)는 data.dma_result 아래 중첩돼 있다
}

// 법원경매정보 정적 코드표(PGJ-AUCTN_POSS_RLTN_CD/AUCTN_LES_USG_CD/AUCTN_INTRPS_DVS_CD, 2026-09-28
// node tools/analysis/scan-court.mjs 조회 세션 중 pgj/scframe/lib/sccd/list.on으로 직접 확인).
// 정부 코드표라 자주 안 바뀐다 — 매 호출마다 다시 조회하지 않고 여기 하드코딩해서 호출 수를 아낀다.
export const POSS_RLTN_LABEL = {
  '01': '채무자 점유', '02': '임차인 점유', '03': '제3자 점유', '04': '채무자,임차인,제3자 점유',
  '05': '채무자와 임차인 점유', '06': '임차인과 제3자 점유', '07': '채무자와 제3자 점유',
  '08': '해당없음', '09': '미상', '10': '기타 점유', '11': '채무자,임차인,기타 점유',
  '12': '채무자와 기타 점유', '13': '임차인과 기타 점유',
};
export const LES_USG_LABEL = { '00': '조사된 내용없음', '01': '주거', '02': '점포', '03': '주거및점포', '04': '공장', '09': '기타' };
const LES_USG_TO_USE = { '01': '주거', '02': '상가', '04': '상가' }; // 03(주거및점포)·00·09는 애매해 review로 남김

function parseDotDate(raw) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})\.?$/.exec((raw ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// 현황조사서 원본(fetchStatusReport 결과)에서 tenants[]/special[] 후보를 만든다.
// intrpsNm(점유자 실명)과 lesDts·gdsPossCtt(이름이 섞인 서술형 텍스트)는 절대 쓰지 않는다.
// 보증금·차임·확정일자는 현황조사서에 안 나온다(전입세대·점유 확인용 서류라서) — 항상 review.
export function buildTenantsFromStatusReport(data) {
  const tenants = [];
  const special = [];

  const possessionByObject = new Map((data?.dlt_ordTsRlet ?? []).map(r => [r.objctSeq, r]));
  for (const [, obj] of possessionByObject) {
    // 01(채무자 단독 점유)은 임차인 없음, 02(임차인 단독 점유)는 아래 tenants 루프가 이미 다룬다.
    // 그 외(제3자·혼합·미상·기타)만 별도로 검토를 남긴다 — tenants 루프로는 못 잡는 경우라서다.
    if (obj.auctnPossRltnCd === '01' || obj.auctnPossRltnCd === '02') continue;
    const label = POSS_RLTN_LABEL[obj.auctnPossRltnCd] ?? `코드 ${obj.auctnPossRltnCd}(불명)`;
    special.push({ kind: '점유관계 확인 필요', note: `법원경매정보 현황조사서 점유관계: "${label}" — 이름은 저장하지 않음. 매각물건명세서·현황조사서 원본으로 직접 확인` });
  }

  for (const row of data?.dlt_ordTsLserLtn ?? []) {
    if (row.auctnIntrpsDvsCd !== '0001562') continue; // 0001562 = 임차인(코드표 확인됨). 그 외(소유자 등)는 tenants 대상 아님
    const registered_on = parseDotDate(row.mvinDtlCtt);
    const use = LES_USG_TO_USE[row.auctnLesUsgCd] ?? null;
    if (!use) special.push({ kind: '임차인 용도 확인 필요', note: `법원경매정보 현황조사서 임차 용도 코드 "${LES_USG_LABEL[row.auctnLesUsgCd] ?? row.auctnLesUsgCd}" — 주거/상가로 자동 판단 못 함` });
    if (!registered_on) special.push({ kind: '전입일 확인 필요', note: '법원경매정보 현황조사서에서 전입일을 못 뽑음(형식이 다르거나 비어 있음) — 전입세대열람으로 확인' });

    tenants.push({
      use: use ?? '주거',
      registered_on,
      fixed_date: null, // 현황조사서는 확정일자를 다루지 않는다(rgstryCrtcpCfmtnCtt는 "확정일자 확인 여부"일 뿐 날짜가 아님)
      deposit: 0,
      monthly_rent: 0,
      dividend_claim: false,
      dividend_claim_date: null,
      occupies: true,
      lease_registered: false,
      note: '법원경매정보 현황조사서에서 점유 사실만 자동 확인(이름·보증금·확정일자는 원본 서류로 직접 확인 필요) — 매각물건명세서·등기사항전부증명서 대조 전까지 잠정',
    });
    special.push({ kind: '임차인 확인 필요', note: '현황조사서 기준 임차인 있음(이름은 자동 저장하지 않음) — 보증금·확정일자·대항력은 매각물건명세서·등기사항전부증명서로 최종 확인' });
  }

  return { tenants, special };
}

// 물건상세(fetchGoodsDetail) 결과에서 "최선순위 설정"(=말소기준권리 후보)을 사람이 rights[]와
// 대조할 수 있는 문자열로 뽑는다. compute.mjs가 계산하는 computed.base_right를 대체하지 않는다
// — rights[]를 사람이 등기사항전부증명서로 채운 뒤 compute.mjs 결과와 이 값이 일치하는지
// 눈으로 대조하라는 힌트일 뿐이라 case 파일에는 쓰지 않는다.
export function extractBaseRightHint(goodsDetailData) {
  const raw = goodsDetailData?.dspslGdsDxdyInfo?.tprtyRnkHypthcStngDts;
  if (!raw) return null;
  const m = /^(\d{4})\.(\d{2})\.(\d{2})\.\s*(.+)$/.exec(raw.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}` : raw.trim();
}

// 물건상세(fetchGoodsDetail) 결과의 csPicLst/picDvsIndvdCnt에는 법원경매정보가 등록해 둔
// 첨부 사진이 유형 코드별 개수로 잡힌다(picDvsIndvdCnt는 요약, csPicLst은 장별 상세 — 각 항목의
// picFile 필드에 base64 JPEG 원본이 통째로 들어 있다). 유형 코드(cortAuctnPicDvsCd)의 라벨
// 코드표는 못 찾음(pgj/scframe/lib/sccd/list.on을 여러 요청 형태로 시도했으나 500 — 코드만 남김).
// **원본 이미지(picFile)는 절대 반환하지 않는다** — 법원경매정보 사이트 저작권 정책("무단 복제·
// 링크 시 형사처벌", 감정평가서 PDF와 같은 경고가 사이트 전반에 적용됨)에 따라 이 저장소는
// 첨부파일의 존재·개수만 자동으로 파악하고, 원본은 사람이 사이트에서 직접 확인한다.
export function summarizeCasePhotos(goodsDetailData) {
  const byType = (goodsDetailData?.picDvsIndvdCnt ?? [])
    .map(row => ({ code: row.cortAuctnPicDvsCd, count: row.photoGubunCnt }))
    .filter(row => row.count > 0);
  const total = byType.reduce((sum, row) => sum + row.count, 0);
  return { total, byType };
}
