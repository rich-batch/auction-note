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

// 소재지에서 같은 단지를 알아볼 단서를 뽑는다. 법원·온비드 소재지는 두 형식이 섞여 있다:
//   지번 주소  "서울특별시 강서구 화곡동 899-21 양지샤인아파트 제12층 제1202호"  (뒤에 "(고덕로98길 75)"가 붙기도)
//   도로명 주소 "경기도 수원시 권선구 고산로6번길 45, 105동 9층906호 (고색동,대원아파트)"
// 도로명 주소는 지번이 없어 지번으로 맞출 수 없으므로 도로명+건물번호, 괄호 안 법정동+단지명을 함께 쓴다.
//   → { dong, lot, road, building }  (없는 것은 null)
const ROAD_RE = /([가-힣A-Za-z0-9]+(?:로|길))\s*(\d+(?:-\d+)?)(?=[\s,)]|$)/;
export function addressKeys(region) {
  const text = String(region ?? '').replace(/\s*외\s*\d+\s*건\s*$/, '').trim();
  const paren = /\(([^()]*)\)\s*$/.exec(text);
  const main = paren ? text.slice(0, paren.index) : text;
  const inParen = paren ? paren[1].split(',').map(s => s.trim()).filter(Boolean) : [];
  let dong = null, lot = null, road = null, building = null;

  const lotM = /(?:^|\s)([가-힣]+\d*가?(?:동|가|리))\s+(산?\d+(?:-\d+)?)(?=[\s,]|$)/.exec(main);
  if (lotM) { dong = lotM[1]; lot = lotM[2]; }
  const roadM = ROAD_RE.exec(main) ?? ROAD_RE.exec(inParen.join(' '));
  if (roadM && !(lotM && roadM.index === lotM.index)) road = `${roadM[1]} ${roadM[2]}`;

  for (const p of inParen) {
    if (ROAD_RE.test(p)) continue;
    if (/^[가-힣]+\d*가?(?:동|가|리|읍|면)$/.test(p)) { dong ??= p; continue; }
    building ??= p;
  }
  // 지번 주소: 지번 바로 뒤의 단어가 단지명이면(층·호·동 번호가 아니면) 쓴다
  if (!building && lotM) {
    const after = main.slice(lotM.index + lotM[0].length).trim().split(/\s+/)[0] ?? '';
    if (/[가-힣]{2,}/.test(after) && !/^제?\d|^[0-9가-힣]*(층|호)$|^[가-힣]?동$/.test(after)) building = after;
  }
  return { dong, lot, road, building };
}

// 실거래 한 건이 소재지와 같은 단지인지. t = { name, dong(법정동이 들어간 문자열), jibun, road }.
// 지번이 같거나, 도로명+건물번호가 같거나, 같은 법정동에서 단지명이 같으면("대원" = "대원아파트") 같은 단지로 본다.
const normRoad = s => String(s ?? '').replace(/\s/g, '').replace(/(\D)0+(\d)/g, '$1$2');
const normName = s => String(s ?? '').replace(/\s/g, '').replace(/(아파트|APT)$/i, '');
export function sameComplex(t, keys) {
  const inDong = keys.dong && String(t.dong ?? '').includes(keys.dong);
  if (keys.lot && t.jibun != null && String(t.jibun).trim() === keys.lot && inDong) return true;
  if (keys.road && t.road && normRoad(t.road) === normRoad(keys.road)) return true;
  if (keys.building && inDong && t.name && normName(t.name).length >= 2 && normName(t.name) === normName(keys.building)) return true;
  return false;
}
