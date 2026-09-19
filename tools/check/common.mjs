// 가이드·분석 검사가 함께 쓰는 규칙. 글 종류별 규칙은 guide.mjs / analysis.mjs에.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { parseArticlePath, readDraft, rel } from '../lib/paths.mjs';

// 인용 가능한 출처. 공식·1차 출처로 확인된 도메인만 추가한다.
export const ALLOWED_DOMAINS = [
  'go.kr',          // 정부·공공기관 전체 (law.go.kr, fsc.go.kr, easylaw.go.kr, scourt.go.kr, courtauction.go.kr, rt.molit.go.kr ...)
  'korea.kr',       // 대한민국 정책브리핑
  'bok.or.kr',      // 한국은행
  'kfb.or.kr',      // 은행연합회 (소비자포털 금리 공시)
  'khug.or.kr',     // 주택도시보증공사
  'kamco.or.kr',    // 한국자산관리공사
  'onbid.co.kr',    // 온비드
  'fss.or.kr',      // 금융감독원
];
export const hostOk = url => {
  try {
    const host = new URL(url).hostname;
    return ALLOWED_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
  } catch { return false; }
};

export const linkRe = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;
export const NUM = /\d[\d,.]*\s*(%|퍼센트|만\s*원|억|원|개월|주(?!택)|영업일|일|년|배|점|분의|㎡|평|세)/;
export const DATE = /\d{4}[년.\-]\s*\d{1,2}[월.\-]\s*\d{1,2}일?|\d{4}년 \d{1,2}월|\d{4}년/g;
export const GENERIC_ALT = /^(이미지|사진|그림|image|img|도식|표)\s*\d*$|관련 (이미지|사진)|^[^ ]+ (이미지|사진)$/i;
export const FILE_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*\.(png|jpe?g|webp)$/;

