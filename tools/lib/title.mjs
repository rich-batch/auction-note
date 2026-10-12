// 분석 글 제목 규칙. analyze-case 스킬 지시문(render-prompt.mjs)과 글 검사(tools/check/analysis.mjs)가 같이 쓴다.
//
// 형식: <지역> <물건> <경매|공매> (<사건번호>)
//   예: 서울 강동구 고덕어반브릿지 84㎡ 공매 (2026-10100-001)
//       인천 영종구 페라리 F8 스파이더 공매 (2026-14614-002)
// 제목은 "어디의 무엇"만 말한다. 인수·위험 같은 판정은 사건마다 바뀌고 계산 결과가 갱신되면 낡으므로
// 제목에 쓰지 않고 front matter 태그(riskTags)와 목록·검색 카드의 배지로 보여 준다.

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
  return `${regionLabel(c.case.region)} <물건> ${saleWord(c)} (${c.case.number})`;
}

// 판정은 태그로: 계산 결과의 위험 문구 하나(필수) + 매각물건명세서가 대항할 수 있는 임차권등기를 적었으면 "임차권등기".
export function riskTags(c) {
  const tags = [RISK_PHRASE[riskKey(c.computed)]];
  if (/임차권등기/.test(c.spec_sheet?.surviving_rights_text ?? '')) tags.push('임차권등기');
  return tags;
}
// 위험 태그로 인정하는 말 — 계산 결과 문구 그대로이거나 더 구체적인 말(예: "임차인 보증금 인수 가능")
const RISK_TAG_RE = {
  none: /인수 권리 없음/,
  assume: /인수 가능/,
  ownership: /소유권 상실 위험/,
  review: /확인할 권리 있음|확인 필요|인수 가능/, // 대항력 있는 임차인인데 보증금 미상이면 "임차인 보증금 인수 가능"처럼 구체적으로 써도 된다
};

// 제목 검사. { fails: [], warns: [] }
export function checkTitle(title, c, tags = []) {
  const fails = [], warns = [];
  const risk = riskKey(c.computed);
  if (!title.endsWith(`(${c.case.number})`)) fails.push(`제목 끝에 "(${c.case.number})"가 없음 — 형식: ${titleSkeleton(c)}`);
  if (title.startsWith(c.case.number)) fails.push('제목이 사건번호로 시작함 — 지역·물건을 앞에, 사건번호는 끝 괄호에');
  if (/권리분석/.test(title)) fails.push('제목에 "권리분석"이 있음 — 모든 글이 권리분석이라 정보가 없다');
  if (/,\s*[^()]+\(/.test(title) || /인수|위험|대항력|임차권등기|확인할 권리|보증금/.test(title)) fails.push(`제목에 판정(인수·위험 등)이 있음 — 판정은 태그로(${riskTags(c).join('·')}), 제목은 ${titleSkeleton(c)}`);
  if (!title.includes(regionLabel(c.case.region))) warns.push(`제목에 지역 "${regionLabel(c.case.region)}"이 없음`);
  if (!title.includes(saleWord(c))) warns.push(`제목에 "${saleWord(c)}"가 없음 — 경매인지 공매인지 제목에서 보이게`);
  if (c.case.category === 'car' && /자동차/.test(title)) warns.push('자동차 제목에 "자동차"만 있음 — 제조사·모델명을 쓴다');
  const head = [...title.replace(` (${c.case.number})`, '')].length;
  if (head > 42) warns.push(`제목(사건번호 괄호 제외)이 ${head}자 — 42자 이내 권장, 물건 설명을 줄인다`);
  // 판정 태그: 제목에서 뺀 결론이 태그에는 있어야 한다
  if (!tags.some(t => RISK_TAG_RE[risk].test(t))) fails.push(`tags에 계산 결과 태그("${RISK_PHRASE[risk]}")가 없음 — 판정은 제목 대신 태그로 보여 준다`);
  if (riskTags(c).includes('임차권등기') && !tags.includes('임차권등기')) fails.push('매각물건명세서에 대항할 수 있는 임차권등기가 있는데 tags에 "임차권등기"가 없음');
  return { fails, warns };
}
