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
import { researchPath, rel, todayKST } from '../lib/paths.mjs';
import { loadCase, isComputedFresh, knownAmounts } from '../lib/cases.mjs';
import { loadGlossary, relrefFor } from '../lib/glossary.mjs';
import { validateCase } from '../analysis/rights.mjs';
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
  check(a.title.includes(c.case.number), `제목에 사건번호(${c.case.number})가 없음 — 사건번호로 검색하는 독자가 찾을 수 있게`);
}
warn(a.title.length <= 36, `제목이 ${a.title.length}자 — 사건번호 포함 30자 안팎 권장: "${a.title}"`);

// 구조: 필수 소제목과 shortcode
const REQUIRED = [
  ['물건 개요', 'case-summary'],
  ['권리분석', 'case-rights'],
  ['임차인과 점유', null],
  ['입찰 전 확인할 것', null],
  ['매각 결과', 'case-result'],
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

// [확인 필요] 자리: computed.review를 사람이 확인하게 남긴다
const reviewMarks = body.match(/\[확인 필요[^\]]*\]/g) ?? [];
if (a.isDraft) warn(!(c?.computed?.review?.length) || reviewMarks.length > 0, `computed.review ${c?.computed?.review?.length}건이 있는데 본문에 [확인 필요: …] 자리가 없음`);
else check(!reviewMarks.length, `draft: false인데 [확인 필요] ${reviewMarks.length}곳이 남아 있음`);
const expMarks = body.match(/\[경험 추가 필요[^\]]*\]/g) ?? [];
if (!a.isDraft) check(!expMarks.length, `draft: false인데 [경험 추가 필요] ${expMarks.length}곳이 남아 있음`);

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
