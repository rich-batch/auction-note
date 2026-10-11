// 온비드 자동차 물건명 → 보관 장소 + 차량 정보.
// 온비드는 자동차 물건명에 "<보관소 주소> (<차량번호>, <차종·연식…>)" 또는 "[ … ]" 형식으로 차량 정보를
// 섞어 준다(형식이 공고마다 조금씩 다름). 물건 개요 표가 차량 정보를 따로 보여 줄 수 있게 나눈다.
//   splitVehicle("경기도 … 오토마트 경기북부보관소(05버9478, EQ900 2017년식)")
//   → { storage: "경기도 … 오토마트 경기북부보관소", vehicle: { model: "EQ900", year: 2017, color: null, plate: "05버9478", first_registered: null, vin: null } }
// 차량번호가 안 보이면 나누지 않고 null을 돌려준다(사람이 직접 채운다).

const PLATE = /\d{2,3}\s?[가-힣]\s?\d{4}/;
const COLOR = /\s(흰|백|검정|검은|흑|은|회|쥐|파랑|청|빨강|적|남|갈|베이지|녹|노랑|금|진주|주황|하늘)색?(\([^)]*\))?(?=\s*$|\s*[,/\]])/;

export function splitVehicle(text = '') {
  const open = [...text.matchAll(/[([]/g)].find(m => PLATE.test(text.slice(m.index)));
  if (!open) return null;
  const close = open[0] === '(' ? ')' : ']';
  // 괄호 안에 괄호가 또 있을 수 있어("최초등록일: (2012.09.17.)") 마지막 닫는 괄호까지를 안쪽으로 본다
  const end = text.lastIndexOf(close);
  const inner = text.slice(open.index + 1, end > open.index ? end : undefined);
  const storage = text.slice(0, open.index).replace(/\s+보관\s*$/, '').replace(/\s+/g, ' ').trim();

  const plate = inner.match(PLATE)?.[0].replace(/\s/g, '') ?? null;
  const vin = inner.match(/차대번호\s*:?\s*([A-HJ-NPR-Z0-9]{17})/)?.[1] ?? null;
  const reg = inner.match(/최초등록일\s*:?\s*\(?\s*(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/);
  const first_registered = reg ? `${reg[1]}-${reg[2].padStart(2, '0')}-${reg[3].padStart(2, '0')}` : null;
  const year = Number(inner.match(/(\d{4})\s*년식/)?.[1]) || null;
  const color = inner.match(COLOR)?.[0].trim() ?? null;
  const model = inner
    .replace(PLATE, '')
    .replace(COLOR, '')
    .replace(/최초등록일\s*:?\s*\(?[\d.\s]+\)?\.?/, '')
    .replace(/차대번호\s*:?\s*[A-Z0-9]{17}/, '')
    .replace(/\d{4}\s*년식/, '')
    .split(/[,/]/).map(s => s.trim()).filter(Boolean).join(' ')
    .replace(/\s+/g, ' ').trim() || null;

  return { storage, vehicle: { model, year, color, plate, first_registered, vin } };
}
