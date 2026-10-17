#!/usr/bin/env node
// 물건 분석 글 검사.
//   node tools/check/analysis.mjs content/analysis/<id>/index.md
//   node tools/check/analysis.mjs content/analysis/<id>/index.md --verify-links
//
// 가이드 검사와 공통(AI 흔적·개인정보·이미지·참고 자료) + 분석 글 전용:
//   - front matter case = 폴더 이름 = data/cases/<id>.json, computed가 최신
//   - 표는 본문에 직접 쓰지 않고 shortcode(case-summary / case-rights / case-result)로
//   - 본문 금액은 사건 데이터에 있는 값(또는 그 합·차)이거나 같은 줄에 출처 링크
//   - 계산 결과와 반대되는 결론 금지, 입찰 권유·수익 기대 표현 금지
//   - computed.review 항목은 [확인 필요: …]로 남기고, 발행 전 사람이 지운다
import fs from 'node:fs';
import { researchPath, rel, todayKST, listArticles, articlePath } from '../lib/paths.mjs';
import { loadCase, isComputedFresh, knownAmounts } from '../lib/cases.mjs';
import { loadGlossary, relrefFor } from '../lib/glossary.mjs';
import { validateCase } from '../analysis/rights.mjs';
import { checkTitle } from '../lib/title.mjs';
import {
  linkRe, loadArticle, createReport, printReport, sectionTextOf, verifyLinks,
  coverFields, checkCover, checkBodyImages, checkHonesty, checkPersonalInfo, checkIntro, checkDates, checkReferences, checkInternalLinks,
} from './common.mjs';

const file = process.argv[2];
if (!file) { console.error('파일 경로를 넘겨라: content/analysis/<id>/index.md'); process.exit(2); }
const a = loadArticle(file, 'analysis');
const { front, body, fm, id } = a;
if (process.argv.includes('--verify-links')) verifyLinks(a);

const r = createReport();
const { check, warn } = r;

// front matter
check(fm, 'front matter(---)가 파일 맨 위에 없음');
for (const key of ['title', 'date', 'lastmod', 'draft', 'case', 'categories', 'tags', 'description']) {
  check(new RegExp(`^${key}:`, 'm').test(front), `front matter에 ${key} 없음`);
}
checkDates(a, r, todayKST());
const caseId = front.match(/^case:\s*"?([a-z0-9-]+)"?\s*$/m)?.[1];
check(caseId === id, `front matter case(${caseId ?? '없음'})가 글 폴더 이름(${id})과 다름`);
const description = front.match(/^description:\s*"?(.+?)"?\s*$/m)?.[1] ?? '';
check(!/정리(합니다|했습니다)\.?$|알아봅니다\.?$/.test(description), 'description이 "~정리합니다/알아봅니다"로 끝남');

// 사건 데이터
let c = null;
try { c = loadCase(id); } catch (e) { r.fails.push(e.message); }
if (c) {
  const errors = validateCase(c);
  check(!errors.length, `사건 데이터 검증 실패 — node tools/analysis/compute.mjs ${id}:\n    ${errors.join('\n    ')}`);
  check(isComputedFresh(c), `computed가 없거나 입력보다 오래됨 — node tools/analysis/compute.mjs ${id} 실행 후 글이 새 결과와 맞는지 확인`);
  // tags: [a, "b", …] 한 줄 형식(템플릿 형식)만 읽는다
  const tags = (/^tags:\s*\[(.*)\]\s*$/m.exec(front)?.[1] ?? '').split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const t = checkTitle(a.title, c, tags);
  t.fails.forEach(m => check(false, m));
  t.warns.forEach(m => warn(false, m));
}

