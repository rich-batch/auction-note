#!/usr/bin/env node
// PR 본문에 들어갈 "머지 전 확인할 것" 체크박스 목록을 만든다. PR 검사(.github/workflows/pr-check.yml)와
// 자동 초안 PR(tools/auto/run-one.sh)이 쓴다.
//   node tools/pr-checklist.mjs <base-ref>                          변경 파일 기준으로 목록만 출력
//   node tools/pr-checklist.mjs <base-ref> --merge-into <본문 파일>  기존 PR 본문에 목록을 넣어 출력
//                                                                   (이미 체크한 칸은 체크 상태 유지)
// 글 안의 [확인 필요: …]·[경험 추가 필요: …]·[이미지 필요: …] 표시가 각각 한 칸이 된다 — 그 표시를 지워야
// PR 검사도 통과한다(발행 기준 검사).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const base = argv[0];
if (!base) { console.error('사용법: node tools/pr-checklist.mjs <base-ref> [--merge-into <file>]'); process.exit(2); }
const mergeIdx = argv.indexOf('--merge-into');
const oldBody = mergeIdx >= 0 && fs.existsSync(argv[mergeIdx + 1]) ? fs.readFileSync(argv[mergeIdx + 1], 'utf8') : '';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const changed = git('diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`).split('\n').filter(Boolean);

const ARTICLE = /^content\/(guide|analysis)\/([^/]+)\/index\.md$/;
const articles = changed.map(f => f.match(ARTICLE)).filter(Boolean);
const articleIds = new Set(articles.map(m => m[2]));
const cases = changed.filter(f => /^data\/cases\/.+\.json$/.test(f) && !articleIds.has(f.match(/([^/]+)\.json$/)[1]));
const code = changed.filter(f => /^(tools|layouts|assets|\.claude|\.github)\//.test(f) || f === 'hugo.toml');

const lines = [];
lines.push('<!-- checklist:start -->');
lines.push('## 머지 전 확인할 것');
lines.push('');
lines.push('**머지하면 아래 글이 자동으로 공개되고 사이트에 배포됩니다.** 모든 칸을 체크한 뒤 머지하세요.');
lines.push('아래 "PR 검사"가 빨간불이면 아직 지우지 않은 `[확인 필요]` 같은 표시나 깨진 링크가 남아 있다는 뜻입니다(검사 로그에 위치가 나옵니다).');
lines.push('');

for (const [file, type, id] of articles) {
  const text = fs.readFileSync(file, 'utf8');
  const front = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  const title = front.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? id;
  const kind = type === 'analysis' ? '물건 분석' : '가이드';
  lines.push(`### ${kind}: ${title}`);
  lines.push(`\`${file}\` · 미리보기: \`hugo server -D\` 실행 후 http://localhost:1313/auction-note/${type}/${id}/`);
  lines.push('');
  lines.push('- [ ] 본문을 처음부터 끝까지 읽었다');
  const marks = [...text.matchAll(/\[(확인 필요|경험 추가 필요|이미지 필요)(?::\s*([^\]]*))?\]/g)];
  for (const m of marks) {
    const what = (m[2] ?? '').replace(/\s+/g, ' ').trim();
    if (m[1] === '확인 필요') lines.push(`- [ ] **확인:** ${what} → 확인해서 본문에 반영하고 \`[확인 필요]\` 표시를 지운다`);
    if (m[1] === '경험 추가 필요') lines.push(`- [ ] **경험 자리 표시 지우기:** ${what} → 경험은 넣지 않으니 표시째 지운다(필요하면 그 문단을 다듬는다)`);
    if (m[1] === '이미지 필요') lines.push(`- [ ] **이미지:** ${what} → 직접 만든 이미지를 글 폴더에 넣고 표시를 지운다`);
  }
  if (type === 'analysis') {
    const casePath = `data/cases/${id}.json`;
    const c = fs.existsSync(casePath) ? JSON.parse(fs.readFileSync(casePath, 'utf8')) : null;
    const src = c?.source?.type === 'onbid' ? '온비드' : '법원경매정보';
    lines.push(`- [ ] ${src}의 최신 공고와 사건 데이터(감정가·최저가·매각기일·권리)가 같다 — 기일 변경·취하 여부 포함`);
    lines.push('- [ ] 본문 결론(인수할 권리가 있다/없다)이 글 속 "권리분석" 표와 같은 방향이다');
    lines.push('- [ ] "입찰 전 확인할 것"에 이 글이 확인하지 못한 것과 독자가 확인할 곳이 분명히 적혀 있다');
    if (c?.result?.outcome) lines.push(`- [ ] 매각 결과(${c.result.outcome}${c.result.winning_bid ? ` ${c.result.winning_bid.toLocaleString('ko-KR')}원` : ''}${c.result.bidders ? `, 응찰 ${c.result.bidders}명` : ''})가 ${src} 공개 결과와 같다`);
    const n = c?.market?.trades?.length ?? 0;
    if (n) lines.push(`- [ ] 비교 시세 ${n}건이 이 물건과 비슷하다 (${c.case.category === 'car' ? '연식·주행거리·트림' : '면적·층·단지'}) — 너무 다른 사례는 빼 달라고 요청`);
    lines.push('- [ ] 사람 이름이 없다 (주소·차량번호는 공개 정보라 괜찮음)');
  } else {
    lines.push('- [ ] 커버 이미지가 본문 내용과 맞다');
    lines.push('- [ ] 숫자(금리·한도·세율 등)가 참고 자료 링크의 원문과 같다');
  }
  lines.push('');
}

if (cases.length) {
  lines.push('### 사건 데이터만 바뀐 것');
  for (const f of cases) lines.push(`- [ ] \`${f}\` 바뀐 값이 공고와 같다`);
  lines.push('');
}
if (code.length) {
  lines.push('### 사이트·도구 코드');
  lines.push(`- [ ] 코드 ${code.length}개 파일 변경 — PR 검사(자동 테스트·빌드)가 초록불이다`);
  lines.push('');
}
if (!articles.length && !cases.length && !code.length) lines.push('_확인할 글·데이터·코드 변경이 없습니다._', '');
lines.push('<!-- checklist:end -->');

// 기존 본문과 합치기: 체크해 둔 칸은 그대로 두고, 목록 바깥에 사람이 쓴 내용도 보존
let out = lines.join('\n');
if (oldBody) {
  const checked = new Set([...oldBody.matchAll(/^- \[[xX]\] (.+)$/gm)].map(m => m[1].trim()));
  out = out.replace(/^- \[ \] (.+)$/gm, (all, item) => (checked.has(item.trim()) ? `- [x] ${item}` : all));
  const start = oldBody.indexOf('<!-- checklist:start -->');
  const end = oldBody.indexOf('<!-- checklist:end -->');
  out = start >= 0 && end > start
    ? oldBody.slice(0, start) + out + oldBody.slice(end + '<!-- checklist:end -->'.length)
    : `${oldBody.trim()}\n\n${out}`.trim();
}
console.log(out);
