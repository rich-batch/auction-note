#!/usr/bin/env node
// Usage:
//   node .claude/skills/write-article/check-article.mjs content/posts/<slug>.md          structure/citation/quality gate
//   node .claude/skills/write-article/check-article.mjs content/posts/<slug>.md --facts  list lines with numbers/dates + links (for upkeep)
//   node .claude/skills/write-article/check-article.mjs content/posts/<slug>.md --verify-links  check all URLs are accessible (before publication)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// Citable sources. Add a domain only after confirming it is an official/primary source.
const ALLOWED_DOMAINS = [
  'go.kr',          // 정부·공공기관 전체 (law.go.kr, fsc.go.kr, easylaw.go.kr, scourt.go.kr, nts.go.kr, wetax.go.kr ...)
  'korea.kr',       // 대한민국 정책브리핑
  'bok.or.kr',      // 한국은행
  'kfb.or.kr',      // 은행연합회 (소비자포털 금리 공시)
  'khug.or.kr',     // 주택도시보증공사
  'kamco.or.kr',    // 한국자산관리공사
  'onbid.co.kr',    // 온비드
  'fss.or.kr',      // 금융감독원
];

const file = process.argv[2];
if (!file) { console.error('파일 경로를 넘겨라'); process.exit(2); }
const text = fs.readFileSync(file, 'utf8');
const fails = [];
const warns = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const warn = (ok, msg) => { if (!ok) warns.push(msg); };

const linkRe = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;
const NUM = /\d[\d,.]*\s*(%|퍼센트|만\s*원|억|원|개월|주(?!택)|영업일|일|년|배|점|분의|㎡|평|세)/;
const DATE = /\d{4}[년.\-]\s*\d{1,2}[월.\-]\s*\d{1,2}일?|\d{4}년 \d{1,2}월|\d{4}년/g;

const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
const front = fm?.[1] ?? '';
const body = fm ? text.slice(fm[0].length) : text;