// 구조: 필수 소제목과 shortcode
const REQUIRED = [
  ['물건 개요', 'case-summary'],
  ['권리분석', 'case-rights'],
  ['임차인과 점유', null],
  ['입찰 전 확인할 것', null],
  ['매각 결과', 'case-result'],
  ['확인 지표 요약', 'case-score'],
  ['참고 자료', null],
];
const h2 = [...body.matchAll(/^## (.+)$/gm)].map(m => m[1].trim());
const sectionText = sectionTextOf(body);
let lastIdx = -1;
for (const [name, shortcode] of REQUIRED) {
  const idx = h2.indexOf(name);
  check(idx !== -1, `"## ${name}" 섹션 없음`);
  if (idx === -1) continue;
  check(idx > lastIdx, `"## ${name}" 순서가 틀림 (${REQUIRED.map(x => x[0]).join(' → ')})`);
  lastIdx = idx;
  if (shortcode) check(new RegExp(`\\{\\{<\\s*${shortcode}\\s*>\\}\\}`).test(sectionText(name)), `"## ${name}" 안에 {{< ${shortcode} >}}가 없음 — 표는 사건 데이터에서 자동으로 그린다`);
}
check(h2.at(-1) === '참고 자료', '"## 참고 자료"가 마지막 섹션이 아님');
// 등기사항전부증명서는 유료라 이 블로그는 보지 않는다 — 참고 자료에 출처로 적거나 직접 본 것처럼 쓰면 독자를 속이게 된다
// (.claude/skills/analyze-case/SKILL.md "등기부를 보지 않는 분석"). 독자에게 열람을 권하는 문장은 괜찮다.
const refLines = sectionText('참고 자료').split('\n').filter(l => /등기사항(전부)?증명서|등기부/.test(l) && !/iros\.go\.kr|등기사항증명서 주요정보/.test(l)); // 인터넷등기소 링크(독자가 열람하는 곳), 온비드 공개 요약 표 이름("등기사항증명서 주요정보")은 허용
check(!refLines.length, `참고 자료에 등기사항전부증명서를 출처로 적음 — 이 블로그는 등기부를 보지 않는다(유료). 실제로 본 공개 자료(매각물건명세서 요약·현황조사서·공매재산명세)만 적는다: ${refLines.map(l => l.trim().slice(0, 60)).join(' / ')}`);
const sawRegistry = body.split(/(?<=[.!?다요])\s+/).filter(x => /등기부(를|에서)? ?(확인|열람|조회)(해 ?보니|한 결과|했더니|해 보면)|등기부상|등기사항전부증명서(를|에서)? (보니|확인한 결과)/.test(x));
check(!sawRegistry.length, `등기부를 직접 본 것처럼 읽히는 문장 — 출처는 "매각물건명세서에 따르면"처럼 공개 자료로 밝힌다: ${sawRegistry.map(x => x.trim().slice(0, 50)).join(' / ')}`);
check(!/^\|.+\|\s*\n\|\s*:?-{3,}/m.test(body), '본문에 마크다운 표를 직접 씀 — 사건 수치는 shortcode 표로만 보여 준다(데이터와 어긋나지 않게)');

// 서론: 기준일 = 사건 데이터 확인일(source.checked_at)
checkIntro(a, r, { minParas: 1, maxParas: 3, basisDate: c?.source?.checked_at, basisLabel: '사건 데이터 확인일(source.checked_at)' });
checkHonesty(a, r);
checkPersonalInfo(a, r);
checkInternalLinks(a, r);
const cover = coverFields(front);
if (cover.image) checkCover(a, r, cover);
const { bodyImages } = checkBodyImages(a, r);

// 입찰 권유·수익 기대
const advice = body.match(/[^.\n]*(입찰(을|해)?\s?(추천|권합니다|해 보세요|하세요|할 만)|수익(률)?(이|을)?\s?(예상|기대)|안전한 물건|깨끗한 물건|무조건|시세차익|저평가|싸게 (살|사는) 기회|예상 낙찰가)[^.\n]*/g) ?? [];
check(!advice.length, `입찰 권유·수익 기대로 읽히는 문장: ${advice.map(s => s.trim().slice(0, 40)).join(' / ')}`);

// 계산 결과와 반대되는 결론
if (c?.computed) {
  const k = c.computed;
  const hasBurden = k.ownership_risk || k.rights.some(x => ['인수', '검토'].includes(x.effect)) || k.tenants.some(t => t.assumed_max == null || t.assumed_max > 0);
  if (hasBurden) {
    const denial = body.match(/[^.\n]*인수(할|하는|되는)?\s?(권리|금액|보증금)(은|이|가|는)?\s?(전혀\s)?없[^.\n]*/g) ?? [];
    check(!denial.length, `계산 결과에는 인수·검토 대상이 있는데 "인수할 것이 없다"는 문장: ${denial.map(s => s.trim().slice(0, 50)).join(' / ')}`);
  } else {
    const claim = body.match(/[^.\n]*(매수인|낙찰자)(이|가)\s?(보증금|권리)[을를]?\s?(인수|떠안)[^.\n]*/g) ?? [];
    warn(!claim.length, `계산 결과는 인수 없음인데 인수한다는 문장이 있음(조건문인지 확인): ${claim.map(s => s.trim().slice(0, 50)).join(' / ')}`);
  }
}

// 찍어낸 글 방지: 애드센스는 사건만 바꿔 끼운 듯한 글 여러 편을 저품질·대량 생성 콘텐츠로 본다.
// (1) 서론 첫 문장 틀 (2) 다른 분석 글과 겹치는 문장 비율 (3) 카드 값을 되읽거나 내용 없는 상투 표현
const firstSentence = body.replace(/^\s+/, '').split('\n')[0];
check(!/^이 (글|사건)은/.test(firstSentence), `서론 첫 문장이 "${firstSentence.slice(0, 12)}…"로 시작함 — 이 사건에만 있는 사실로 연다(차종·건수·금액 등)`);
const stock = body.match(/[^.\n]*(단순합니다|하는 게 정확합니다|별도 확인이 필요합니다|지표는 (둘 다|모두) 만점)[^.\n]*/g) ?? [];
check(!stock.length, `상투 표현(카드 되읽기·내용 없는 문장): ${stock.map(x => x.trim().slice(0, 40)).join(' / ')}`);
// AI 말투: 주의 끌기·의미 정리 말버릇, 합쇼체/해요체 섞기, 같은 단서 반복 (템플릿 "사람이 쓴 글처럼")
{
  const prose = body.replace(/\{\{<[^>]*>\}\}/g, '').split(/^## 참고 자료/m)[0];
  const tics = prose.match(/[^.\n]*(눈에 띄는 (점|건|숫자)|주목할 (점|만한)|흥미로운 (점|건)|남는 문제는|관건은|여기서 중요한 (건|것은)|제일 먼저 보이는|어느 쪽이든|셈이(에요|다|입니다)|대목|그림이 그려|(가장|제일) 먼저 볼 것은|라는 점에서 의미가)[^.\n]*/g) ?? [];
  check(!tics.length, `AI 말버릇(주의 끌기·의미 정리 문장) — 할 말을 바로 하고 요약 맺음은 지운다: ${tics.map(x => x.trim().slice(0, 40)).join(' / ')}`);
  const ends = prose.split('\n').filter(l => !/^\s*(>|\||\{)/.test(l)).join(' ').replace(/\([^)]*\)/g, '').match(/[가-힣]{2}(다|요)(?=\.)/g) ?? [];
  const yo = ends.filter(x => x.endsWith('요') && !x.endsWith('세요')).length, da = ends.length - ends.filter(x => x.endsWith('요')).length; // 독자에게 권하는 "~하세요"는 합쇼체 글에서도 자연스러워 세지 않는다
  check(!(yo >= 3 && da >= 3), `합쇼체(~다 ${da}문장)와 해요체(~요 ${yo}문장)가 섞임 — 한 글은 합쇼체 한 가지로 쓴다`);
  const unchecked = (prose.match(/확인하지 못했/g) ?? []).length;
  check(unchecked <= 4, `"확인하지 못했"가 ${unchecked}번 — 입찰 전 확인할 것 첫머리에 한 번 밝히고 항목마다 되풀이하지 않는다(4번 이하)`);
  const bolds = (prose.match(/\*\*[^*\n]+\*\*/g) ?? []).filter(x => x !== '**핵심 요약**').length;
  warn(bolds <= 4, `굵은 글씨 ${bolds}곳 — 항목마다 굵은 머리말을 달지 말고 꼭 필요한 2~3곳만`);
}
{
  const plain = t => t.split(/^---$/m).slice(2).join('').replace(/\{\{<[^>]*>\}\}/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  const sentences = t => t.split(/(?<=[.다요])\s+|\n+/).map(x => x.replace(/[\s>*#\-\d]/g, '')).filter(x => x.length >= 25);
  const grams = x => { const g = new Set(); for (let i = 0; i < x.length - 5; i++) g.add(x.slice(i, i + 6)); return g; };
  const overlap = (x, y) => { let n = 0; for (const g of x) if (y.has(g)) n++; return n / Math.min(x.size, y.size); };
  const mine = sentences(plain(fs.readFileSync(file, 'utf8'))).map(grams);
  const others = listArticles('analysis').filter(o => o !== id)
    .flatMap(o => sentences(plain(fs.readFileSync(articlePath('analysis', o), 'utf8'))).map(grams));
  const dup = mine.filter(g => others.some(o => overlap(g, o) > 0.6)).length;
  const pct = mine.length ? Math.round((dup / mine.length) * 100) : 0;
  check(pct <= 30, `다른 분석 글과 거의 같은 문장이 ${dup}/${mine.length}개(${pct}%) — 30% 이하로. 일반론은 한두 문장+링크로 줄이고 이 사건 사실로 채운다`);
  warn(pct <= 15, `다른 분석 글과 거의 같은 문장 ${pct}% — 15% 이하 권장`);
}

// [확인 필요] 자리: computed.review를 사람이 확인하게 남긴다
const reviewMarks = body.match(/\[확인 필요[^\]]*\]/g) ?? [];
// 운영자는 [확인 필요]를 대신 확인할 수 없다 — 표시를 남기지 않고 "입찰 전 확인할 것"에 독자용 문장으로 쓴다
if (a.isDraft) warn(!reviewMarks.length, `[확인 필요] ${reviewMarks.length}곳 — 표시 대신 "이 글에서 확인하지 못했다 + 어디서 확인하는지"를 독자용 문장으로 쓴다`);
else check(!reviewMarks.length, `[확인 필요] ${reviewMarks.length}곳이 남아 있음 — 독자용 문장("이 글에서 확인하지 못했다 + 어디서 확인하는지")으로 바꾼다`);
if (h2.includes('입찰 전 확인할 것')) {
  const items = (sectionText('입찰 전 확인할 것').match(/^\s*(\d+\.|[-*])\s/gm) ?? []).length;
  const need = c?.computed?.review?.length ?? 0;
  check(items >= need, `"## 입찰 전 확인할 것" 항목 ${items}개 — 계산 도구가 사람 확인으로 넘긴 항목(review) ${need}개를 모두 옮겨야 함`);
}
const expMarks = body.match(/\[경험 추가 필요[^\]]*\]/g) ?? [];
// 운영자는 경험을 덧붙이지 않는다 — 경험 자리 표시는 만들지 않는다(초안이면 경고, 공개 기준이면 실패)
if (a.isDraft) warn(!expMarks.length, `[경험 추가 필요] ${expMarks.length}곳 — 경험 자리 표시는 쓰지 않는다. 지우고 사건 데이터로 채운다`);
else check(!expMarks.length, `[경험 추가 필요] ${expMarks.length}곳이 남아 있음 — 표시째 지운다(운영자는 경험을 덧붙이지 않는다)`);

// 참고 자료·조사 노트
const refsText = h2.includes('참고 자료') ? sectionText('참고 자료') : '';
const researchFile = researchPath('analysis', id);
const research = fs.existsSync(researchFile) ? fs.readFileSync(researchFile, 'utf8') : null;
if (research == null) r.fails.push(`조사 노트 없음: ${rel(researchFile)}`);
else {
  check(/^## 확인한 사실/m.test(research), '조사 노트에 "## 확인한 사실" 섹션 없음');
  check(/^## 확인하지 못한 것/m.test(research), '조사 노트에 "## 확인하지 못한 것" 섹션 없음');
}
const { refUrls, bodyWithoutRefs } = checkReferences(a, r, { refsText, research });

// 금액: 사건 데이터에 있는 값(또는 두 값의 합·차)이 아니면 같은 줄에 출처 링크
if (c) {
  const known = [...knownAmounts(c)];
  const derived = new Set(known);
  for (const x of known) for (const y of known) { derived.add(x + y); derived.add(Math.abs(x - y)); }
  const AMOUNT = /(?:(\d[\d,]*(?:\.\d+)?)\s*억\s*)?(?:(\d[\d,]*)\s*만\s*)?(\d[\d,]*)?\s*원/g;
  const toInt = s => Number((s ?? '0').replace(/,/g, ''));
  const unknown = [];
  bodyWithoutRefs.split('\n').forEach(line => {
    if (/^\s*#|\{\{</.test(line)) return;
    const cited = /\]\(https?:/.test(line);
    for (const m of line.matchAll(AMOUNT)) {
      if (!m[1] && !m[2] && !m[3]) continue;
      const v = Math.round(toInt(m[1]) * 1e8 + toInt(m[2]) * 1e4 + toInt(m[3]));
      if (v < 10000 || derived.has(v) || cited) continue;
      unknown.push(`"${m[0].trim()}" — ${line.trim().slice(0, 50)}`);
    }
  });
  check(!unknown.length, `사건 데이터에 없고 출처 링크도 없는 금액 ${unknown.length}곳 (데이터에 넣거나 출처를 달거나 빼라):\n    ${unknown.join('\n    ')}`);
}

// 용어 → 발행된 가이드 링크
const unlinked = loadGlossary()
  .filter(t => t.state === 'published' && body.includes(t.term) && !body.includes(relrefFor(t.guide)))
  .map(t => `${t.term} → ${relrefFor(t.guide)}`);
warn(!unlinked.length, `가이드가 있는 용어인데 링크가 없음(처음 나올 때 한 번): ${unlinked.join(', ')}`);

const chars = body.replace(/\{\{<[^>]*>\}\}/g, '').replace(/\]\([^)]*\)/g, ']').replace(/\s/g, '').length;
const summary = `제목: ${a.title} | 글자 수(공백·URL 제외) 약 ${Math.round(chars / 100) * 100} | 소제목 ${h2.length}개 | 본문 이미지 ${bodyImages} | 출처 ${refUrls.size}개 | 확인 필요 ${reviewMarks.length}곳 (계산 도구 review ${c?.computed?.review?.length ?? '?'}건)`;
printReport(file, summary, r);
