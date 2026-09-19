// data/glossary.json 용어 → 가이드 글 상태.
//   published  발행된 가이드가 있음 → 분석 글에서 relref로 링크한다
//   draft      가이드가 초안 상태 → 링크하지 않는다(발행 빌드에서 relref가 실패함)
//   planned    keywords.csv에 slug만 있음
//   none       가이드 없음 → 가이드 후보
import fs from 'node:fs';
import { glossaryPath, readDraft } from './paths.mjs';

export function loadGlossary() {
  if (!fs.existsSync(glossaryPath)) return [];
  const { terms = [] } = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
  return terms.map(t => {
    if (!t.guide) return { ...t, state: 'none' };
    const draft = readDraft('guide', t.guide);
    return { ...t, state: draft === null ? 'planned' : draft ? 'draft' : 'published' };
  });
}

export const relrefFor = slug => `{{< relref "/guide/${slug}" >}}`;