export function loadArticle(file, expectedType) {
  const where = parseArticlePath(file);
  if (!where || where.type !== expectedType) {
    console.error(`경로가 content/${expectedType}/<id>/index.md 형식이 아님: ${file}`);
    process.exit(2);
  }
  const text = fs.readFileSync(file, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  const front = fm?.[1] ?? '';
  const body = fm ? text.slice(fm[0].length) : text;
  return {
    ...where,
    file,
    dir: path.dirname(path.resolve(file)),
    text, fm, front, body,
    isDraft: /^draft:\s*true\s*$/m.test(front),
    date: front.match(/^date:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1],
    lastmod: front.match(/^lastmod:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1],
    title: front.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? '',
  };
}

export function createReport() {
  const fails = [], warns = [];
  return {
    fails, warns,
    check: (ok, msg) => { if (!ok) fails.push(msg); },
    warn: (ok, msg) => { if (!ok) warns.push(msg); },
  };
}

export function printReport(file, summary, r) {
  const warnText = r.warns.map(w => `  ~ ${w}`).join('\n');
  if (r.fails.length) {
    console.log(`FAIL ${file}\n${summary}`);
    r.fails.forEach(f => console.log(`- ${f}`));
    if (r.warns.length) console.log(`확인 권장:\n${warnText}`);
    process.exit(1);
  }
  console.log(`PASS ${file}\n${summary}`);
  if (r.warns.length) console.log(`확인 권장:\n${warnText}`);
}

export const sectionTextOf = body => name => {
  const start = body.indexOf(`## ${name}`);
  if (start === -1) return '';
  const next = body.indexOf('\n## ', start + 3);
  return body.slice(start, next === -1 ? undefined : next);
};

// 참고 자료 링크가 실제로 열리는지 (발행 직전)
export function verifyLinks(a) {
  const refsStart = a.body.search(/^## 참고 자료/m);
  const refsSection = refsStart !== -1 ? a.body.slice(refsStart) : '';
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
    console.error(`LINK FAIL: ${a.file}`);
    failed.forEach(([u, err]) => console.error(`- ${u} → ${err}`));
    process.exit(1);
  }
  console.log(`LINKS OK: ${a.file} (${refUrls.length}개 확인)`);
  process.exit(0);
}

// 이미지 파일은 글 폴더(page bundle) 안에, 파일명만으로 참조한다.
const pngInfo = p => {
  const buf = fs.readFileSync(p);
  const isPng = buf.slice(1, 4).toString() === 'PNG';
  return { kb: Math.round(buf.length / 1024), width: isPng ? buf.readUInt32BE(16) : null };
};
export function checkImageFile(a, r, name, label) {
  const abs = path.join(a.dir, name);
  if (!fs.existsSync(abs)) { r.fails.push(`${label} 파일 없음: ${rel(abs)}`); return; }
  const { kb, width } = pngInfo(abs);
  r.check(kb <= 500, `${label} 용량 ${kb}KB — 500KB 이하로 압축`);
  r.warn(kb <= 200, `${label} 용량 ${kb}KB — 200KB 이하 권장`);
  if (width) r.warn(width <= 1500, `${label} 가로 ${width}px — 1200px 안팎으로 줄이기`);
  r.check(FILE_NAME_RE.test(name), `${label} 파일명은 내용을 담은 영문 소문자·하이픈: ${name}`);
}

export function coverFields(front) {
  const coverBlock = front.match(/^cover:\s*\n((?:[ \t]+.*\n?)+)/m)?.[1] ?? '';
  const field = k => coverBlock.match(new RegExp(`^\\s+${k}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1] ?? '';
  return { image: field('image'), alt: field('alt'), caption: field('caption') };
}

export function checkCover(a, r, cover) {
  r.check(cover.image === 'eli5-overview.png', `cover.image는 "eli5-overview.png"(글 폴더 안 파일)여야 함 (현재: ${cover.image || '없음'})`);
  if (cover.image) checkImageFile(a, r, cover.image, 'cover 이미지');
  r.check(cover.alt.length >= 10 && !GENERIC_ALT.test(cover.alt), `cover.alt가 비었거나 빈 말: "${cover.alt}"`);
  r.check(cover.caption.length >= 10 && !GENERIC_ALT.test(cover.caption), `cover.caption이 비었거나 빈 말: "${cover.caption}"`);
  r.check(!NUM.test(cover.caption.replace(DATE, '')) || /\]\(https?:/.test(cover.caption), 'cover.caption에 수치가 있는데 출처 링크가 없음');
}

// 본문 이미지: 한 줄 단독, 글 폴더 안 파일, alt, 바로 아래 *캡션*
export function checkBodyImages(a, r) {
  const imgRe = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
  const allLines = a.body.split('\n');
  allLines.forEach((line, i) => {
    const m = line.match(imgRe);
    if (!m) { if (/!\[[^\]]*\]\(/.test(line)) r.fails.push(`이미지는 한 줄에 단독으로: ${line.trim().slice(0, 50)}`); return; }
    const [, alt, src] = m;
    if (/^https?:/.test(src)) { r.fails.push(`외부 이미지 URL 금지(저작권): ${src}`); return; }
    r.check(!src.includes('/'), `본문 이미지는 글 폴더(content/${a.type}/${a.id}/)에 두고 파일명만 쓴다: ${src}`);
    checkImageFile(a, r, path.basename(src), `본문 이미지 ${path.basename(src)}`);
    r.check(alt.length >= 10 && !GENERIC_ALT.test(alt), `이미지 alt가 비었거나 빈 말: ![${alt}](${src})`);
    const next = allLines.slice(i + 1).find(l => l.trim() !== '') ?? '';
    r.check(/^\*[^*].*\*\s*$/.test(next.trim()), `이미지 바로 아래 줄에 *캡션*이 없음: ${src}`);
  });
  const placeholders = a.body.match(/\[이미지 필요[^\]]*\]/g) ?? [];
  r.check(placeholders.length <= 1, `[이미지 필요] 자리표시자 ${placeholders.length}개 — 최대 1개`);
  placeholders.forEach(ph => r.check(/^\[이미지 필요: [a-z0-9-]+\.png/.test(ph) && /alt:/.test(ph) && /캡션:/.test(ph), `[이미지 필요: <파일명>.png | alt: … | 캡션: … | 구조: …] 형식이어야 함: ${ph.slice(0, 50)}`));
  if (!a.isDraft) r.check(!placeholders.length, `draft: false인데 [이미지 필요] ${placeholders.length}곳이 남아 있음`);
  return { bodyImages: (a.body.match(/^!\[/gm) ?? []).length, imagePlaceholders: placeholders.length };
}

// AI 흔적·정직성 (두 종류 공통)
export function checkHonesty(a, r) {
  const { body } = a;
  r.check(!/^#\s+\S/m.test(body), '본문에 "# 제목"(H1)이 있음 — Hugo가 front matter title로 H1을 이미 렌더링하므로 중복(PaperMod에서 H1 2개로 보임)');
  r.check(!/알아보(겠|도록 하겠)습니다|살펴보(겠|도록 하겠)습니다|많은 (사람|분)들?이 관심/.test(body), '예고형·일반론 문장("알아보겠습니다", "많은 분이 관심" 등)이 있음');
  const emptyClosing = body.match(/[^.\n]*(도움이 되(셨|었)(길|으면)|알아보았습니다|살펴보았습니다|이상으로)[^.\n]*/g) ?? [];
  r.check(!emptyClosing.length, `공허한 맺음말: ${emptyClosing.map(s => s.trim().slice(0, 40)).join(' / ')}`);
  const filler = body.match(/[^.\n]*(은행마다 다릅니다|상황에 따라 다를 수 있습니다|전문가와 상담하세요)[^.\n]*/g) ?? [];
  r.check(!filler.length, `알맹이 없는 문장: ${filler.map(s => s.trim().slice(0, 40)).join(' / ')}`);
  const fakePerson = body.match(/[^.\n]*(제 지인|지인 [가-힣]|[가-힣] ?씨는|한 수강생|제 친구|후배 [가-힣]|실제로 이런 (일|경우)가 많)[^.\n]*/g) ?? [];
  r.check(!fakePerson.length, `가상 인물·확인 안 된 사례 의심: ${fakePerson.map(s => s.trim().slice(0, 40)).join(' / ')}`);
  r.check(!/추천합니다|사야 합니다|수익(이|을) 보장/.test(body), '투자 권유 표현이 있음');
  r.check(!/투자 권유가 아닌 정보 제공/.test(body), '면책 문구는 사이트 템플릿(layouts/_partials/disclaimer*.html)이 모든 글 하단에 자동으로 붙인다. 본문에 중복해서 쓰지 마라');
  const abstract = body.match(/매우 중요한|다양한|효과적인|꼼꼼(히|하게)|필수적인|핵심적인/g) ?? [];
  r.warn(abstract.length <= 3, `추상 형용사·부사 ${abstract.length}회(${[...new Set(abstract)].join(', ')}) — 수치·사례로 바꿀 수 있는지 확인`);
}

// 개인을 특정할 수 있는 정보 (저장소·사이트 모두 공개)
export function checkPersonalInfo(a, r) {
  const hits = [
    [/\d{6}-[1-4]\d{6}/, '주민등록번호'],
    [/01[016789]-\d{3,4}-\d{4}/, '전화번호'],
    [/\d+동\s*\d+호/, '동·호수'],
    [/\d+(-\d+)?\s*번지/, '번지'],
    [/[가-힣]{2,4} ?씨(?=[\s,.)는가를의에와도]|$)/, '실명으로 보이는 호칭(○○ 씨)'],
  ].flatMap(([re, label]) => (a.body.match(new RegExp(re.source, 'g')) ?? []).map(m => `${label}: "${m}"`));
  r.check(!hits.length, `개인을 특정할 수 있는 정보: ${hits.join(' / ')} — 이름·번지·동호수는 가린다`);
}

// 서론: 핵심 요약 박스, 문단 수, 기준일 = lastmod
// basisDate: 서론 기준일이 맞아야 하는 날짜(기본 lastmod). basisLabel은 오류 메시지용.
export function checkIntro(a, r, { minParas = 2, maxParas = 3, basisDate = a.lastmod, basisLabel = 'lastmod' } = {}) {
  const firstH2 = a.body.search(/^## /m);
  const intro = a.body.slice(0, firstH2 === -1 ? undefined : firstH2);
  const introBlocks = intro.split(/\n\s*\n/).filter(p => p.trim());
  const introParas = introBlocks.filter(p => !/^\s*>/.test(p) && !/^\s*\[(경험 추가 필요|이미지 필요|확인 필요)/.test(p));
  const summaryBox = introBlocks.find(p => /^\s*>\s*\*\*핵심 요약\*\*/.test(p));
  r.check(summaryBox, '서론 직후(첫 ## 앞)에 "> **핵심 요약**" 박스가 없음');
  if (summaryBox) {
    const boxLines = summaryBox.split('\n').map(l => l.replace(/^\s*>\s?/, '').trim()).filter(l => l && !/^\*\*핵심 요약\*\*$/.test(l));
    r.check(boxLines.length >= 1 && boxLines.length <= 3, `핵심 요약 박스 내용이 ${boxLines.length}줄 (1~3줄)`);
  }
  r.check(introParas.length >= minParas && introParas.length <= maxParas, `서론 문단이 ${introParas.length}개 (${minParas}~${maxParas}개여야 함)`);
  const basis = intro.match(/(\d{4})년 (\d{1,2})월 (\d{1,2})일 기준/);
  r.check(basis, '서론에 "YYYY년 M월 D일 기준" 기준일 문장이 없음');
  if (basis && basisDate) {
    const b = `${basis[1]}-${basis[2].padStart(2, '0')}-${basis[3].padStart(2, '0')}`;
    r.check(b === basisDate, `서론 기준일(${b})과 ${basisLabel}(${basisDate})가 다름 — 갱신 시 둘 다 바꿔야 함`);
  }
}

export function checkDates(a, r, todayKST) {
  r.check(a.date, 'date가 YYYY-MM-DD 형식이 아님');
  r.check(!a.date || a.date <= todayKST, `date(${a.date})가 미래라 Hugo가 글을 숨김`);
  r.check(!a.lastmod || !a.date || a.lastmod >= a.date, 'lastmod가 date보다 이름');
  r.check(/^author:\s*"?rich-batch"?\s*$/m.test(a.front), 'front matter에 author: "rich-batch"가 없거나 다른 값');
  r.check(/^showToc:\s*true\s*$/m.test(a.front), 'front matter에 showToc: true 없음 (본문 ## 소제목이 4개 이상이라 목차가 필요하다)');
}

// 참고 자료: 본문 링크가 모두 참고 자료에 있고, 허용 도메인이며, 조사 노트에 있는 URL인가
export function checkReferences(a, r, { refsText, research }) {
  const bodyWithoutRefs = refsText ? a.body.replace(refsText, '') : a.body;
  const bodyUrls = [...new Set([...bodyWithoutRefs.replace(/!\[[^\]]*\]\([^)]*\)/g, '').matchAll(linkRe)].map(m => m[1]))];
  const refUrls = new Set([...refsText.matchAll(linkRe)].map(m => m[1]));
  const allUrls = [...new Set([...bodyUrls, ...refUrls])];
  r.check(refUrls.size > 0, '참고 자료에 링크가 없음');
  const notInRefs = bodyUrls.filter(u => !refUrls.has(u));
  r.check(!notInRefs.length, `본문에서 링크했지만 참고 자료에 없는 URL: ${notInRefs.join(', ')}`);
  const badHosts = allUrls.filter(u => !hostOk(u));
  r.check(!badHosts.length, `허용 목록에 없는 출처(공신력 확인 후 tools/check/common.mjs ALLOWED_DOMAINS에 추가): ${badHosts.join(', ')}`);
  if (research != null) {
    const missing = allUrls.filter(u => !research.includes(u));
    r.check(!missing.length, `글에서 링크했지만 조사 노트에 없는 URL(직접 읽지 않은 출처): ${missing.join(', ')}`);
  }
  return { refUrls, bodyWithoutRefs };
}

// 내부 링크는 relref로만. 대상 글이 있어야 하고, 발행 글이 초안을 가리키면 발행 빌드가 실패한다.
export function checkInternalLinks(a, r) {
  r.check(!/\]\(\/(guide|analysis|posts)\//.test(a.body), '내부 링크를 "/guide/..."처럼 직접 씀 — 하위 경로(/auction-note/)가 빠져 깨진다. {{< relref "/guide/<slug>" >}}를 쓴다');
  for (const m of a.body.matchAll(/\{\{<\s*relref\s+"\/(guide|analysis)\/([a-z0-9-]+)\/?"\s*>\}\}/g)) {
    const [, type, id] = m;
    const draft = readDraft(type, id);
    r.check(draft !== null, `relref 대상 글이 없음: /${type}/${id}`);
    if (draft !== null && !a.isDraft) r.check(!draft, `발행 글이 초안(/${type}/${id})을 링크함 — 발행 빌드에서 relref가 실패한다`);
  }
}
