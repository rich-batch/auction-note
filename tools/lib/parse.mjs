// 법원경매정보·온비드·실거래가 자료에서 오는 문자열을 사건 데이터 형식으로 바꾸는 공통 함수.
// 자료마다 표기가 달라(예: "2023.06.20." / "2023. 4. 13." / "2023-04-13") 도구마다 따로 정규식을 두면
// 한 곳만 고쳐지고 나머지가 INVALID를 만든다 — 여기 한 곳에서 읽는다. 테스트: tools/lib/parse.test.mjs

// "2023.06.20." · "2023. 4. 13." · "2023-4-13" · "2023년 4월 13일" → "2023-04-13". 날짜가 없거나 달력에 없는 날이면 null.
const DATE_RE = /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})(?!\d)\s*[.일]?/;
export function parseKoDate(s) {
  const m = DATE_RE.exec(String(s ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 매각물건명세서 "최선순위 설정"(예: "2023. 4. 13. 근저당권") → { date: "2023-04-13", kind: "근저당" }. 날짜로 시작하지 않으면 null.
export function parseTopPriority(s) {
  const text = String(s ?? '').trim();
  const m = new RegExp(`^${DATE_RE.source}\\s*(.+)$`).exec(text);
  if (!m) return null;
  const date = parseKoDate(m[0]);
  return date ? { date, kind: m[4].trim() } : null;
}

// 매각물건명세서 "매각으로 소멸되지 않는 권리"에서 날짜·접수번호·종류가 함께 적힌 권리를 모두 뽑는다.
// 예: "2024.07.09접수 제107054호로 경료된 을구 1번 주택임차권등기는 …" → [{ date, receipt_no, kind: "주택임차권등기" }]
const SURVIVING_KINDS = '주택임차권등기|임차권등기|전세권|지상권|가처분|소유권이전청구권가등기';
export function parseSurvivingRights(s) {
  const re = new RegExp(`(\\d{4}\\s*\\.\\s*\\d{1,2}\\s*\\.\\s*\\d{1,2})\\.?\\s*접수\\s*제\\s*(\\d+)\\s*호[^.]*?(${SURVIVING_KINDS})`, 'g');
  return [...String(s ?? '').matchAll(re)]
    .map(m => ({ date: parseKoDate(m[1]), receipt_no: Number(m[2]), kind: m[3] }))
    .filter(r => r.date);
}

// 소재지(case.region)에서 실거래가 조회용 시도·시군구를 뽑는다.
// 구가 있는 시(수원·성남·고양·용인·청주·천안·전주·포항·창원 등)는 시만으로는 법정동코드가 하나로 정해지지 않아
// "수원시 권선구"처럼 시+구로 묶는다. 서울 "강서구"처럼 시도 바로 아래가 구·군이면 그대로.
export function regionParts(region) {
  const w = String(region ?? '').trim().split(/\s+/);
  const sido = w[0] ?? null;
  if (!w[1]) return { sido, sigungu: null, city: null, gu: null };
  if (/시$/.test(w[1]) && /구$/.test(w[2] ?? '')) return { sido, sigungu: `${w[1]} ${w[2]}`, city: w[1], gu: w[2] };
  return { sido, sigungu: w[1], city: null, gu: null };
}

// 시군구 드롭다운·지역코드 검색 결과에서 그 소재지에 맞는 항목을 고른다. 표기가 "수원시 권선구"·"수원시권선구"·
// "수원권선구"처럼 사이트마다 달라 공백과 시 접미사를 무시하고 비교한다. 못 고르면 null(엉뚱한 구를 고르지 않는다).
export function matchSigungu(options, parts, text = o => o.text) {
  const norm = s => String(s ?? '').replace(/\s/g, '');
  const want = parts.gu
    ? [norm(parts.sigungu), norm(parts.city) + norm(parts.gu), norm(parts.city).replace(/시$/, '') + norm(parts.gu)]
    : [norm(parts.sigungu)];
  const exact = options.find(o => want.includes(norm(text(o))));
  if (exact) return exact;
  // 지역코드 검색은 "경기도 수원시 권선구"처럼 시도까지 붙여 돌려줄 수 있다 — 끝이 맞으면 같은 곳으로 본다
  // (서울 강서구·부산 강서구처럼 같은 이름이 여럿이면 시도로 가른다)
  const tail = options.filter(o => want.some(w => norm(text(o)).endsWith(w)));
  if (tail.length <= 1) return tail[0] ?? null;
  const sido = norm(parts.sido).replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, '');
  const inSido = tail.filter(o => sido && norm(text(o)).startsWith(sido));
  return inSido.length === 1 ? inSido[0] : null;
}
