// 법원경매정보(courtauction.go.kr) 법원코드 → 이 저장소의 사건 ID slug 변환.
// court-auction-notice-search의 getCourtCodes()가 주는 60개 법원 전부를 손으로 매핑했다.
// 새 법원이 추가되면(드묾) 여기 없는 코드는 그대로 소문자화한 코드를 slug로 쓰고 사람이 검토한다.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.mjs';

export const COURT_SLUGS = {
  B000210: 'seoul-central', B000211: 'seoul-dongbu', B000215: 'seoul-seobu',
  B000212: 'seoul-nambu', B000213: 'seoul-bukbu', B000214: 'uijeongbu',
  B214807: 'goyang', B214804: 'namyangju', B000240: 'incheon', B000241: 'bucheon',
  B000250: 'suwon', B000251: 'seongnam', B000252: 'yeoju', B000253: 'pyeongtaek',
  B250826: 'ansan', B000254: 'anyang', B000260: 'chuncheon', B000261: 'gangneung',
  B000262: 'wonju', B000263: 'sokcho', B000264: 'yeongwol', B000270: 'cheongju',
  B000271: 'chungju', B000272: 'jecheon', B000273: 'yeongdong', B000280: 'daejeon',
  B000281: 'hongseong', B000282: 'nonsan', B000283: 'cheonan', B000284: 'gongju',
  B000285: 'seosan', B000310: 'daegu', B000311: 'andong', B000312: 'gyeongju',
  B000313: 'gimcheon', B000314: 'sangju', B000315: 'uiseong', B000316: 'yeongdeok',
  B000317: 'pohang', B000320: 'daegu-seobu', B000410: 'busan', B000412: 'busan-dongbu',
  B000414: 'busan-seobu', B000411: 'ulsan', B000420: 'changwon', B000431: 'masan',
  B000421: 'jinju', B000422: 'tongyeong', B000423: 'miryang', B000424: 'geochang',
  B000510: 'gwangju', B000511: 'mokpo', B000512: 'jangheung', B000513: 'suncheon',
  B000514: 'haenam', B000520: 'jeonju', B000521: 'gunsan', B000522: 'jeongeup',
  B000523: 'namwon', B000530: 'jeju',
};

export function courtSlug(courtCode) {
  return COURT_SLUGS[courtCode] ?? courtCode.toLowerCase();
}

const SLUG_TO_COURT_CODE = Object.fromEntries(Object.entries(COURT_SLUGS).map(([code, slug]) => [slug, code]));

// court 사건 ID(`<법원slug>-<연도>ta<번호>[-물건번호]`)에서 법원코드를 역으로 뽑는다.
// fetch-court.mjs가 courtSlug()로 만든 id를 다시 법원경매정보 API에 넣어야 할 때 쓴다.
export function courtCodeFromId(id) {
  const slug = id.replace(/-\d{4}ta\d+(-\d+)?$/, '');
  return SLUG_TO_COURT_CODE[slug] ?? null;
}

// 법원경매정보 물건 주소(item.address)는 "소재지 [상세내역] 건물 구조·층별 면적..." 형식으로
// 뒤에 감정평가서 수준의 상세 스펙이 길게 붙는다 — "[상세내역]" 앞부분(실제 주소·동호수)만 쓴다.
export function fullAddress(address = '') {
  return (address || '').split('[상세내역]')[0].trim();
}

// 물건종류(usage 문자열, 예: "아파트", "자동차 중기", "상가 오피스텔 근린시설") → 이 저장소의
// 분류 slug(data/categories.json). 확실하지 않으면 사람이 정하도록 null.
export function guessCategoryFromUsage(usage = '') {
  if (/아파트/.test(usage)) return 'apartment';
  if (/다세대|연립|빌라/.test(usage)) return 'villa';
  if (/상가|오피스텔|근린|업무|공장|숙박/.test(usage)) return 'commercial';
  if (/토지|대지|임야|전|답|과수원|잡종지/.test(usage)) return 'land';
  if (/자동차|중기|차량/.test(usage)) return 'car';
  return null;
}

// data/courts-of-interest.json — scan-court.mjs가 --court 없이 실행될 때 순회할 관심 법원 목록.
const COURTS_OF_INTEREST_FILE = path.join(ROOT, 'data', 'courts-of-interest.json');
export function loadCourtsOfInterest() {
  const data = JSON.parse(fs.readFileSync(COURTS_OF_INTEREST_FILE, 'utf8'));
  return data.courts ?? [];
}
