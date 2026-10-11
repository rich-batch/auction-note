#!/usr/bin/env node
// main에 머지된 PR의 글 중 아직 draft: true인 것을 draft: false로 바꿔 커밋·푸시한다.
// 배포 워크플로(.github/workflows/publish.yml)가 main push 때 빌드 직전에 실행한다 — 그래서 "PR 머지 = 발행".
//   node tools/publish-merged.mjs [--dry-run]
//
// 이번 push의 커밋만 보지 않고, 이 스크립트가 처음 들어온 커밋 이후 main에 머지된 PR 전부를 다시 본다.
// 배포 워크플로는 새 push가 오면 진행 중인 실행을 취소하므로(concurrency), PR을 연달아 머지하면 앞 실행이
// 공개 단계 전에 취소될 수 있다 — 그래도 마지막 실행이 앞선 머지까지 함께 공개하도록. 이미 공개된 글은 건너뛰니
// 여러 번 돌아도 결과가 같다.
// - PR이 아닌 main 직접 커밋에 들어 있는 글은 공개하지 않는다(글은 PR로만 공개).
// - 머지한 PR에 "초안 유지" 라벨이 있으면 그 PR의 글은 공개하지 않는다.
// GITHUB_TOKEN으로 푸시한 커밋은 워크플로를 다시 깨우지 않으므로, 같은 실행 안에서 바로 빌드·배포된다.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const dry = process.argv.includes('--dry-run');
const run = (cmd, ...a) => execFileSync(cmd, a, { encoding: 'utf8' }).trim();
const repo = process.env.GITHUB_REPOSITORY;
const ARTICLE = /^content\/(guide|analysis)\/[^/]+\/index\.md$/;

// 기준: 이 스크립트를 처음 추가한 커밋(자동 공개를 도입한 시점). 그 전 머지는 예전 방식이라 건드리지 않는다.
const since = run('git', 'log', '--diff-filter=A', '--format=%H', '--', 'tools/publish-merged.mjs').split('\n').pop();
const commits = run('git', 'rev-list', '--first-parent', `${since}..HEAD`).split('\n').filter(Boolean);

// 커밋 → 그 커밋으로 머지된 PR(머지 커밋·스쿼시 모두). PR이 아니면 null.
function prOf(sha) {
  if (!repo) return null;
  try {
    const prs = JSON.parse(run('gh', 'api', `repos/${repo}/commits/${sha}/pulls`));
    return prs.find(p => p.merge_commit_sha === sha) ?? null;
  } catch (e) { console.log(`PR 확인 실패(${sha.slice(0, 7)}, 건너뜀): ${e.message.split('\n')[0]}`); return null; }
}

const targets = new Set();
for (const sha of commits) {
  const files = run('git', 'diff', '--name-only', '--diff-filter=AM', `${sha}^1`, sha).split('\n').filter(f => ARTICLE.test(f));
  if (!files.length) continue;
  const pr = prOf(sha);
  if (!pr) continue;
  if (pr.labels?.some(l => l.name === '초안 유지')) { console.log(`#${pr.number}: "초안 유지" 라벨 — 공개하지 않음`); continue; }
  files.forEach(f => targets.add(f));
}

const published = [];
for (const f of targets) {
  if (!fs.existsSync(f)) continue;
  const text = fs.readFileSync(f, 'utf8');
  if (!/^draft:\s*true\s*$/m.test(text.split(/^---$/m)[1] ?? '')) continue;
  if (!dry) fs.writeFileSync(f, text.replace(/^draft:\s*true\s*$/m, 'draft: false'));
  published.push(f);
}

if (!published.length) { console.log('공개할 초안 없음'); process.exit(0); }
console.log(`공개: ${published.join(', ')}`);
if (dry) process.exit(0);
run('git', 'config', 'user.name', 'github-actions[bot]');
run('git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
run('git', 'add', ...published);
run('git', 'commit', '-m', `발행: ${published.length}편 (PR 머지로 자동 공개)\n\n${published.join('\n')}`);
// 그사이 main이 앞서 갔으면(연달아 머지) 그 위로 옮겨서 푸시한다
for (let i = 0; i < 3; i++) {
  try { run('git', 'push', 'origin', 'HEAD:main'); process.exit(0); } catch {
    run('git', 'fetch', 'origin', 'main');
    run('git', 'rebase', 'origin/main');
  }
}
throw new Error('main에 푸시하지 못함 — 다음 배포 실행이 다시 시도한다');
