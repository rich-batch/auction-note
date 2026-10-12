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
//
// car(자동차) 분류는 위 부동산 권리분석 로직과 다른 별도 계산(computeCarCase)을 쓴다 —
// 근거는 파일 아래 computeCarCase 주석 참고.
import crypto from 'node:crypto';
import { CATEGORIES, categoryBySlug } from '../lib/categories.mjs';

export const ENGINE_VERSION = 5; // 3: 시세 출처(market.trades[].source)별 시세갭, 자동차는 감정가 대비 별점을 매기지 않음 / 4: 명세서가 인수 권리를 적었는데 계산에 인수가 없으면 review / 5: 그때 인수 상한을 미상(null)으로

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
  // 온비드 재산유형별 지원 범위.
  //   압류재산: 국세징수법 92조 — 말소기준권리와 같은 구조 (computeCase 기본 경로)
  //   신탁공매: 신탁법 4조·22조 — 신탁등기일이 기준, 등기 권리 소멸/인수는 판정 안 함 (computeTrustCase)
  //   국유재산·공유재산: 국유재산법 제11조·공유재산법 제8조 — 사권(私權)이 소멸된 후에만 국가·지자체
  //     소유로 취득하므로, 원칙적으로 rights[]에 담보물권이 없어야 한다. 있으면 이례적이라 항상 검토.
  //     사용허가·대부 사용자가 있는지, 매각 시 그 계약이 어떻게 되는지는 코드가 판정하지 않는다
  //     (computePublicAssetCase).
  //   기타일반재산: 위임기관(수탁회사·파산관재인·기업회생지원처 등)마다 근거 법령이 달라 하나의
  //     계산으로 일반화할 수 없다 — 등기·권리 판정을 전부 검토로 남기는 최소 계산만 한다
  //     (computeOtherAssetCase, computeTrustCase와 같은 "전부 검토" 성격이지만 신탁 특유의
  //     날짜 비교는 없다).
  const ONBID_TYPES = ['압류재산', '신탁공매', '국유재산', '공유재산', '기타일반재산'];
  // 국유재산·공유재산·기타일반재산: 코드가 대항력·소멸/인수를 판정하지 않으므로 tenants를 받지 않는다.
  const REVIEW_ONLY_ONBID_TYPES = ['국유재산', '공유재산', '기타일반재산'];
  if (sourceType === 'onbid') {
    err(ONBID_TYPES.includes(c.case?.onbid_property_type), `온비드 사건은 지금 ${ONBID_TYPES.join(' / ')}만 지원한다. 그 외 재산유형은 법적 근거를 아직 확인 못 해 계산하지 않는다`);
    if (c.case?.onbid_property_type === '신탁공매') {
      err(isDate(c.case?.trust_registered_on), '신탁공매는 case.trust_registered_on(신탁등기 접수일, 등기사항전부증명서에서 확인)이 YYYY-MM-DD로 있어야 한다 — 신탁법 제4조상 이 날짜가 제3자 대항력의 기준');
    }
    if (REVIEW_ONLY_ONBID_TYPES.includes(c.case?.onbid_property_type)) {
      err(!(c.tenants ?? []).length, `${c.case.onbid_property_type}의 tenants는 항상 비워 둔다 — 코드가 대항력을 판정하지 않는다(국유재산법 제11조·공유재산법 제8조 취지, 기타일반재산은 위임기관마다 근거가 달라 일반화 불가). 사용허가·대부·임대차 등 점유 관계는 special에 기록`);
    }
  }
  for (const k of ['court', 'region']) err(typeof c.case?.[k] === 'string' && c.case[k].trim(), `case.${k} 필요`);
  const cat = categoryBySlug(c.case?.category);
  err(cat, `case.category는 ${CATEGORIES.map(x => x.slug).join(' / ')} 중 하나 (data/categories.json)`);
  if (cat?.slug === 'land') err(!(c.tenants ?? []).length, 'land(토지)의 tenants는 비워 둔다 — 토지 임차인은 대항력 규칙(농지법 등)이 달라 코드가 판정하지 않는다. special에 기록');
  if (cat?.engine === 'car') {
    err(!(c.tenants ?? []).length, '자동차(car)의 tenants는 항상 비워 둔다 — 자동차에는 주택임대차보호법 같은 대항력 있는 임차권 개념이 없다(민사집행규칙 제108조가 부동산 강제경매 규정을 준용하되 "등기"를 "등록"으로 볼 뿐, 임차권 규정이 적용될 대상 자체가 없다). 리스·할부 소유권유보 등 점유·소유 문제는 special에 기록');
    if (sourceType === 'onbid' && c.case?.onbid_property_type !== '압류재산') err(false, `자동차 계산(국세징수법 제92조제1항·민사집행규칙 제108조)은 압류재산을 기준으로 확인했다 — "${c.case?.onbid_property_type}" 자동차의 법적 근거는 아직 확인하지 못했다`);
  }
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

  // rights가 비어 있어도 되는 경우 둘:
  //   국유재산·공유재산·기타일반재산 — rights가 비어 있는 것이 오히려 정상이다(제11조·제8조 취지).
  //   car(자동차) — 등록된 저당권이 있어도 순서와 무관하게 항상 소멸이라(computeCarCase) 날짜 자체가
  //     계산에 영향을 주지 않는다. 실무상 필요한 건 "인수할 게 있는가"뿐인데, 이건 공매재산명세서의
  //     "등기된 권리 또는 가처분으로서 매각으로 그 효력을 잃지 아니하는 것" 칸(국세징수법 제77조제1항
  //     제4호)으로 이미 공식 확인된다 — 이 칸이 비어 있으면(=인수 대상 없음) rights도 비워 둘 수 있다.
  //     그 칸에 뭔가 적혀 있으면(이례적) 그 내용을 rights에 옮겨 적어야 한다.
  const rightsCanBeEmpty = (sourceType === 'onbid' && REVIEW_ONLY_ONBID_TYPES.includes(c.case?.onbid_property_type)) || cat?.engine === 'car';
  err(Array.isArray(c.rights) && (c.rights.length > 0 || rightsCanBeEmpty), 'rights(등기 권리)가 비어 있음 — 등기사항전부증명서 갑구·을구를 입력');
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
      // 앞뒤가 영숫자인 경우(해시값 등)는 빼야 계산 결과의 input_hash 같은 16진수 문자열이 우연히 걸리지 않는다
      err(!/(?<![0-9A-Za-z])\d{6}-?[1-4]\d{6}(?![0-9A-Za-z])/.test(v), `${p}: 주민등록번호로 보이는 값`);
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

