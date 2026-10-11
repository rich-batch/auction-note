#!/usr/bin/env node
// main에 머지된 커밋에서 바뀐 글 중 draft: true인 것을 draft: false로 바꿔 커밋·푸시한다.
// 배포 워크플로(.github/workflows/publish.yml)가 main push 때 빌드 직전에 실행한다 — 그래서 "PR 머지 = 발행".
//   node tools/publish-merged.mjs [--dry-run]
// 머지한 PR에 "초안 유지" 라벨이 있으면 아무것도 바꾸지 않는다(코드만 먼저 넣고 글은 나중에 공개할 때).
// GITHUB_TOKEN으로 푸시한 커밋은 워크플로를 다시 깨우지 않으므로, 같은 실행 안에서 바로 빌드·배포된다.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const dry = process.argv.includes('--dry-run');
const run = (cmd, ...a) => execFileSync(cmd, a, { encoding: 'utf8' }).trim();

// 머지 커밋이면 첫 부모(머지 전 main)와 비교, 스쿼시·일반 커밋이면 직전 커밋과 비교
const files = run('git', 'diff', '--name-only', '--diff-filter=AM', 'HEAD^1', 'HEAD').split('\n')
  .filter(f => /^content\/(guide|analysis)\/[^/]+\/index\.md$/.test(f) && fs.existsSync(f));

const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
if (repo && sha) {
  try {
    const labels = run('gh', 'api', `repos/${repo}/commits/${sha}/pulls`, '--jq', '.[].labels[].name').split('\n');
    if (labels.includes('초안 유지')) { console.log('"초안 유지" 라벨이 붙은 PR이라 발행하지 않음'); process.exit(0); }
  } catch (e) { console.log(`PR 라벨 확인 실패(무시하고 진행): ${e.message.split('\n')[0]}`); }
}

const published = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  if (!/^draft:\s*true\s*$/m.test(text.split(/^---$/m)[1] ?? '')) continue;
  if (!dry) fs.writeFileSync(f, text.replace(/^draft:\s*true\s*$/m, 'draft: false'));
  published.push(f);
}

if (!published.length) { console.log('발행할 초안 없음'); process.exit(0); }
console.log(`발행: ${published.join(', ')}`);
if (dry) process.exit(0);
run('git', 'config', 'user.name', 'github-actions[bot]');
run('git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
run('git', 'add', ...published);
run('git', 'commit', '-m', `발행: ${published.length}편 (PR 머지로 자동 공개)\n\n${published.join('\n')}`);
run('git', 'push', 'origin', 'HEAD:main');
