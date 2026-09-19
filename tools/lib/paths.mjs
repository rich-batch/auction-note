// 저장소 경로 규칙의 단일 원본. 모든 도구·스킬 스크립트는 경로를 여기서만 만든다.
//
// 글 하나 = ID 하나. 가이드는 slug, 분석은 사건 ID(예: seoul-central-2026ta12345)가
// 글 폴더·조사 노트·데이터 파일·브랜치 이름을 모두 겸한다.
//
//   content/<type>/<id>/index.md            발행되는 글 (page bundle, 이미지도 같은 폴더)
//   pipeline/<type>/research/<id>.md        조사 노트 (발행 안 됨)
//   pipeline/<type>/research/<id>.eli5.json ELI5 커버 스펙
//   data/cases/<id>.json                    분석 글의 사실 데이터 (analysis만)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TYPES = ['guide', 'analysis'];
export const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const rel = p => path.relative(ROOT, p);
export const articleDir = (type, id) => path.join(ROOT, 'content', type, id);
export const articlePath = (type, id) => path.join(articleDir(type, id), 'index.md');
export const researchDir = type => path.join(ROOT, 'pipeline', type, 'research');
export const researchPath = (type, id) => path.join(researchDir(type), `${id}.md`);
export const eli5SpecPath = (type, id) => path.join(researchDir(type), `${id}.eli5.json`);
export const keywordsPath = path.join(ROOT, 'pipeline', 'guide', 'keywords.csv');
export const casesDir = path.join(ROOT, 'data', 'cases');
export const casePath = id => path.join(casesDir, `${id}.json`);
export const glossaryPath = path.join(ROOT, 'data', 'glossary.json');

export const articleExists = (type, id) => fs.existsSync(articlePath(type, id));

// content/<type>/<id>/index.md → { type, id }. 형식이 다르면 null.
export function parseArticlePath(file) {
  const parts = path.relative(ROOT, path.resolve(file)).split(path.sep);
  if (parts.length !== 4 || parts[0] !== 'content' || !TYPES.includes(parts[1]) || parts[3] !== 'index.md') return null;
  return { type: parts[1], id: parts[2] };
}

export const todayKST = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

export function listArticles(type) {
  const dir = path.join(ROOT, 'content', type);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'index.md')))
    .map(d => d.name)
    .sort();
}

// 글 front matter에서 draft 값만 필요할 때
export function readDraft(type, id) {
  if (!articleExists(type, id)) return null;
  const text = fs.readFileSync(articlePath(type, id), 'utf8');
  return /^draft:\s*true\s*$/m.test(text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '');
}
