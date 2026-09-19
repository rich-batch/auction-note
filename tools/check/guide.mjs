#!/usr/bin/env node
// 가이드 글 검사.
//   node tools/check/guide.mjs content/guide/<slug>/index.md                  구조·출처·품질 게이트
//   node tools/check/guide.mjs content/guide/<slug>/index.md --facts          수치·날짜 줄과 출처 (갱신 점검용)
//   node tools/check/guide.mjs content/guide/<slug>/index.md --verify-links   참고 자료 링크 접속 확인 (발행 직전)
import fs from 'node:fs';
import { researchPath, eli5SpecPath, rel, todayKST } from '../lib/paths.mjs';
import {
  linkRe, NUM, DATE, loadArticle, createReport, printReport, sectionTextOf, verifyLinks,
  coverFields, checkCover, checkBodyImages, checkHonesty, checkPersonalInfo, checkIntro, checkDates, checkReferences, checkInternalLinks,
} from './common.mjs';

const file = process.argv[2];
if (!file) { console.error('파일 경로를 넘겨라: content/guide/<slug>/index.md'); process.exit(2); }
const a = loadArticle(file, 'guide');
const { front, body, fm } = a;
const slug = a.id;

if (process.argv.includes('--verify-links')) verifyLinks(a);

if (process.argv.includes('--facts')) {
  const refsStart = body.search(/^## 참고 자료/m);
  const main = refsStart === -1 ? body : body.slice(0, refsStart);
  console.log(`${file} | lastmod ${a.lastmod ?? '?'} | volatile ${front.match(/^volatile:\s*(\w+)/m)?.[1] ?? '?'}`);
  main.split('\n').forEach((line, i) => {
    if (!line.trim() || /^#/.test(line)) return;
    if (NUM.test(line.replace(linkRe, '').replace(DATE, '')) || DATE.test(line)) {
      DATE.lastIndex = 0;
      const urls = [...line.matchAll(linkRe)].map(m => m[1]);
      console.log(`${String(i + 1 + (fm ? fm[0].split('\n').length - 1 : 0)).padStart(4)}: ${line.replace(linkRe, '').trim().slice(0, 90)}`);
      urls.forEach(u => console.log(`      ↳ ${u}`));
    }
    DATE.lastIndex = 0;
  });
  process.exit(0);
}

const r = createReport();
const { check, warn } = r;

// front matter
check(fm, 'front matter(---)가 파일 맨 위에 없음');
for (const key of ['title', 'date', 'lastmod', 'draft', 'volatile', 'categories', 'tags', 'description', 'cover']) {
  check(new RegExp(`^${key}:`, 'm').test(front), `front matter에 ${key} 없음`);
}
check(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug), '글 폴더 이름이 영문 슬러그(소문자·숫자·하이픈)가 아님');
checkDates(a, r, todayKST());
check(/^volatile:\s*(true|false)\s*$/m.test(front), 'volatile은 true 또는 false');
const { title } = a;
check(!/\b20\d{2}\b/.test(title), '제목에 연도가 들어 있음');
warn(title.length <= 22, `제목이 ${title.length}자 — 20자 안팎 권장(검색 결과·헤더에서 잘림): "${title}"`);
warn(!/완벽\s*정리|총정리|모든\s*것/.test(title), `제목에 상투적 표현("완벽 정리" 등)이 있음 — 구체적 차별점으로 교체 권장: "${title}"`);
const description = front.match(/^description:\s*"?(.+?)"?\s*$/m)?.[1] ?? '';
check(!/정리(합니다|했습니다)\.?$|알아봅니다\.?$/.test(description), 'description이 "~정리합니다/알아봅니다"로 끝남');

// images
checkCover(a, r, coverFields(front));
check(fs.existsSync(eli5SpecPath('guide', slug)), `ELI5 스펙 없음: ${rel(eli5SpecPath('guide', slug))} (render-eli5.mjs로 만든 이미지인지 확인 불가)`);
const { bodyImages, imagePlaceholders } = checkBodyImages(a, r);

// sections
const h2 = [...body.matchAll(/^## (.+)$/gm)].map(m => m[1].trim());
const isFaq = h => h.includes('자주 묻는 질문');
const isRefs = h => h.includes('참고 자료');
const sections = h2.filter(h => !isFaq(h) && !isRefs(h));
check(sections.length >= 4 && sections.length <= 6, `본문 ## 소제목이 ${sections.length}개 (4~6개여야 함)`);
check(!sections.some(h => /^(서론|들어가며|결론|마치며|마무리)$/.test(h)), '서론/결론 같은 형식적 소제목이 있음');
const faqIdx = h2.findIndex(isFaq);
const refsIdx = h2.findIndex(isRefs);
check(faqIdx !== -1, '"## 자주 묻는 질문" 섹션 없음');
check(refsIdx !== -1, '"## 참고 자료" 섹션 없음');
if (faqIdx !== -1 && refsIdx !== -1) {
  check(faqIdx === h2.length - 2 && refsIdx === h2.length - 1, '마지막 두 섹션이 "자주 묻는 질문" → "참고 자료" 순서가 아님');
}
const sectionText = sectionTextOf(body);
if (faqIdx !== -1) {
  const qs = sectionText(h2[faqIdx]).match(/^### Q/gm) ?? [];
  check(qs.length >= 3 && qs.length <= 5, `FAQ 질문이 ${qs.length}개 (3~5개여야 함)`);
}
warn(!sections.some(h => /(세|네|다섯|여섯|일곱|[3-9])\s*가지/.test(h)), `소제목에 "N가지" 분류가 있음 — 억지 분류인지 확인: ${sections.filter(h => /가지/.test(h)).join(' / ')}`);

checkIntro(a, r);
checkHonesty(a, r);
checkPersonalInfo(a, r);
checkInternalLinks(a, r);
check(/^\|.+\|\s*\n\|\s*:?-{3,}/m.test(body), '마크다운 표가 없음');

const placeholders = body.match(/\[경험 추가 필요[^\]]*\]/g) ?? [];
if (a.isDraft) warn(placeholders.length > 0, '[경험 추가 필요] 자리가 0곳 — 사람의 경험이 들어갈 자리를 표시했는지 확인');
else check(!placeholders.length, `draft: false인데 [경험 추가 필요] ${placeholders.length}곳이 남아 있음`);

// 한국어 리듬 (AI 티 감지) — 정확한 문장 분리는 아니지만 극단적인 반복만 잡는 대략적 신호
const proseOnly = body
  .split(/^## (?:자주 묻는 질문|참고 자료)/m)[0]
  .split('\n')
  .filter(l => l.trim() && !/^\s*[#>|*-]/.test(l) && !/^\s*\d+\.\s/.test(l) && !/^!\[/.test(l))
  .join(' ')
  .replace(/\[[^\]]+\]\([^)]+\)/g, '');
const sentences = proseOnly.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 3);
let sameEndingRun = 0, maxSameEndingRun = 0;
for (const s of sentences) {
  if (/(습니다|합니다|입니다)\.?$/.test(s)) { sameEndingRun++; maxSameEndingRun = Math.max(maxSameEndingRun, sameEndingRun); }
  else sameEndingRun = 0;
}
warn(maxSameEndingRun < 4, `"~습니다/합니다/입니다"로 끝나는 문장이 ${maxSameEndingRun}개 연속 — 종결어미를 섞어 리듬을 살릴 수 있는지 확인(예: ~죠, ~거든요, ~인데요, 명사형)`);
const exampleCount = (proseOnly.match(/예를 들어/g) ?? []).length;
warn(exampleCount <= 2, `"예를 들어"가 ${exampleCount}번 반복됨 — 다른 방식으로 예시를 도입할 수 있는지 확인`);
if (faqIdx !== -1) {
  const faqAnswers = sectionText(h2[faqIdx]).split(/^### Q\./m).slice(1).map(b => b.replace(/^[^\n]*\n/, '').trim());
  const yesNoStart = faqAnswers.filter(x => /^(네|아닙니다|그렇습니다|그렇지 않습니다)[.,]/.test(x)).length;
  warn(yesNoStart <= Math.floor(faqAnswers.length / 2), `FAQ 답변 ${yesNoStart}/${faqAnswers.length}개가 "네/아닙니다"류로 시작 — 답마다 시작 방식을 다르게 할 수 있는지 확인`);
}
const openings = sections.map(h => (sectionText(h).split('\n').slice(1).find(l => l.trim()) ?? '').trim().slice(0, 12));
const sameOpeningPattern = openings.filter(o => /는 (단순히|단지)/.test(o)).length;
warn(sameOpeningPattern < 2, `소제목이 "OO는 단순히 ~" 패턴으로 ${sameOpeningPattern}번 시작함 — 여는 방식을 다르게(질문·장면·결론 등)`);

// boxes / tables / walls of text
const boxes = body.split(/\n\s*\n/).filter(b => /^\s*>/.test(b));
check(boxes.length <= 2, `박스(인용블록)가 ${boxes.length}개 — 핵심 요약 + 주의/한 줄 정리 중 하나, 최대 2개`);
const tableCount = (body.match(/^\|.+\|\s*\n\|\s*:?-{3,}/gm) ?? []).length;
const plainChars = body.replace(/\]\([^)]*\)/g, ']').replace(/\s/g, '').length;
warn(tableCount <= Math.max(2, Math.round(plainChars / 1000)), `표 ${tableCount}개(글자 약 ${plainChars}자) — 도배인지 확인`);
let run = 0, maxRun = 0;
for (const block of body.split(/^## (?:자주 묻는 질문|참고 자료)/m)[0].split(/\n\s*\n/)) {
  const b = block.trim();
  if (!b || /^#/.test(b)) continue;
  if (/^(>|\||!\[|[-*] |\d+\. |\[이미지 필요)/.test(b)) { run = 0; continue; }
  run += 1; maxRun = Math.max(maxRun, run);
}
warn(maxRun <= 5, `표·박스·목록·이미지 없이 문단 ${maxRun}개가 연속 — 글자 벽 구간에 닻(표·주의 박스)을 둘 수 있는지 확인`);

// citations
const refsText = refsIdx !== -1 ? sectionText(h2[refsIdx]) : '';
const faqText = faqIdx !== -1 ? sectionText(h2[faqIdx]) : '';
const research = fs.existsSync(researchPath('guide', slug)) ? fs.readFileSync(researchPath('guide', slug), 'utf8') : null;
const { refUrls, bodyWithoutRefs } = checkReferences(a, r, { refsText, research });
const mainText = bodyWithoutRefs.replace(faqText, '');
const mainLines = mainText.split('\n').filter(l => l.trim() && !/^#/.test(l) && !/^출처:/.test(l));
const listLines = mainLines.filter(l => /^\s*([-*]|\d+\.)\s/.test(l) || /^\s*\|/.test(l));
warn(listLines.length / Math.max(mainLines.length, 1) <= 0.5, `본문 줄의 ${Math.round(100 * listLines.length / mainLines.length)}%가 목록·표 — 정보 나열형인지 확인(설명 문장으로 이어 쓰기)`);

const uncited = [];
let inTable = false, tableHasNumber = false, tableStart = 0;
const bodyLines = bodyWithoutRefs.split('\n');
bodyLines.forEach((line, i) => {
  if (/^\s*\|/.test(line)) {
    if (!inTable) { inTable = true; tableHasNumber = false; tableStart = i; }
    if (NUM.test(line.replace(DATE, ''))) tableHasNumber = true;
    return;
  }
  if (inTable) {
    inTable = false;
    const after = bodyLines.slice(i, i + 3).join('\n');
    if (tableHasNumber && !/출처:.*\]\(https?:/.test(after)) uncited.push(`표(${tableStart + 1}행 부근) 아래에 "출처: [..](URL)" 줄이 없음`);
    else if (tableHasNumber && !/출처:.*기준/.test(after)) uncited.push(`표(${tableStart + 1}행 부근) 출처 줄에 "(YYYY년 M월 D일 기준)"이 없음`);
  }
  if (/^#{1,6}\s/.test(line) || !line.trim()) return;
  const stripped = line.replace(linkRe, '').replace(DATE, '');
  if (NUM.test(stripped) && !linkRe.test(line)) uncited.push(line.trim().slice(0, 60));
  linkRe.lastIndex = 0;
});
check(!uncited.length, `출처 링크 없는 수치 ${uncited.length}곳:\n    ${uncited.join('\n    ')}`);

// research note
if (research == null) {
  r.fails.push(`조사 노트 없음: ${rel(researchPath('guide', slug))}`);
} else {
  check(/^## 중복 판단/m.test(research), '조사 노트에 "## 중복 판단" 섹션 없음');
  check(/^## 경쟁 글 비교/m.test(research), '조사 노트에 "## 경쟁 글 비교" 섹션 없음');
  check(/^차별점:\s*\n\s*-\s*\S/m.test(research), '조사 노트에 차별점이 비어 있음');
  const imgs = [...body.matchAll(/^!\[[^\]]*\]\(([^)\s]+)\)/gm)].map(m => m[1].split('/').pop());
  const undocumented = imgs.filter(f => !research.includes(f));
  check(!undocumented.length, `조사 노트 "## 이미지"에 만든 방법·데이터 출처가 없는 본문 이미지: ${undocumented.join(', ')}`);
}

const chars = body.replace(/\]\([^)]*\)/g, ']').replace(/\s/g, '').length;
const summary = `제목: ${title} | 글자 수(공백·URL 제외) 약 ${Math.round(chars / 100) * 100} | 소제목 ${sections.length}개 | 표 ${tableCount} · 박스 ${boxes.length} · 본문 이미지 ${bodyImages} (+이미지 자리 ${imagePlaceholders}) | 출처 ${refUrls.size}개 | 경험 자리 ${placeholders.length}곳`;
printReport(file, summary, r);