// 시세갭: market.trades(사람이 확인해 넣은 비교 사례)가 있을 때만 계산한다.
// "시세차익"처럼 판단이 섞인 말을 쓰지 않고, 최저가(+인수 부담)와 시세 평균의 차이라는 사실만 낸다.
// trades[].source로 출처를 나눈다(없으면 molit = 국토부 실거래). 출처마다 성격이 달라(실거래 평균·공매 낙찰가·
// 판매 호가) 섞어서 평균내지 않고 출처별로 따로 계산하고, 점수는 MARKET_SOURCES 순서상 가장 믿을 만한 출처로 낸다.
export const MARKET_SOURCES = {
  molit: '국토부 실거래가',
  car365: '자동차365 평균 매매가',
  onbid: '온비드 공매 낙찰가',
  daangn: '당근중고차 매물 호가',
};
function computePriceGap(c, minimum, assumedMin, assumedMax) {
  const trades = c.market?.trades ?? [];
  if (!trades.length) return null;
  // 같은 출처 안에서도 kind가 다르면(예: 자동차365 "업자 판매가"·"업자 매입가") 따로 계산한다.
  // 같은 출처 안의 순서는 trades에 처음 나온 순서 — 점수 기준으로 쓸 kind를 먼저 적는다.
  const groups = Object.keys(MARKET_SOURCES).flatMap(source => {
    const list = trades.filter(t => (t.source ?? 'molit') === source);
    const kinds = [...new Set(list.map(t => t.kind ?? null))];
    return kinds.map(kind => ({ source, kind, list: list.filter(t => (t.kind ?? null) === kind) }));
  });
  // 이미 평균인 값(자동차365처럼 "N건 평균")은 trades[].count로 원자료 건수를 적고, 그 건수로 가중평균한다
  const by_source = groups.map(({ source, kind, list }) => {
    const n = list.reduce((s, t) => s + (t.count ?? 1), 0);
    const avg = Math.round(list.reduce((s, t) => s + t.price * (t.count ?? 1), 0) / n);
    return {
      source, kind, label: kind ? `${MARKET_SOURCES[source]} (${kind})` : MARKET_SOURCES[source], count: n, avg,
      // gap_min: 인수 부담이 최대일 때(보수적으로) 남는 차이 / gap_max: 인수 부담이 최소일 때 남는 차이
      gap_min: assumedMax == null ? null : avg - (minimum + assumedMax),
      gap_max: assumedMin == null ? null : avg - (minimum + assumedMin),
    };
  });
  const basis = by_source[0];
  return { market_avg: basis.avg, trade_count: basis.count, gap_min: basis.gap_min, gap_max: basis.gap_max, basis_source: basis.source, basis_label: basis.label, by_source };
}

