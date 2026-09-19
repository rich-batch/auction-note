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

export const ENGINE_VERSION = 1;

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
  const num = c.case?.number;
  err(typeof num === 'string' && /^\d{4}타경\d+$/.test(num), 'case.number는 "2026타경12345" 형식');
  if (typeof num === 'string' && typeof c.id === 'string') {
    const token = num.replace('타경', 'ta');
    err(new RegExp(`(^|-)${token}(-\\d+)?$`).test(c.id), `id에 사건번호 토큰 "${token}"이 들어가야 함 (물건번호가 있으면 끝에 -N)`);
  }
  for (const k of ['court', 'property_type', 'region']) err(typeof c.case?.[k] === 'string' && c.case[k].trim(), `case.${k} 필요`);
  if (typeof c.case?.region === 'string') {
    err(!/\d+(-\d+)?\s*번지|\d+\s*호(?![가-힣])|\d+동\s*\d+호|\s\d+(-\d+)?$/.test(c.case.region), `case.region은 법정동까지만 (번지·동·호수 금지): "${c.case.region}"`);
  }
  err(isMoney(c.sale?.appraisal) && c.sale.appraisal > 0, 'sale.appraisal(감정가)은 0보다 큰 원 단위 정수');
  err(isMoney(c.sale?.minimum) && c.sale.minimum > 0, 'sale.minimum(최저매각가격)은 0보다 큰 원 단위 정수');
  err(isDate(c.sale?.sale_date), 'sale.sale_date(매각기일)는 YYYY-MM-DD');
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
  const { case: cs, sale, rights, tenants, special, spec_sheet } = c;
  return crypto.createHash('sha256').update(stable({ cs, sale, rights, tenants, special, spec_sheet, v: ENGINE_VERSION })).digest('hex').slice(0, 16);
}

// ── 계산 ─────────────────────────────────────────────────────────────
// 같은 날짜면 접수번호로 순서를 가린다. 접수번호가 없으면 순서 불명(null).
function order(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.receipt_no != null && b.receipt_no != null) return Math.sign(a.receipt_no - b.receipt_no);
  return null;
}

export function computeCase(c, now = new Date()) {
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
    minimum_ratio: Math.round((minimum / c.sale.appraisal) * 1000) / 10, // 감정가 대비 %
    deposit_rate: rate,
    bid_deposit: Math.round(minimum * rate),
    minimum_plus_assumed_min: assumedMin == null ? null : minimum + assumedMin,
    minimum_plus_assumed_max: assumedMax == null ? null : minimum + assumedMax,
    review,
  };
}
