// 경매 물건 권리분석 계산 엔진 (순수 함수, 부수효과 없음).
//
// AI가 가장 틀리기 쉬운 "순서 비교로 결론이 정해지는" 판정만 코드로 한다.
//   - 말소기준권리: (근)저당권·압류·가압류·담보가등기·경매개시결정 중 접수가 가장 빠른 것,
//     또는 건물 전부 전세권자가 배당요구(경매신청)한 전세권
//   - 등기 권리: 말소기준권리보다 앞서면 원칙적으로 인수, 뒤면 소멸 (민사집행법 제91조)
//   - 임차인 대항력: 인도 + 전입신고(상가는 사업자등록 신청) 다음 날 0시에 생김
//     (주택임대차보호법 제3조, 상가건물임대차보호법 제3조) → 전입일이 말소기준권리 접수일보다
//     "하루라도 앞서야" 대항력이 있다. 같은 날이면 없다.
// 배당표 계산(누가 얼마를 배당받는지)은 하지 않는다. 대신 매수인이 떠안을 수 있는 금액을
// 최소~최대 범위로 낸다. 코드로 판정할 수 없는 것(유치권, 법정지상권, 순서가 불명확한 권리 등)은
// review에 남겨 사람이 확인하게 한다.
import crypto from 'node:crypto';
import { CATEGORIES, categoryBySlug } from '../lib/categories.mjs';

export const ENGINE_VERSION = 2;

export const BASE_KINDS = ['근저당권', '저당권', '압류', '가압류', '담보가등기', '경매개시결정'];
// 말소기준권리보다 앞서면 매수인이 인수하는 권리 (뒤면 소멸)
export const SURVIVE_IF_PRIOR = ['가처분', '소유권이전청구권가등기', '지상권', '지역권', '환매특약', '임차권등기', '전세권'];
// 부담이 아닌 등기(소유권 이전 기록 등) — 판정 대상에서 뺀다
export const IGNORE_KINDS = ['소유권보존', '소유권이전'];
// 권리 이름만으로 성격을 알 수 없어 사람이 확인해야 하는 것
export const AMBIGUOUS_KINDS = { 가등기: '담보가등기인지 소유권이전청구권가등기인지 등기 원인으로 확인해야 함' };
export const RIGHT_KINDS = [...BASE_KINDS, ...SURVIVE_IF_PRIOR, ...IGNORE_KINDS, ...Object.keys(AMBIGUOUS_KINDS)];