// 확인 지표 점수: 지금 사건 데이터로 계산할 수 있는 객관 지표만, 각각 0~5점으로 정규화한다.
// "입찰하세요/말아야 합니다" 같은 결론이 아니라 "이 지표는 이래서 몇 점"이라는 사실 나열이다 —
// 최종 해설(왜 이 점수인지, 무엇을 더 볼지)은 글쓰는 AI가 값만 보고 쓴다.
function computeScore(c, { minimum, minimumRatio, failedRounds, ownershipRisk, assumedTotalMax, tenantResults, specialCount, reviewCount, priceGap }) {
  const items = [];

  // 시세 대비 가격갭 별점: 최저가+인수 부담(최대)이 시세 평균보다 30% 이상 낮으면 5점
  const gapStars = priceGap => {
    const gapRatio = priceGap.gap_min == null || priceGap.market_avg === 0 ? null : priceGap.gap_min / priceGap.market_avg;
    return gapRatio == null ? null : clamp(Math.round(5 * clamp(gapRatio / 0.3, 0, 1)), 0, 5);
  };
  const isCar = c.case?.category === 'car';

  items.push((() => {
    const value = `감정가의 ${minimumRatio}%${failedRounds ? ` (유찰 ${failedRounds}회)` : ''}`;
    // 자동차 감정가는 중고차 시세를 따라가지 못해(연식·주행거리·사고 이력 반영이 늦다) 감정가 대비가 아니라
    // 비슷한 차량 시세 대비로 가격 수준을 매긴다. 시세가 없으면 별점 없이 참고용.
    if (isCar) {
      if (!priceGap) return { key: 'price', label: '가격 수준', value, stars: null, note: '자동차는 감정가가 현재 중고차 시세를 반영하지 못해 감정가 대비로는 별점을 매기지 않는다 — 비슷한 차량 시세를 넣으면 그 대비로 매긴다' };
      const pct = Math.round(((minimum + (assumedTotalMax ?? 0)) / priceGap.market_avg) * 100);
      return { key: 'price', label: '가격 수준', value: `${priceGap.basis_label} ${krw(priceGap.market_avg)}원(${priceGap.trade_count}건)의 ${pct}% · ${value}`, stars: gapStars(priceGap), note: '최저가(+인수 부담)가 비슷한 차량 시세보다 많이 낮을수록 별점이 높다(30% 이상 낮으면 5점)' };
    }
    const stars = clamp(Math.round((100 - minimumRatio) / 20), 0, 5);
    return { key: 'price', label: '가격 수준', value, stars, note: '최저매각가격이 감정가 대비 낮을수록 별점이 높다' };
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

  // 부동산은 감정가 대비 가격 수준과 별도로 시세갭 지표를 둔다(자동차는 위 가격 수준에 합쳤다)
  if (priceGap && !isCar) {
    items.push({ key: 'price_gap', label: '시세 대비 가격갭', value: `${priceGap.basis_label} 평균 ${krw(priceGap.market_avg)}원, ${priceGap.trade_count}건 기준`, stars: gapStars(priceGap), note: '최저가에 인수 부담(최대 기준)을 더한 금액이 시세 평균보다 많이 낮을수록 별점이 높다' });
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

// 자동차(등록된 특정동산) 압류재산 공매·강제경매 공용 계산.
//
// 부동산과 결론이 달라지는 지점: 국세징수법 제92조제1항은 "공매재산에 설정된 모든 질권·저당권 및
// 가등기담보권은 매각으로 소멸된다"고 정해 순서를 따지지 않는다(부동산 위 부동산과 동일하게
// BASE_KINDS는 항상 말소기준권리 자신이거나 그보다 뒤라 이미 소멸이었지만, 이 조항 자체가
// "순서 무관 소멸"이라는 원칙을 명시한다). court 강제경매도 같다 — 민사집행규칙 제108조가
// 자동차집행에 부동산 강제경매 규정을 그대로 따르게 하면서 "등기"를 "등록"으로 볼 뿐이라
// 민사집행법 제91조제2항(모든 저당권 소멸)이 동일하게 적용된다.
// 부동산과 달리 자동차에는 지상권·전세권·대항력 있는 임차권 같은 "선순위면 인수" 개념 자체가
// 없다(주택임대차보호법·상가건물임대차보호법이 적용될 대상이 아님) — 그래서 tenants는 항상 비고
// (validateCase가 막음), base_right(말소기준권리) 개념도 쓰지 않는다.
// 유일하게 남는 인수 위험은 유치권이다: 매수인은 유치권자에게 그 채권을 변제할 책임이 있다
// (국세징수법 제92조제4항, 민사집행법 제91조제5항 — 자동차에도 민사집행규칙 제108조로 준용).
// 유치권은 등록원부에 나타나지 않는 점유·채권 관계라 코드가 판정할 수 없어 항상 review로 남긴다.
function computeCarCase(c, now) {
  const review = [];

  const rightResults = c.rights.map((r, index) => {
    const out = { index, date: r.date, kind: r.kind, amount: r.amount ?? null };
    if (IGNORE_KINDS.includes(r.kind)) return { ...out, effect: '해당 없음', reason: '부담이 아닌 소유권 기록' };
    if (BASE_KINDS.includes(r.kind)) return { ...out, effect: '소멸', reason: '자동차에 등록된 담보물권·압류는 순서와 무관하게 매각으로 소멸(국세징수법 제92조제1항, 민사집행규칙 제108조로 준용되는 민사집행법 제91조제2항)' };
    review.push(`rights[${index}] ${r.kind}(${r.date}): 자동차에 이런 권리가 등록될 수 있는지와 매각 시 효과가 법령상 확인되지 않음 — 자동차등록원부 원문과 등록 근거로 직접 확인`);
    return { ...out, effect: '검토', reason: '자동차에서는 이례적인 권리 종류 — 소멸·인수 효과 미확인' };
  });

  review.push('유치권: 자동차등록원부에 나타나지 않는 점유·채권 관계라 코드가 판정하지 않음 — 점유자·수리(정비) 내역으로 확인. 유치권이 있으면 매수인이 그 채권을 변제할 책임(국세징수법 제92조제4항, 민사집행법 제91조제5항)');
  for (const s of c.special ?? []) review.push(`특수 사항 "${s.kind ?? s}"${s.note ? ` (${s.note})` : ''} — 등록만으로 판정 불가, 서류·현장 확인`);

  const minimum = c.sale.minimum;
  const minimumRatio = Math.round((minimum / c.sale.appraisal) * 1000) / 10;
  const rate = c.sale.deposit_rate ?? (c.sale.resale ? 0.2 : 0.1);
  const priceGap = computePriceGap(c, minimum, 0, 0);
  if (!priceGap) review.push('비슷한 차량 시세(market.trades) 없음 — node tools/analysis/fetch-car-market.mjs로 온비드 낙찰 사례를 찾고, 자동차365 평균 매매가·당근중고차 매물가를 확인해 넣으면 시세갭·확인 지표 점수에 반영됨');
  const score = computeScore(c, {
    minimum, minimumRatio, failedRounds: c.sale.failed_rounds ?? 0, ownershipRisk: false,
    assumedTotalMax: 0, tenantResults: [], specialCount: (c.special ?? []).length,
    reviewCount: review.length, priceGap,
  });

  return {
    engine_version: ENGINE_VERSION,
    input_hash: inputHash(c),
    computed_at: now.toISOString().slice(0, 10),
    base_right: null,
    rights: rightResults,
    tenants: [],
    ownership_risk: false,
    assumed_total_min: 0,
    assumed_total_max: 0,
    minimum_ratio: minimumRatio,
    deposit_rate: rate,
    bid_deposit: Math.round(minimum * rate),
    minimum_plus_assumed_min: minimum,
    minimum_plus_assumed_max: minimum,
    price_gap: priceGap,
    score,
    review,
  };
}

// 국유재산·공유재산 전용 계산.
// 국유재산법 제11조·공유재산법 제8조(사권설정 재산의 취득 제한): "사권(私權)이 설정된 재산은
// 그 사권이 소멸되기 전에는 국유(공유)재산으로 취득하지 못한다"(판결에 의한 취득은 예외). 즉
// 이 유형은 매각 시점에 저당권 등 등기된 담보물권이 원칙적으로 없어야 한다 — court 경매·압류재산
// 공매처럼 "말소기준권리보다 앞선 권리를 인수"하는 문제 자체가 생기지 않는다. rights[]에 값이
// 있으면 그 예외(판결에 의한 취득)에 해당하는지를 사람이 직접 확인해야 해서 전부 검토로 남긴다.
// 또 하나의 실질 위험은 사용허가·대부(임대) 계약 중인 점유자다 — 매각으로 그 계약이 어떻게
// 되는지는 계약 조건과 관련 조문(국유재산법 제34조·제36조, 공유재산법 제31조·제35조)을 함께
// 봐야 하는 사실 문제라 코드가 판정하지 않는다. tenants는 항상 빈 배열(validateCase가 막음) —
// 이런 점유자는 special에 적는다.
function computePublicAssetCase(c, now) {
  const review = [];
  const disposalType = c.case.onbid_property_type; // '국유재산' 또는 '공유재산'
  const basis = disposalType === '공유재산' ? '공유재산법 제8조' : '국유재산법 제11조';

  const rightResults = c.rights.map((r, index) => {
    const out = { index, date: r.date, kind: r.kind, amount: r.amount ?? null };
    if (IGNORE_KINDS.includes(r.kind)) return { ...out, effect: '해당 없음', reason: '부담이 아닌 소유권 기록' };
    review.push(`rights[${index}] ${r.kind}(${r.date}): ${disposalType}은 ${basis}에 따라 사권이 소멸된 후에만 취득되는 것이 원칙이라 등록된 권리가 있는 것은 이례적임 — 판결에 의한 취득 예외인지, 등기 말소가 누락된 것인지 등기사항전부증명서로 직접 확인`);
    return { ...out, effect: '검토', reason: `${disposalType}에 등록된 권리 — 소멸·인수를 코드가 판정하지 않음(${basis} 취지상 이례적)` };
  });

  review.push('사용허가·대부(임대) 사용자가 있는지 공고문·담당 부서로 확인 — 매각으로 기존 계약이 어떻게 되는지는 계약 조건과 관련 조문(국유재산법 제34조·제36조, 공유재산법 제31조·제35조)을 함께 봐야 하는 사실 문제라 코드가 판정하지 않음');
  for (const s of c.special ?? []) review.push(`특수 사항 "${s.kind ?? s}"${s.note ? ` (${s.note})` : ''} — 등기·공고문만으로 판정 불가, 서류·담당 부서 확인`);

  const minimum = c.sale.minimum;
  const minimumRatio = Math.round((minimum / c.sale.appraisal) * 1000) / 10;
  const rate = c.sale.deposit_rate ?? (c.sale.resale ? 0.2 : 0.1);
  const priceGap = computePriceGap(c, minimum, 0, 0);
  if (!priceGap) review.push('시세 데이터(market.trades) 없음 — 입력하면 시세갭·확인 지표 점수에 반영됨');
  const score = computeScore(c, {
    minimum, minimumRatio, failedRounds: c.sale.failed_rounds ?? 0, ownershipRisk: false,
    assumedTotalMax: 0, tenantResults: [], specialCount: (c.special ?? []).length,
    reviewCount: review.length, priceGap,
  });

  return {
    engine_version: ENGINE_VERSION,
    input_hash: inputHash(c),
    computed_at: now.toISOString().slice(0, 10),
    disposal_type: disposalType,
    base_right: null,
    rights: rightResults,
    tenants: [],
    ownership_risk: false,
    assumed_total_min: 0,
    assumed_total_max: 0,
    minimum_ratio: minimumRatio,
    deposit_rate: rate,
    bid_deposit: Math.round(minimum * rate),
    minimum_plus_assumed_min: minimum,
    minimum_plus_assumed_max: minimum,
    price_gap: priceGap,
    score,
    review,
  };
}

// 기타일반재산 전용 계산. 온비드 "기타일반재산"은 위임기관(수탁회사·파산관재인·기업회생지원처 등)에
// 따라 매각 근거 법령 자체가 다르다 — 예: 회생지원 목적의 수탁재산 매각, 채무자의 지식재산권 매각위임
// 등. 하나의 계산으로 일반화할 근거가 없어 등기·권리 판정을 전부 검토로 남긴다. 실제로는 압류재산·
// 신탁공매·국유재산·공유재산에 해당하는데 온비드 표시만 "기타일반재산"인 경우(위임기관 이름으로
// 짐작 가능)는 사람이 직접 재분류하는 것을 권장한다 — fetch-onbid.mjs가 위임기관 이름에 "신탁"이
// 있으면 안내하는 것과 같은 이유다.
function computeOtherAssetCase(c, now) {
  const review = [];

  const rightResults = c.rights.map((r, index) => {
    const out = { index, date: r.date, kind: r.kind, amount: r.amount ?? null };
    if (IGNORE_KINDS.includes(r.kind)) return { ...out, effect: '해당 없음', reason: '부담이 아닌 소유권 기록' };
    review.push(`rights[${index}] ${r.kind}(${r.date}): 기타일반재산은 위임기관마다 매각 근거 법령이 달라 소멸/인수를 코드가 일반화해 판정하지 않음 — 공고문·위임기관에 직접 확인`);
    return { ...out, effect: '검토', reason: '기타일반재산 — 위임기관마다 근거가 달라 코드가 판정하지 않음' };
  });

  review.push('위임기관(공고문의 "위임기관"·"공매대행의뢰기관")의 매각 근거를 직접 확인 — 국유재산법·공유재산법·신탁법·개별 계약 등 사건마다 다르다');
  for (const s of c.special ?? []) review.push(`특수 사항 "${s.kind ?? s}"${s.note ? ` (${s.note})` : ''} — 등기·공고문만으로 판정 불가, 서류·담당 부서 확인`);

  const minimum = c.sale.minimum;
  const minimumRatio = Math.round((minimum / c.sale.appraisal) * 1000) / 10;
  const rate = c.sale.deposit_rate ?? (c.sale.resale ? 0.2 : 0.1);
  const priceGap = computePriceGap(c, minimum, 0, 0);
  if (!priceGap) review.push('시세 데이터(market.trades) 없음 — 입력하면 시세갭·확인 지표 점수에 반영됨');
  const score = computeScore(c, {
    minimum, minimumRatio, failedRounds: c.sale.failed_rounds ?? 0, ownershipRisk: false,
    assumedTotalMax: 0, tenantResults: [], specialCount: (c.special ?? []).length,
    reviewCount: review.length, priceGap,
  });

  return {
    engine_version: ENGINE_VERSION,
    input_hash: inputHash(c),
    computed_at: now.toISOString().slice(0, 10),
    disposal_type: '기타일반재산',
    base_right: null,
    rights: rightResults,
    tenants: [],
    ownership_risk: false,
    assumed_total_min: 0,
    assumed_total_max: 0,
    minimum_ratio: minimumRatio,
    deposit_rate: rate,
    bid_deposit: Math.round(minimum * rate),
    minimum_plus_assumed_min: minimum,
    minimum_plus_assumed_max: minimum,
    price_gap: priceGap,
    score,
    review,
  };
}

export function computeCase(c, now = new Date()) {
  const onbidType = c.source?.type === 'onbid' ? c.case?.onbid_property_type : null;
  if (onbidType === '신탁공매') return computeTrustCase(c, now);
  if (onbidType === '국유재산' || onbidType === '공유재산') return computePublicAssetCase(c, now);
  if (onbidType === '기타일반재산') return computeOtherAssetCase(c, now);
  if (categoryBySlug(c.case?.category)?.engine === 'car') return computeCarCase(c, now);
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
  // 반대 방향: 명세서가 매수인이 떠안는 권리(대항할 수 있는 임차권등기 등)를 적었는데 계산 결과엔 인수가 없으면,
  // 등기·임차인 입력에서 빠진 것이다 — 예: 임차권등기명령으로 대항력을 유지한 채 이사 간 임차인은 현황조사서에 안 잡힌다
  // (주택임대차보호법 제3조의3제5항). 명세서가 법원의 공식 판단이니 계산 결과로 덮지 않고 사람 확인으로 넘긴다.
  const opposableTenants = tenantResults.filter(t => t.opposable === true);
  const specSaysSurviving = Boolean(spec.surviving_rights_text && !/없음/.test(spec.surviving_rights_text) && /인수|대항/.test(spec.surviving_rights_text) && !surviving.length && !opposableTenants.length);
  if (specSaysSurviving) {
    review.push(`매각물건명세서는 매수인이 인수하는 권리를 적었는데("${spec.surviving_rights_text}") 계산 결과엔 인수가 없음 — 등기·임차인 입력에서 빠진 권리가 있는지 확인`);
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
  // 명세서가 인수 권리를 적었는데 계산에 안 잡혔으면, 떠안을 금액의 상한은 "모름"이다(0이라고 하면 명세서와 반대 결론이 된다)
  const assumedMax = specSaysSurviving ? null : sum([...rightAssumed, ...tenantResults.map(t => t.assumed_max)]);
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
