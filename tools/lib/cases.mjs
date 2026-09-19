// 사건 데이터(data/cases/<id>.json) 읽기와 단계 판정.
//
// 단계는 파일에 따로 적지 않고 매번 현재 상태에서 계산한다(따로 적으면 실제와 어긋나기 쉽다).
//   계산 필요     computed가 없거나, 입력이 바뀌어 input_hash가 다름
//   글 작성 대기   계산은 최신인데 content/analysis/<id>/index.md가 없음
//   검토 대기     글이 draft: true
//   발행됨        draft: false, 매각기일 전
//   결과 입력 필요 매각기일이 지났는데 result.outcome이 비어 있음
//   종료          result.outcome 입력됨
import fs from 'node:fs';
import path from 'node:path';
import { casesDir, casePath, readDraft, todayKST } from './paths.mjs';
import { inputHash, validateCase } from '../analysis/rights.mjs';

export const STAGES = ['계산 필요', '글 작성 대기', '검토 대기', '발행됨', '결과 입력 필요', '종료'];

export function listCaseIds() {
  if (!fs.existsSync(casesDir)) return [];
  return fs.readdirSync(casesDir).filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json')).sort();
}

export function loadCase(id) {
  const p = casePath(id);
  if (!fs.existsSync(p)) throw new Error(`사건 데이터 없음: data/cases/${id}.json`);
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (c.id !== id) throw new Error(`data/cases/${id}.json의 id가 파일 이름과 다름: ${c.id}`);
  return c;
}

export const isComputedFresh = c => !!c.computed && c.computed.input_hash === inputHash(c);

export function caseStage(c, today = todayKST()) {
  if (validateCase(c).length || !isComputedFresh(c)) return '계산 필요';
  const draft = readDraft('analysis', c.id);
  if (draft === null) return '글 작성 대기';
  if (draft) return '검토 대기';
  if (c.result?.outcome) return '종료';
  if (c.sale.sale_date < today) return '결과 입력 필요';
  return '발행됨';
}

// 사건 데이터에 들어 있는 모든 금액(원). 분석 글 본문 금액 대조에 쓴다.
export function knownAmounts(c) {
  const out = new Set();
  const walk = v => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') return Object.values(v).forEach(walk);
    if (Number.isInteger(v) && v >= 10000) out.add(v);
  };
  walk(c);
  return out;
}