// 개인을 특정할 수 있는 필드는 데이터에 넣지 않는다 (저장소가 공개 상태)
const FORBIDDEN_KEYS = ['name', 'names', 'owner', 'owner_name', 'holder', 'holder_name', 'debtor', 'creditor', 'tenant_name', 'phone', 'ssn', 'address_detail', 'unit', 'ho', 'lot'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── 검증 ─────────────────────────────────────────────────────────────
export function validateCase(c) {
  const errors = [];
  const err = (ok, msg) => { if (!ok) errors.push(msg); };
  const isDate = v => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
  const isMoney = v => Number.isInteger(v) && v >= 0;

  err(typeof c.id === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id), 'id는 영문 소문자·숫자·하이픈 (예: seoul-central-2026ta12345)');
  // source.type: 법원경매(court, 기본값)와 캠코 온비드 공매(onbid)는 사건번호 형식과 계산 가능 범위가 다르다.
  const sourceType = c.source?.type ?? 'court';
  err(['court', 'onbid'].includes(sourceType), 'source.type은 "court"(법원경매) 또는 "onbid"(온비드 공매)');
  const num = c.case?.number;
  if (sourceType === 'onbid') {
    err(typeof num === 'string' && /^\d{4}-\d+-\d+$/.test(num), 'case.number(온비드 물건관리번호)는 "2022-0200-007090" 형식(자릿수는 물건 유형마다 다를 수 있음)');
    if (typeof num === 'string' && typeof c.id === 'string') {
      const token = num.replace(/-/g, '');
      err(new RegExp(`(^|-)onbid-${token}(-\\d+)?$`).test(c.id), `id는 "onbid-${token}"을 포함해야 함 (물건번호가 있으면 끝에 -N)`);
    }
  } else {
    err(typeof num === 'string' && /^\d{4}타경\d+$/.test(num), 'case.number는 "2026타경12345" 형식');
    if (typeof num === 'string' && typeof c.id === 'string') {
      const token = num.replace('타경', 'ta');
      err(new RegExp(`(^|-)${token}(-\\d+)?$`).test(c.id), `id에 사건번호 토큰 "${token}"이 들어가야 함 (물건번호가 있으면 끝에 -N)`);
    }
  }
  // 온비드 재산유형: "압류재산"(국세징수법 92조 — 말소기준권리와 같은 구조)과
  // "신탁공매"(신탁법 4조·22조 — 신탁등기일이 기준, 등기 권리 소멸/인수는 판정 안 함)만 지원한다.
  // 그 외(국유재산·기타일반재산 중 신탁 아닌 것 등)는 법적 근거를 아직 확인 못 해서 계산하지 않는다.
  const ONBID_TYPES = ['압류재산', '신탁공매'];
  if (sourceType === 'onbid') {
    err(ONBID_TYPES.includes(c.case?.onbid_property_type), `온비드 사건은 지금 ${ONBID_TYPES.join(' 또는 ')}만 지원한다. 그 외 재산유형은 말소기준권리·인수 개념의 법적 근거를 아직 확인 못 해 계산하지 않는다`);
    if (c.case?.onbid_property_type === '신탁공매') {
      err(isDate(c.case?.trust_registered_on), '신탁공매는 case.trust_registered_on(신탁등기 접수일, 등기사항전부증명서에서 확인)이 YYYY-MM-DD로 있어야 한다 — 신탁법 제4조상 이 날짜가 제3자 대항력의 기준');
    }
  }
  for (const k of ['court', 'region']) err(typeof c.case?.[k] === 'string' && c.case[k].trim(), `case.${k} 필요`);
  const cat = categoryBySlug(c.case?.category);
  err(cat, `case.category는 ${CATEGORIES.map(x => x.slug).join(' / ')} 중 하나 (data/categories.json)`);
  if (cat?.engine === 'car') err(false, `${cat.name}는 계산 엔진이 아직 없음 — 첫 ${cat.name} 사건을 등록할 때 입력 항목과 규칙을 함께 만든다`);
  if (cat?.slug === 'land') err(!(c.tenants ?? []).length, 'land(토지)의 tenants는 비워 둔다 — 토지 임차인은 대항력 규칙(농지법 등)이 달라 코드가 판정하지 않는다. special에 기록');
  // case.region은 전체 주소(동·호수·지번 포함) 허용 — 이미 법원경매정보·온비드가 법률상 공개하는 정보이고
  // 탱크옥션·마당 같은 기존 경매정보 서비스도 동일하게 전체 주소를 보여준다. 사람 이름·주민번호·전화번호는
  // FORBIDDEN_KEYS와 아래 주민번호/전화번호 패턴 검사로 계속 막는다 — 개인 식별은 이름 쪽에서 막는다.
  err(isMoney(c.sale?.appraisal) && c.sale.appraisal > 0, 'sale.appraisal(감정가)은 0보다 큰 원 단위 정수');
  err(isMoney(c.sale?.minimum) && c.sale.minimum > 0, 'sale.minimum(최저매각가격)은 0보다 큰 원 단위 정수');
  err(isDate(c.sale?.sale_date), 'sale.sale_date(매각기일)는 YYYY-MM-DD');
  if (isDate(c.sale?.sale_date)) {
    const wd = new Date(`${c.sale.sale_date}T00:00:00Z`).getUTCDay();
    err(wd !== 0 && wd !== 6, `sale.sale_date(${c.sale.sale_date})가 주말 — 매각기일은 평일이다(일정 달력이 평일만 그린다). 날짜 오타 확인`);
  }
  if (c.sale?.dividend_deadline != null) err(isDate(c.sale.dividend_deadline), 'sale.dividend_deadline(배당요구종기)은 YYYY-MM-DD');
  if (c.sale?.deposit_rate != null) err(typeof c.sale.deposit_rate === 'number' && c.sale.deposit_rate > 0 && c.sale.deposit_rate < 1, 'sale.deposit_rate는 0~1 사이 비율 (예: 0.1)');

  err(Array.isArray(c.rights) && c.rights.length > 0, 'rights(등기 권리)가 비어 있음 — 등기사항전부증명서 갑구·을구를 입력');
  (c.rights ?? []).forEach((r, i) => {
    err(isDate(r.date), `rights[${i}].date(접수일)는 YYYY-MM-DD`);
    err(RIGHT_KINDS.includes(r.kind), `rights[${i}].kind "${r.kind}"는 허용 목록에 없음: ${RIGHT_KINDS.join(', ')}`);
    if (r.receipt_no != null) err(Number.isInteger(r.receipt_no), `rights[${i}].receipt_no(접수번호)는 정수`);
    if (r.amount != null) err(isMoney(r.amount), `rights[${i}].amount는 원 단위 정수`);
  });
  err(Array.isArray(c.tenants), 'tenants는 배열 (임차인이 없으면 [])');
  (c.tenants ?? []).forEach((t, i) => {
    err(['주거', '상가'].includes(t.use), `tenants[${i}].use는 "주거" 또는 "상가"`);
    if (t.registered_on != null) err(isDate(t.registered_on), `tenants[${i}].registered_on(전입일·사업자등록 신청일)은 YYYY-MM-DD`);
    if (t.fixed_date != null) err(isDate(t.fixed_date), `tenants[${i}].fixed_date(확정일자)는 YYYY-MM-DD`);
    if (t.dividend_claim_date != null) err(isDate(t.dividend_claim_date), `tenants[${i}].dividend_claim_date는 YYYY-MM-DD`);
    if (t.deposit != null) err(isMoney(t.deposit), `tenants[${i}].deposit(보증금)은 원 단위 정수`);
    err(typeof t.dividend_claim === 'boolean', `tenants[${i}].dividend_claim(배당요구 여부)은 true/false`);
    err(typeof t.occupies === 'boolean', `tenants[${i}].occupies(현재 점유 여부)는 true/false`);
  });
  if (c.special != null) err(Array.isArray(c.special), 'special은 배열');

  const walk = (v, p) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`));
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        err(!FORBIDDEN_KEYS.includes(k), `${p}.${k}: 개인정보 필드 금지 (저장소가 공개 상태). 권리자는 holder_type(은행·개인 등)만`);
        walk(x, `${p}.${k}`);
      }
      return;
    }
    if (typeof v === 'string') {
      err(!/\d{6}-?[1-4]\d{6}/.test(v), `${p}: 주민등록번호로 보이는 값`);
      err(!/01[016789]-?\d{3,4}-?\d{4}/.test(v), `${p}: 전화번호로 보이는 값`);
    }
  };
  walk(c, 'case');
  return errors;
}

// ── 입력 해시: computed가 현재 입력으로 계산된 것인지 확인 ─────────────────────
const stable = v => Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  : JSON.stringify(v);
export function inputHash(c) {
  // market은 시세갭·확인 지표 점수 계산에 쓰이므로 해시에 포함한다(바뀌면 재계산 필요).
  // result(매각 결과)는 어떤 계산에도 쓰이지 않아 계속 뺀다.
  const { case: cs, sale, rights, tenants, special, spec_sheet, market } = c;
  return crypto.createHash('sha256').update(stable({ cs, sale, rights, tenants, special, spec_sheet, market, v: ENGINE_VERSION })).digest('hex').slice(0, 16);
}

// ── 계산 ─────────────────────────────────────────────────────────────
// 같은 날짜면 접수번호로 순서를 가린다. 접수번호가 없으면 순서 불명(null).
function order(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.receipt_no != null && b.receipt_no != null) return Math.sign(a.receipt_no - b.receipt_no);
  return null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const krw = n => n.toLocaleString('ko-KR');

// 시세갭: market.trades(사람이 입력한 실거래 사례)가 있을 때만 계산한다.
// "시세차익"처럼 판단이 섞인 말을 쓰지 않고, 최저가(+인수 부담)와 시세 평균의 차이라는 사실만 낸다.
function computePriceGap(c, minimum, assumedMin, assumedMax) {
  const trades = c.market?.trades ?? [];
  if (!trades.length) return null;
  const marketAvg = Math.round(trades.reduce((s, t) => s + t.price, 0) / trades.length);
  // gap_min: 인수 부담이 최대일 때(보수적으로) 남는 차이 / gap_max: 인수 부담이 최소일 때 남는 차이
  const gapMin = assumedMax == null ? null : marketAvg - (minimum + assumedMax);
  const gapMax = assumedMin == null ? null : marketAvg - (minimum + assumedMin);
  return { market_avg: marketAvg, trade_count: trades.length, gap_min: gapMin, gap_max: gapMax };
}

// 확인 지표 점수: 지금 사건 데이터로 계산할 수 있는 객관 지표만, 각각 0~5점으로 정규화한다.
// "입찰하세요/말아야 합니다" 같은 결론이 아니라 "이 지표는 이래서 몇 점"이라는 사실 나열이다 —
// 최종 해설(왜 이 점수인지, 무엇을 더 볼지)은 글쓰는 AI가 값만 보고 쓴다.
function computeScore(c, { minimum, minimumRatio, failedRounds, ownershipRisk, assumedTotalMax, tenantResults, specialCount, reviewCount, priceGap }) {
  const items = [];

  items.push((() => {
    const stars = clamp(Math.round((100 - minimumRatio) / 20), 0, 5);
    return { key: 'price', label: '가격 수준', value: `감정가의 ${minimumRatio}%${failedRounds ? ` (유찰 ${failedRounds}회)` : ''}`, stars, note: '최저매각가격이 감정가 대비 낮을수록 별점이 높다' };
  })());

  items.push((() => {
    if (ownershipRisk) return { key: 'rights_risk', label: '권리 인수 위험', value: '소유권 상실 위험 권리 있음', stars: 0, note: '선순위 가처분·가등기 등으로 소유권을 잃을 수 있는 권리가 있다' };
    if (assumedTotalMax == null) return { key: 'rights_risk', label: '권리 인수 위험', value: '확인 필요', stars: null, note: '인수 금액을 알 수 없는 등기 권리가 있어 계산할 수 없다' };
    const ratio = minimum > 0 ? assumedTotalMax / minimum : 0;
    const stars = clamp(Math.round(5 * (1 - Math.min(ratio, 1))), 0, 5);
    return { key: 'rights_risk', label: '권리 인수 위험', value: `인수 예상 최대 ${krw(assumedTotalMax)}원(최저가의 ${Math.round(ratio * 100)}%)`, stars, note: '매수인이 추가로 떠안을 수 있는 금액이 최저가 대비 적을수록 별점이 높다' };
  })());

  items.push((() => {
    if (tenantResults.some(t => t.opposable == null)) return { key: 'tenant_risk', label: '임차인 위험', value: '확인 필요', stars: null, note: '대항력을 판정할 수 없는 임차인이 있다' };
    const risky = tenantResults.filter(t => t.opposable === true && (t.assumed_max == null || t.assumed_max > 0));
    const stars = clamp(5 - risky.length * 2, 0, 5);
    return { key: 'tenant_risk', label: '임차인 위험', value: `인수 부담 남는 대항력 임차인 ${risky.length}명`, stars, note: '대항력 있고 배당으로 보증금을 다 받지 못하는 임차인이 적을수록 별점이 높다' };
  })());

  items.push((() => {
    const n = specialCount + reviewCount;
    const stars = clamp(5 - Math.ceil(n / 2), 0, 5);
    return { key: 'review_load', label: '확인 필요 사항', value: `특수 사항 ${specialCount}건, 계산 도구 확인 요청 ${reviewCount}건`, stars, note: '코드가 판정하지 못해 사람이 서류·현장으로 확인해야 하는 항목이 적을수록 별점이 높다' };
  })());

  if (priceGap) {
    items.push((() => {
      const gap = priceGap.gap_min;
      const gapRatio = gap == null || priceGap.market_avg === 0 ? null : gap / priceGap.market_avg;
      const stars = gapRatio == null ? null : clamp(Math.round(5 * clamp(gapRatio / 0.3, 0, 1)), 0, 5);
      return { key: 'price_gap', label: '시세 대비 가격갭', value: `시세 평균 ${krw(priceGap.market_avg)}원, 실거래 ${priceGap.trade_count}건 기준`, stars, note: '최저가에 인수 부담(최대 기준)을 더한 금액이 시세 평균보다 많이 낮을수록 별점이 높다' };
    })());
  }

  const rated = items.filter(x => x.stars != null);
  const totalStars = rated.length ? Math.round((rated.reduce((s, x) => s + x.stars, 0) / rated.length) * 2) / 2 : null;
  return { items, total_stars: totalStars, rated_count: rated.length, has_price_gap: !!priceGap };
}

// 신탁공매 전용 계산. 신탁법 제4조(신탁의 공시와 대항)·제22조(강제집행 등의 금지)에 따라
// court 경매의 "말소기준권리" 개념이 그대로 적용되지 않는다 — 등기 권리의 소멸/인수는
// 신탁 전 설정된 권리인지, 수탁자가 승계·동의했는지에 달려 있고 이건 등기부·신탁원부·계약서를
// 사람이 직접 봐야 확정되는 사실이라 코드가 판정하지 않고 전부 review로 남긴다.
// 코드가 객관적으로 계산하는 건 하나뿐이다: 임차인의 전입(또는 임대차 시작)일이
// case.trust_registered_on(신탁등기 접수일)보다 앞인지 뒤인지 — 그 앞뒤가 대항력 판단의
// 출발점이라서다(뒤라도 수탁자 동의가 있으면 대항력이 있을 수 있어 review로 남긴다).
function computeTrustCase(c, now) {
  const review = [];
  const trustDate = c.case.trust_registered_on;

  const rightResults = c.rights.map((r, index) => {
    const out = { index, date: r.date, kind: r.kind, amount: r.amount ?? null };
    if (IGNORE_KINDS.includes(r.kind)) return { ...out, effect: '해당 없음', reason: '부담이 아닌 소유권 기록' };
    return { ...out, effect: '검토', reason: '신탁공매는 등기 권리의 소멸/인수 판정 기준이 court 경매와 달라 코드가 정하지 않음' };
  });
  if (c.rights.some(r => !IGNORE_KINDS.includes(r.kind))) {
    review.push('등기 권리 인수/소멸: 신탁 전 설정된 권리인지, 수탁자가 승계했는지를 등기사항전부증명서·신탁원부로 직접 확인해야 한다(신탁공매는 말소기준권리 개념이 적용되지 않음)');
  }

  const tenantResults = c.tenants.map((t, index) => {
    const deposit = t.deposit ?? null;
    const out = { index, use: t.use, registered_on: t.registered_on ?? null, deposit };
    if (!t.registered_on) {
      review.push(`tenants[${index}] 전입일(또는 임대차 시작일) 미상 — 신탁등기일(${trustDate})과 비교할 수 없음`);
      return { ...out, opposable: null, effect: '검토', assumed_min: 0, assumed_max: deposit, reason: '전입일 미상' };
    }
    const priorToTrust = t.registered_on < trustDate;
    if (priorToTrust) {
      review.push(`tenants[${index}] 전입일(${t.registered_on})이 신탁등기일(${trustDate})보다 앞섬 — 신탁 전 임차인으로 대항력을 유지할 가능성이 높으나, 수탁자가 이를 승계했는지는 신탁원부·계약서로 확인 필요`);
      return { ...out, opposable: null, effect: '검토', assumed_min: 0, assumed_max: deposit, reason: '신탁등기 전 전입 — 대항력 유지 가능성 높음(확정은 서류 확인 필요)' };
    }
    review.push(`tenants[${index}] 전입일(${t.registered_on})이 신탁등기일(${trustDate}) 이후 — 수탁자 동의 없이 설정된 임대차는 원칙적으로 매수인에게 대항하지 못하나(신탁법 제4조 취지), 수탁자 동의 여부를 신탁회사·계약서로 반드시 확인`);
    return { ...out, opposable: null, effect: '검토', assumed_min: 0, assumed_max: deposit, reason: '신탁등기 후 전입 — 수탁자 동의 없으면 대항력 없음(원칙), 동의 여부는 서류 확인 필요' };
  });

  for (const s of c.special ?? []) review.push(`특수 사항 "${s.kind ?? s}"${s.note ? ` (${s.note})` : ''} — 신탁공매는 등기만으로 판정 불가, 서류 확인`);

  const minimum = c.sale.minimum;
  const minimumRatio = Math.round((minimum / c.sale.appraisal) * 1000) / 10;
  const rate = c.sale.deposit_rate ?? (c.sale.resale ? 0.2 : 0.1);
  review.push('매수인 인수 예상액: 등기 권리·임차인의 인수 여부가 확정되지 않아 계산하지 않음 — 위 review 항목을 서류로 확인한 뒤 사람이 직접 판단');

  const priceGap = computePriceGap(c, minimum, null, null);
  const score = computeScore(c, {
    minimum, minimumRatio, failedRounds: c.sale.failed_rounds ?? 0, ownershipRisk: false,
    assumedTotalMax: null, tenantResults, specialCount: (c.special ?? []).length,
    reviewCount: review.length, priceGap,
  });

  return {
    engine_version: ENGINE_VERSION,
    input_hash: inputHash(c),
    computed_at: now.toISOString().slice(0, 10),
    disposal_type: '신탁공매',
    base_right: null,
    rights: rightResults,
    tenants: tenantResults,
    ownership_risk: false,
    assumed_total_min: null,
    assumed_total_max: null,
    minimum_ratio: minimumRatio,
    deposit_rate: rate,
    bid_deposit: Math.round(minimum * rate),
    minimum_plus_assumed_min: null,
    minimum_plus_assumed_max: null,
    price_gap: priceGap,
    score,
    review,
  };
}

export function computeCase(c, now = new Date()) {
  if (c.source?.type === 'onbid' && c.case?.onbid_property_type === '신탁공매') return computeTrustCase(c, now);
  const review = [];
  const rights = c.rights.map((r, index) => ({ ...r, index }));

  // 1) 말소기준권리
  const isBaseCandidate = r => BASE_KINDS.includes(r.kind) || (r.kind === '전세권' && r.whole_property === true && (r.dividend_claim === true || r.applicant === true));
  const candidates = rights.filter(isBaseCandidate).sort((a, b) => order(a, b) ?? 0);
  const base = candidates[0] ?? null;
  if (!base) review.push('말소기준권리 후보((근)저당권·압류·가압류·담보가등기·경매개시결정)가 없음 — 등기 입력 누락인지 확인');
  if (base && candidates[1] && order(base, candidates[1]) === null) {
    review.push(`말소기준권리 후보가 같은 날(${base.date}) 접수됐는데 접수번호가 없어 순서를 가릴 수 없음 — receipt_no 입력`);
  }

  // 2) 등기 권리별 인수/소멸
  let ownershipRisk = false;
  const rightResults = rights.map(r => {
    const out = { index: r.index, date: r.date, kind: r.kind, amount: r.amount ?? null };
    if (IGNORE_KINDS.includes(r.kind)) return { ...out, effect: '해당 없음', reason: '부담이 아닌 소유권 기록' };
    if (!base) return { ...out, effect: '검토', reason: '말소기준권리를 정하지 못함' };
    if (r.index === base.index) return { ...out, effect: '소멸', reason: '말소기준권리' };
    const o = order(r, base);
    if (o === null) {
      review.push(`rights[${r.index}] ${r.kind}(${r.date})가 말소기준권리와 같은 날 접수 — 접수번호로 선후를 확인`);
      return { ...out, effect: '검토', reason: '말소기준권리와 선후 불명' };
    }
    const prior = o < 0;
    if (AMBIGUOUS_KINDS[r.kind]) {
      review.push(`rights[${r.index}] ${r.kind}(${r.date}): ${AMBIGUOUS_KINDS[r.kind]}`);
      if (prior) ownershipRisk = true;
      return { ...out, effect: prior ? '검토' : '소멸', reason: prior ? `말소기준권리보다 앞선 가등기 — ${AMBIGUOUS_KINDS[r.kind]}` : '말소기준권리보다 뒤' };
    }
    if (!prior) {
      if (r.kind === '가처분') review.push(`rights[${r.index}] 가처분(${r.date})은 후순위라도 건물철거·토지인도 청구 가처분이면 인수될 수 있음 — 피보전권리 확인`);
      return { ...out, effect: '소멸', reason: '말소기준권리보다 뒤' };
    }
    if (r.kind === '전세권' && r.dividend_claim === true) return { ...out, effect: '소멸', reason: '선순위 전세권이지만 전세권자가 배당요구' };
    if (['가처분', '소유권이전청구권가등기', '환매특약'].includes(r.kind)) {
      ownershipRisk = true;
      review.push(`rights[${r.index}] 선순위 ${r.kind}(${r.date}) — 매수인이 소유권을 잃을 수 있는 권리. 금액으로 환산 불가`);
    }
    return { ...out, effect: '인수', reason: '말소기준권리보다 앞섬' };
  });

  // 3) 임차인
  const deadline = c.sale.dividend_deadline ?? null;
  const tenantResults = c.tenants.map((t, index) => {
    const deposit = t.deposit ?? null;
    const out = { index, use: t.use, registered_on: t.registered_on ?? null, deposit };
    if (deposit == null) review.push(`tenants[${index}] 보증금 미상 — 현황조사서·권리신고 내역 확인`);
    if (!t.registered_on) {
      review.push(`tenants[${index}] ${t.use === '상가' ? '사업자등록' : '전입'} 일자 미상 — 대항력 판정 불가`);
      return { ...out, opposable: null, effect: '검토', assumed_min: 0, assumed_max: deposit, reason: '대항 요건 일자 미상' };
    }
    if (!base) return { ...out, opposable: null, effect: '검토', assumed_min: 0, assumed_max: deposit, reason: '말소기준권리를 정하지 못함' };
    const keepsPossession = t.occupies || t.lease_registered === true; // 임차권등기를 하면 이사 가도 대항력 유지
    const opposable = keepsPossession && t.registered_on < base.date;
    if (!opposable) {
      const reason = !keepsPossession ? '점유하지 않고 임차권등기도 없어 대항 요건 상실'
        : `대항력 발생(${t.use === '상가' ? '사업자등록' : '전입'} 다음 날)이 말소기준권리(${base.date}) 이후`;
      return { ...out, opposable: false, effect: '소멸', assumed_min: 0, assumed_max: 0, reason: `${reason} — 보증금 인수 없음, 점유 중이면 명도 대상` };
    }
    let claimed = t.dividend_claim;
    if (claimed && deadline && t.dividend_claim_date && t.dividend_claim_date > deadline) {
      claimed = false;
      review.push(`tenants[${index}] 배당요구(${t.dividend_claim_date})가 배당요구종기(${deadline}) 이후 — 배당 제외로 보고 계산함`);
    }
    if (claimed && !t.dividend_claim_date && deadline) {
      review.push(`tenants[${index}] 배당요구 일자가 없어 종기 내 요구인지 확인 필요 — 기한 내로 가정`);
    }
    if (!claimed) {
      return { ...out, opposable: true, effect: '인수', assumed_min: deposit, assumed_max: deposit, reason: '대항력 있고 배당요구 없음 — 보증금 전액 매수인 인수' };
    }
    if (!t.fixed_date) review.push(`tenants[${index}] 대항력 있는 임차인이 배당요구했지만 확정일자가 없음 — 우선변제는 소액임차인 최우선변제만 가능, 배당액 확인 필요`);
    return { ...out, opposable: true, effect: '일부 인수 가능', assumed_min: 0, assumed_max: deposit, reason: '대항력 있고 배당요구함 — 배당받지 못한 보증금은 매수인 인수' };
  });

  // 4) 등기로 판단할 수 없는 사항
  if (c.case.category === 'land') {
    review.push('토지: 지상 건물이 있으면 법정지상권 성립 여부 확인(건물 소유자·저당 설정 당시 상태) — 코드는 판정하지 않음');
    review.push('토지: 지목·용도지역·도로 접함(맹지 여부)을 토지이용계획확인서·지적도로 확인');
    review.push('토지: 농지(전·답·과수원)면 농지취득자격증명 발급 가능 여부 확인 — 미제출 시 매각불허가');
  }
  for (const s of c.special ?? []) review.push(`특수 사항 "${s.kind ?? s}"${s.note ? ` (${s.note})` : ''} — 등기만으로 판정 불가, 현장·서류 확인`);

  // 5) 매각물건명세서 기재와 대조
  const spec = c.spec_sheet ?? {};
  const surviving = rightResults.filter(r => r.effect === '인수');
  if (spec.surviving_rights_text && /없음/.test(spec.surviving_rights_text) && surviving.length) {
    review.push(`매각물건명세서는 "인수되는 권리 없음"인데 계산 결과 인수 ${surviving.length}건 — 입력 오류인지 확인`);
  }
  if (spec.base_right_text && base) {
    const d = base.date.replace(/-/g, '.');
    if (!spec.base_right_text.includes(d) && !spec.base_right_text.includes(base.date)) {
      review.push(`매각물건명세서의 최선순위 설정(${spec.base_right_text})과 계산한 말소기준권리(${base.date} ${base.kind})가 다름`);
    }
  }

  // 6) 금액
  const sum = arr => arr.reduce((s, v) => (s == null || v == null ? null : s + v), 0);
  const rightAssumed = surviving.map(r => r.amount).filter(v => v != null);
  const unknownRightAmount = surviving.some(r => r.amount == null);
  if (unknownRightAmount) review.push('인수되는 등기 권리 중 금액이 없는 것이 있음 — 인수 금액 합계는 그 권리를 뺀 값');
  const assumedMin = sum([...rightAssumed, ...tenantResults.map(t => t.assumed_min)]);
  const assumedMax = sum([...rightAssumed, ...tenantResults.map(t => t.assumed_max)]);
  const rate = c.sale.deposit_rate ?? (c.sale.resale ? 0.2 : 0.1);
  const minimum = c.sale.minimum;
  const minimumRatio = Math.round((minimum / c.sale.appraisal) * 1000) / 10; // 감정가 대비 %

  // 7) 시세갭 — market.trades가 없으면 계산하지 않고 확인할 것으로만 남긴다
  const priceGap = computePriceGap(c, minimum, assumedMin, assumedMax);
  if (!priceGap) review.push('시세 데이터(market.trades) 없음 — 입력하면 시세갭·확인 지표 점수에 반영됨');

  // 8) 확인 지표 점수 — 지금 데이터로 계산 가능한 객관 지표만
  const score = computeScore(c, {
    minimum, minimumRatio, failedRounds: c.sale.failed_rounds ?? 0, ownershipRisk,
    assumedTotalMax: assumedMax, tenantResults, specialCount: (c.special ?? []).length,
    reviewCount: review.length, priceGap,
  });

  return {
    engine_version: ENGINE_VERSION,
    input_hash: inputHash(c),
    computed_at: now.toISOString().slice(0, 10),
    base_right: base ? { index: base.index, date: base.date, kind: base.kind } : null,
    rights: rightResults,
    tenants: tenantResults,
    ownership_risk: ownershipRisk,
    assumed_total_min: assumedMin,
    assumed_total_max: assumedMax,
    minimum_ratio: minimumRatio,
    deposit_rate: rate,
    bid_deposit: Math.round(minimum * rate),
    minimum_plus_assumed_min: assumedMin == null ? null : minimum + assumedMin,
    minimum_plus_assumed_max: assumedMax == null ? null : minimum + assumedMax,
    price_gap: priceGap,
    score,
    review,
  };
}
