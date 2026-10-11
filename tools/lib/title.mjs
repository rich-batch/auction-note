// 분석 글 제목 규칙. analyze-case 스킬 지시문(render-prompt.mjs)과 글 검사(tools/check/analysis.mjs)가 같이 쓴다.
//
// 형식: <지역> <물건> <경매|공매>[, <핵심>] (<사건번호>)
//   예: 서울 강동구 고덕어반브릿지 84㎡ 공매, 임차인 보증금 인수 가능 (2026-10100-001)
//       인천 영종구 페라리 F8 스파이더 공매 (2026-14614-002)
// <핵심>은 떠안을 게 있거나 확인할 게 있을 때만 붙인다. 인수 예상 없음은 목록·검색 카드의 배지로 보여 주므로 제목에 쓰지 않는다.
// 목록·검색 결과에서 제목만 보고 "어디의 무엇이고, 떠안을 게 있는지"를 알 수 있게 물건을 앞에, 사건번호를 뒤에 둔다.

const SIDO = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주',
  대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원도: '강원',
  강원특별자치도: '강원', 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전북특별자치도: '전북',
  전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주',
};

// "경기도 고양시 일산서구 …" → "경기 고양", "서울특별시 강동구 상일동 …" → "서울 강동구"
// 시·도를 항상 붙여 "광주시(경기)"와 "광주광역시"처럼 같은 이름을 구분한다.
export function regionLabel(region = '') {
  const [first, second = ''] = region.trim().split(/\s+/);
  const sido = SIDO[first] ?? first;
  if (!second || /(동|읍|면|리|가)$/.test(second)) return sido;
  const isDo = /도$/.test(first);
  return `${sido} ${isDo ? second.replace(/(시|군)$/, '') : second}`;
}

// 인수 위험 키 — layouts/_partials/case-risk.html과 같은 판정
export function riskKey(k = {}) {
  if (k.ownership_risk) return 'ownership';
  if (k.assumed_total_max == null) return 'review';
  return k.assumed_total_max > 0 ? 'assume' : 'none';
}

export const RISK_PHRASE = {
  none: '인수 권리 없음',
  assume: '인수 가능 금액 있음', // 무엇을 떠안는지 알면 구체적으로: "임차인 보증금 인수 가능", "전세권 인수 가능"
  ownership: '소유권 상실 위험',
  review: '확인할 권리 있음',
};

export const saleWord = c => (c.source?.type === 'onbid' ? '공매' : '경매');

// 물건 자리에 넣을 것(분류별). AI가 사건 데이터에서 골라 쓴다.
export const OBJECT_RULE = {
  apartment: '단지명 + 전용면적(㎡, 반올림 정수). 예: 고덕어반브릿지 84㎡',
  villa: '동 이름 + 건물명(있으면) + 전용면적(㎡). 예: 화곡동 OO빌라 49㎡',
  commercial: '건물명 또는 동 이름 + 층 + 용도(점포·사무실 등). 예: 역삼동 OO타워 1층 점포',
  land: '동·리 이름 + 지목 + 면적(㎡). 예: 운북동 대지 330㎡',
  car: '제조사 + 모델(+연식). 차량번호는 쓰지 않는다. 예: 페라리 F8 스파이더 2022년식',
};

export function titleSkeleton(c) {
  const risk = riskKey(c.computed);
  const point = risk === 'none' ? '' : `, ${RISK_PHRASE[risk]}`;
  return `${regionLabel(c.case.region)} <물건> ${saleWord(c)}${point} (${c.case.number})`;
}

// 제목 검사. { fails: [], warns: [] }
export function checkTitle(title, c) {
  const fails = [], warns = [];
  const risk = riskKey(c.computed);
  if (!title.endsWith(`(${c.case.number})`)) fails.push(`제목 끝에 "(${c.case.number})"가 없음 — 형식: ${titleSkeleton(c)}`);
  if (title.startsWith(c.case.number)) fails.push('제목이 사건번호로 시작함 — 지역·물건을 앞에, 사건번호는 끝 괄호에');
  if (/권리분석/.test(title)) fails.push('제목에 "권리분석"이 있음 — 모든 글이 권리분석이라 정보가 없다. 그 자리에 결론(인수 여부)을 쓴다');
  if (!title.includes(regionLabel(c.case.region))) warns.push(`제목에 지역 "${regionLabel(c.case.region)}"이 없음`);
  if (!title.includes(saleWord(c))) warns.push(`제목에 "${saleWord(c)}"가 없음 — 경매인지 공매인지 제목에서 보이게`);
  const saysRisk = /인수 가능|인수 위험|상실 위험|소유권/.test(title);
  if (risk === 'none' && saysRisk) fails.push('계산 결과는 인수 예상 없음인데 제목이 인수·위험을 말함');
  if (risk === 'none' && /인수 (권리|부담|금액)? ?없음|인수할 권리 없/.test(title)) fails.push('인수 예상 없음은 카드 배지로 보이므로 제목에 쓰지 않는다');
  if ((risk === 'assume' || risk === 'ownership') && !saysRisk) fails.push(`계산 결과(${RISK_PHRASE[risk]})가 제목에 없음 — 독자가 가장 먼저 알아야 할 결론`);
  if (c.case.category === 'car' && /자동차/.test(title)) warns.push('자동차 제목에 "자동차"만 있음 — 제조사·모델명을 쓴다');
  const head = [...title.replace(` (${c.case.number})`, '')].length;
  if (head > 42) warns.push(`제목(사건번호 괄호 제외)이 ${head}자 — 42자 이내 권장, 물건 설명을 줄인다`);
  return { fails, warns };
}