if (process.argv.includes('--verify-links')) {
  const refsStart = body.search(/^## 참고 자료/m);
  const refsSection = refsStart !== -1 ? body.slice(refsStart) : '';
  const refUrls = [...new Set([...refsSection.matchAll(linkRe)].map(m => m[1]))];
  const failed = [];
  for (const url of refUrls) {
    try {
      const out = execSync(`curl -I -s -m 5 -L "${url}" 2>&1 | head -1`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      if (!out.includes('HTTP/')) { failed.push([url, '응답 없음']); continue; }
      const code = out.match(/HTTP\/\S+ (\d+)/)?.[1];
      if (code && (code.startsWith('4') || code.startsWith('5'))) { failed.push([url, `HTTP ${code}`]); }
    } catch (e) { failed.push([url, '접속 실패']); }
  }
  if (failed.length) {
    console.error(`LINK FAIL: ${file}`);
    failed.forEach(([u, err]) => console.error(`- ${u} → ${err}`));
    process.exit(1);
  } else {
    console.log(`LINKS OK: ${file} (${refUrls.length}개 확인)`);
    process.exit(0);
  }
}

if (process.argv.includes('--facts')) {
  const refsStart = body.search(/^## 참고 자료/m);
  const main = refsStart === -1 ? body : body.slice(0, refsStart);
  const lastmod = front.match(/^lastmod:\s*"?([\d-]+)/m)?.[1] ?? '?';
  console.log(`${file} | lastmod ${lastmod} | volatile ${front.match(/^volatile:\s*(\w+)/m)?.[1] ?? '?'}`);
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

// front matter
check(fm, 'front matter(---)가 파일 맨 위에 없음');
for (const key of ['title', 'date', 'lastmod', 'draft', 'volatile', 'categories', 'tags', 'description', 'cover']) {
  check(new RegExp(`^${key}:`, 'm').test(front), `front matter에 ${key} 없음`);
}
check(/^author:\s*"?rich-batch"?\s*$/m.test(front), 'front matter에 author: "rich-batch"가 없거나 다른 값');
check(/^showToc:\s*true\s*$/m.test(front), 'front matter에 showToc: true 없음 (본문 ## 소제목이 4개 이상이라 목차가 필요하다)');
const isDraft = /^draft:\s*true\s*$/m.test(front);
const slug = path.basename(file, '.md');
check(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug), '파일명이 영문 슬러그(소문자·숫자·하이픈)가 아님');
const todayKST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const date = front.match(/^date:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1];
const lastmod = front.match(/^lastmod:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1];
check(date, 'date가 YYYY-MM-DD 형식이 아님');
check(!date || date <= todayKST, `date(${date})가 미래라 Hugo가 글을 숨김`);
check(!lastmod || !date || lastmod >= date, 'lastmod가 date보다 이름');
check(/^volatile:\s*(true|false)\s*$/m.test(front), 'volatile은 true 또는 false');
const title = front.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? '';
check(!/\b20\d{2}\b/.test(title), '제목에 연도가 들어 있음');
const description = front.match(/^description:\s*"?(.+?)"?\s*$/m)?.[1] ?? '';
check(!/정리(합니다|했습니다)\.?$|알아봅니다\.?$/.test(description), 'description이 "~정리합니다/알아봅니다"로 끝남');

// images
const root = path.join(path.dirname(file), '..', '..');
const GENERIC_ALT = /^(이미지|사진|그림|image|img|도식|표)\s*\d*$|관련 (이미지|사진)|^[^ ]+ (이미지|사진)$/i;
const pngInfo = p => {
  const buf = fs.readFileSync(p);
  const isPng = buf.slice(1, 4).toString() === 'PNG';
  return { kb: Math.round(buf.length / 1024), width: isPng ? buf.readUInt32BE(16) : null };
};
const checkImageFile = (rel, label) => {
  const abs = path.join(root, 'assets', rel);
  if (!fs.existsSync(abs)) { fails.push(`${label} 파일 없음: assets/${rel}`); return; }
  const { kb, width } = pngInfo(abs);
  check(kb <= 500, `${label} 용량 ${kb}KB — 500KB 이하로 압축`);
  warn(kb <= 200, `${label} 용량 ${kb}KB — 200KB 이하 권장`);
  if (width) warn(width <= 1500, `${label} 가로 ${width}px — 1200px 안팎으로 줄이기`);
  check(/^[a-z0-9]+(-[a-z0-9]+)*\.(png|jpe?g|webp)$/.test(path.basename(rel)), `${label} 파일명은 내용을 담은 영문 소문자·하이픈: ${path.basename(rel)}`);
};
const coverBlock = front.match(/^cover:\s*\n((?:[ \t]+.*\n?)+)/m)?.[1] ?? '';
const coverField = k => coverBlock.match(new RegExp(`^\\s+${k}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1] ?? '';
const coverImage = coverField('image'), coverAlt = coverField('alt'), coverCaption = coverField('caption');
check(coverImage === `images/${slug}/eli5-overview.png`, `cover.image는 "images/${slug}/eli5-overview.png"여야 함 (현재: ${coverImage || '없음'})`);
if (coverImage) checkImageFile(coverImage, 'cover 이미지');
check(coverAlt.length >= 10 && !GENERIC_ALT.test(coverAlt), `cover.alt가 비었거나 빈 말: "${coverAlt}"`);
check(coverCaption.length >= 10 && !GENERIC_ALT.test(coverCaption), `cover.caption이 비었거나 빈 말: "${coverCaption}"`);
check(!NUM.test(coverCaption.replace(DATE, '')) || /\]\(https?:/.test(coverCaption), 'cover.caption에 수치가 있는데 출처 링크가 없음');
check(fs.existsSync(path.join(root, 'research', `${slug}.eli5.json`)), `ELI5 스펙 없음: research/${slug}.eli5.json (render-eli5.mjs로 만든 이미지인지 확인 불가)`);

// title / sections
check(!/^#\s+\S/m.test(body), '본문에 "# 제목"(H1)이 있음 — Hugo가 front matter title로 H1을 이미 렌더링하므로 중복(PaperMod에서 H1 2개로 보임)');
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
const sectionText = name => {
  const start = body.indexOf(`## ${name}`);
  if (start === -1) return '';
  const next = body.indexOf('\n## ', start + 3);
  return body.slice(start, next === -1 ? undefined : next);
};
if (faqIdx !== -1) {
  const qs = sectionText(h2[faqIdx]).match(/^### Q/gm) ?? [];
  check(qs.length >= 3 && qs.length <= 5, `FAQ 질문이 ${qs.length}개 (3~5개여야 함)`);
}
warn(!sections.some(h => /(세|네|다섯|여섯|일곱|[3-9])\s*가지/.test(h)), `소제목에 "N가지" 분류가 있음 — 억지 분류인지 확인: ${sections.filter(h => /가지/.test(h)).join(' / ')}`);

// intro
const firstH2 = body.search(/^## /m);
const intro = body.slice(0, firstH2 === -1 ? undefined : firstH2);
const introBlocks = intro.split(/\n\s*\n/).filter(p => p.trim());
const introParas = introBlocks.filter(p => !/^\s*>/.test(p) && !/^\s*\[(경험 추가 필요|이미지 필요)/.test(p));
const summaryBox = introBlocks.find(p => /^\s*>\s*\*\*핵심 요약\*\*/.test(p));
check(summaryBox, '서론 직후(첫 ## 앞)에 "> **핵심 요약**" 박스가 없음');
if (summaryBox) {
  const boxLines = summaryBox.split('\n').map(l => l.replace(/^\s*>\s?/, '').trim()).filter(l => l && !/^\*\*핵심 요약\*\*$/.test(l));
  check(boxLines.length >= 1 && boxLines.length <= 3, `핵심 요약 박스 내용이 ${boxLines.length}줄 (1~3줄)`);
}
check(introParas.length >= 2 && introParas.length <= 3, `서론 문단이 ${introParas.length}개 (2~3개여야 함)`);
const basis = intro.match(/(\d{4})년 (\d{1,2})월 (\d{1,2})일 기준/);
check(basis, '서론에 "YYYY년 M월 D일 기준" 기준일 문장이 없음');
if (basis && lastmod) {
  const b = `${basis[1]}-${basis[2].padStart(2, '0')}-${basis[3].padStart(2, '0')}`;
  check(b === lastmod, `서론 기준일(${b})과 lastmod(${lastmod})가 다름 — 갱신 시 둘 다 바꿔야 함`);
}

// AI traces / honesty
check(!/알아보(겠|도록 하겠)습니다|살펴보(겠|도록 하겠)습니다|많은 (사람|분)들?이 관심/.test(body), '예고형·일반론 문장("알아보겠습니다", "많은 분이 관심" 등)이 있음');
const emptyClosing = body.match(/[^.\n]*(도움이 되(셨|었)(길|으면)|알아보았습니다|살펴보았습니다|이상으로)[^.\n]*/g) ?? [];
check(!emptyClosing.length, `공허한 맺음말: ${emptyClosing.map(s => s.trim().slice(0, 40)).join(' / ')}`);
const filler = body.match(/[^.\n]*(은행마다 다릅니다|상황에 따라 다를 수 있습니다|전문가와 상담하세요)[^.\n]*/g) ?? [];
check(!filler.length, `알맹이 없는 문장: ${filler.map(s => s.trim().slice(0, 40)).join(' / ')}`);
const fakePerson = body.match(/[^.\n]*(제 지인|지인 [가-힣]|[가-힣] ?씨는|한 수강생|제 친구|후배 [가-힣]|실제로 이런 (일|경우)가 많)[^.\n]*/g) ?? [];
check(!fakePerson.length, `가상 인물·확인 안 된 사례 의심: ${fakePerson.map(s => s.trim().slice(0, 40)).join(' / ')}`);
check(!/추천합니다|사야 합니다|수익(이|을) 보장/.test(body), '투자 권유 표현이 있음');
const tail = body.trim().split('\n').slice(-3).join('\n');
check(/투자 권유가 아닌 정보 제공/.test(tail), '글 끝에 투자 권유 아님 고지가 없음');
check(/^\|.+\|\s*\n\|\s*:?-{3,}/m.test(body), '마크다운 표가 없음');

const placeholders = body.match(/\[경험 추가 필요[^\]]*\]/g) ?? [];
if (isDraft) warn(placeholders.length > 0, '[경험 추가 필요] 자리가 0곳 — 사람의 경험이 들어갈 자리를 표시했는지 확인');
else check(!placeholders.length, `draft: false인데 [경험 추가 필요] ${placeholders.length}곳이 남아 있음`);

const abstract = body.match(/매우 중요한|다양한|효과적인|꼼꼼(히|하게)|필수적인|핵심적인/g) ?? [];
warn(abstract.length <= 3, `추상 형용사·부사 ${abstract.length}회(${[...new Set(abstract)].join(', ')}) — 수치·사례로 바꿀 수 있는지 확인`);

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
  const yesNoStart = faqAnswers.filter(a => /^(네|아닙니다|그렇습니다|그렇지 않습니다)[.,]/.test(a)).length;
  warn(yesNoStart <= Math.floor(faqAnswers.length / 2), `FAQ 답변 ${yesNoStart}/${faqAnswers.length}개가 "네/아닙니다"류로 시작 — 답마다 시작 방식을 다르게 할 수 있는지 확인`);
}

const openings = sections.map(h => {
  const t = sectionText(h);
  const first = t.split('\n').slice(1).find(l => l.trim());
  return (first ?? '').trim().slice(0, 12);
});
const sameOpeningPattern = openings.filter(o => /는 (단순히|단지)/.test(o)).length;
warn(sameOpeningPattern < 2, `소제목이 "OO는 단순히 ~" 패턴으로 ${sameOpeningPattern}번 시작함 — 여는 방식을 다르게(질문·장면·결론 등)`);

// boxes / tables / body images / walls of text
const boxes = body.split(/\n\s*\n/).filter(b => /^\s*>/.test(b));
check(boxes.length <= 2, `박스(인용블록)가 ${boxes.length}개 — 핵심 요약 + 주의/한 줄 정리 중 하나, 최대 2개`);
const tableCount = (body.match(/^\|.+\|\s*\n\|\s*:?-{3,}/gm) ?? []).length;
const plainChars = body.replace(/\]\([^)]*\)/g, ']').replace(/\s/g, '').length;
warn(tableCount <= Math.max(2, Math.round(plainChars / 1000)), `표 ${tableCount}개(글자 약 ${plainChars}자) — 도배인지 확인`);
const imgRe = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
const allLines = body.split('\n');
allLines.forEach((line, i) => {
  const m = line.match(imgRe);
  if (!m) { if (/!\[[^\]]*\]\(/.test(line)) fails.push(`이미지는 한 줄에 단독으로: ${line.trim().slice(0, 50)}`); return; }
  const [, alt, src] = m;
  if (/^https?:/.test(src)) { fails.push(`외부 이미지 URL 금지(저작권): ${src}`); return; }
  check(src.startsWith(`images/${slug}/`), `본문 이미지는 images/${slug}/ 아래에: ${src}`);
  checkImageFile(src, `본문 이미지 ${path.basename(src)}`);
  check(alt.length >= 10 && !GENERIC_ALT.test(alt), `이미지 alt가 비었거나 빈 말: ![${alt}](${src})`);
  const next = allLines.slice(i + 1).find(l => l.trim() !== '') ?? '';
  check(/^\*[^*].*\*\s*$/.test(next.trim()), `이미지 바로 아래 줄에 *캡션*이 없음: ${src}`);
});
const imagePlaceholders = body.match(/\[이미지 필요[^\]]*\]/g) ?? [];
check(imagePlaceholders.length <= 1, `[이미지 필요] 자리표시자 ${imagePlaceholders.length}개 — 최대 1개`);
imagePlaceholders.forEach(ph => check(/alt:/.test(ph) && /캡션:/.test(ph) && /images\//.test(ph), `[이미지 필요]에 파일명·alt·캡션이 모두 있어야 함: ${ph.slice(0, 50)}`));
if (!isDraft) check(!imagePlaceholders.length, `draft: false인데 [이미지 필요] ${imagePlaceholders.length}곳이 남아 있음`);
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
const bodyWithoutRefs = refsText ? body.replace(refsText, '') : body;
const mainText = bodyWithoutRefs.replace(faqText, '');
const mainLines = mainText.split('\n').filter(l => l.trim() && !/^#/.test(l) && !/^출처:/.test(l));
const listLines = mainLines.filter(l => /^\s*([-*]|\d+\.)\s/.test(l) || /^\s*\|/.test(l));
warn(listLines.length / Math.max(mainLines.length, 1) <= 0.5, `본문 줄의 ${Math.round(100 * listLines.length / mainLines.length)}%가 목록·표 — 정보 나열형인지 확인(설명 문장으로 이어 쓰기)`);

const hostOk = url => {
  try {
    const host = new URL(url).hostname;
    return ALLOWED_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
  } catch { return false; }
};
const uncited = [];
let inTable = false, tableHasNumber = false, tableStart = 0;
const bodyLines = bodyWithoutRefs.split('\n');
bodyLines.forEach((line, i) => {
  const isTableRow = /^\s*\|/.test(line);
  if (isTableRow) {
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

const bodyUrls = [...new Set([...bodyWithoutRefs.replace(/!\[[^\]]*\]\([^)]*\)/g, '').matchAll(linkRe)].map(m => m[1]))];
const refUrls = new Set([...refsText.matchAll(linkRe)].map(m => m[1]));
const allUrls = [...new Set([...bodyUrls, ...refUrls])];
check(refUrls.size > 0, '참고 자료에 링크가 없음');
const notInRefs = bodyUrls.filter(u => !refUrls.has(u));
check(!notInRefs.length, `본문에서 링크했지만 참고 자료에 없는 URL: ${notInRefs.join(', ')}`);
const badHosts = allUrls.filter(u => !hostOk(u));
check(!badHosts.length, `허용 목록에 없는 출처(공신력 확인 후 ALLOWED_DOMAINS에 추가): ${badHosts.join(', ')}`);

// research note
const researchPath = path.join(path.dirname(file), '..', '..', 'research', `${slug}.md`);
if (!fs.existsSync(researchPath)) {
  fails.push(`조사 노트 없음: research/${slug}.md`);
} else {
  const research = fs.readFileSync(researchPath, 'utf8');
  const missing = allUrls.filter(u => !research.includes(u));
  check(!missing.length, `글에서 링크했지만 조사 노트에 없는 URL(직접 읽지 않은 출처): ${missing.join(', ')}`);
  check(/^## 중복 판단/m.test(research), '조사 노트에 "## 중복 판단" 섹션 없음');
  check(/^## 경쟁 글 비교/m.test(research), '조사 노트에 "## 경쟁 글 비교" 섹션 없음');
  check(/^차별점:\s*\n\s*-\s*\S/m.test(research), '조사 노트에 차별점이 비어 있음');
  const bodyImages = [...body.matchAll(/^!\[[^\]]*\]\(([^)\s]+)\)/gm)].map(m => path.basename(m[1]));
  const undocumented = bodyImages.filter(f => !research.includes(f));
  check(!undocumented.length, `조사 노트 "## 이미지"에 만든 방법·데이터 출처가 없는 본문 이미지: ${undocumented.join(', ')}`);
}

const chars = body.replace(/\]\([^)]*\)/g, ']').replace(/\s/g, '').length;
const summary = `제목: ${title} | 글자 수(공백·URL 제외) 약 ${Math.round(chars / 100) * 100} | 소제목 ${sections.length}개 | 표 ${tableCount} · 박스 ${boxes.length} · 본문 이미지 ${(body.match(/^!\[/gm) ?? []).length} (+이미지 자리 ${imagePlaceholders.length}) | 출처 ${refUrls.size}개 | 경험 자리 ${placeholders.length}곳`;
const warnText = warns.map(w => `  ~ ${w}`).join('\n');
if (fails.length) {
  console.log(`FAIL ${file}\n${summary}`);
  fails.forEach(f => console.log(`- ${f}`));
  if (warns.length) console.log(`확인 권장:\n${warnText}`);
  process.exit(1);
}
console.log(`PASS ${file}\n${summary}`);
if (warns.length) console.log(`확인 권장:\n${warnText}`);
