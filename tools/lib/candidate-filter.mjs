// scan-onbid.mjs·scan-court.mjs·scan-daily.mjs가 공통으로 쓰는 "분석할 가치가 있는가" 필터.
// 사건을 거르는 게 아니라 스캔 결과에서 기본으로 숨기는 것뿐이다 — 등록(fetch-*)은 여전히
// 사람이 사건번호를 보고 직접 하므로, 여기서 숨긴 물건도 필요하면 --min-price=0
// --include-share로 다시 볼 수 있다. 목적은 사람(과 이 물건 목록을 읽는 AI)이 콘텐츠 가치가
// 거의 없는 자투리 물건까지 매번 다 훑지 않게 해서 시간·토큰을 아끼는 것.
export const DEFAULT_MIN_PRICE = 3_000_000; // 최저가 300만원 미만: 맹지 자투리·자투리 지분 등 감정가 자체가 콘텐츠 가치를 갖기 어려운 구간

const SHARE_PATTERN = /지분/; // 공유지분 매각 — 지분권자 간 협의·가격형성이 등기부만으로는 안 보여 이 저장소 계산 엔진의 강점(권리분석)이 잘 안 먹힘

// candidate: { category, minimumPrice, text } — text는 물건명·usage·비고처럼 "지분" 여부를 볼 수 있는 문자열
// opts: { minPrice, includeShare } — parseFilterArgs()가 CLI 인자에서 만들어 줌
export function evaluateCandidate({ minimumPrice, text = '' }, opts = {}) {
  const minPrice = opts.minPrice ?? DEFAULT_MIN_PRICE;
  const includeShare = opts.includeShare ?? false;

  if (!includeShare && SHARE_PATTERN.test(text)) {
    return { worth: false, reason: '공유지분 매각(--include-share로 포함)' };
  }
  // 최저가가 아직 공개 전(null/0)이면 판단 재료가 없다는 뜻이라 걸러내지 않고 그대로 보여준다.
  if (typeof minimumPrice === 'number' && minimumPrice > 0 && minimumPrice < minPrice) {
    return { worth: false, reason: `최저가 ${minPrice.toLocaleString('ko-KR')}원 미만(--min-price=0으로 포함)` };
  }
  return { worth: true };
}

export function parseFilterArgs(args) {
  const get = (flag) => args.find(a => a.startsWith(`--${flag}=`))?.slice(flag.length + 3)
    ?? (args.includes(`--${flag}`) ? args[args.indexOf(`--${flag}`) + 1] : null);
  const minPriceArg = get('min-price');
  return {
    minPrice: minPriceArg !== null && minPriceArg !== undefined ? Number(minPriceArg) : DEFAULT_MIN_PRICE,
    includeShare: args.includes('--include-share'),
  };
}

// 스캔 스크립트 말미에 붙이는 "이만큼 생략함" 요약 한 줄. 상세를 안 찍어서 토큰을 아낀다.
export function formatSkippedSummary(skipped) {
  if (!skipped.size) return null;
  const parts = [...skipped].map(([reason, count]) => `${reason} ${count}건`);
  return `분석 가치 낮아 생략: ${parts.join(', ')}`;
}
