#!/usr/bin/env node
// 매일 배치가 돌았는지 확인해 "배치 일지" 이슈에 결과를 남긴다(.github/workflows/batch-watch.yml이 실행).
// 저장소 주인을 @멘션하므로 GitHub가 주인의 계정 메일로 알림을 보낸다 — 배치가 안 돌았을 때도 알 수 있게
// 배치(이 Mac)와 상관없이 GitHub에서 돈다.
//   node tools/batch-watch.mjs [--date YYYY-MM-DD] [--dry-run]
//
// ✅ 기록 status "ok" / ⚠️ "warn" 또는 아직 "running"(멈춤 의심) / ❌ 오늘 기록 없음(안 돌았음)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { todayKST } from './lib/paths.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const date = args.includes('--date') ? args[args.indexOf('--date') + 1] : todayKST();
const owner = process.env.GITHUB_REPOSITORY_OWNER ?? 'rich-batch';
const file = `logs/batch/${date}.json`;
const LABEL = 'batch-log';
const TITLE = '배치 일지';

const rec = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
const md = date.slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/');
const list = (title, xs) => (xs?.length ? `\n**${title}**\n${xs.map(x => `- ${x}`).join('\n')}\n` : '');

let head, body = '';
if (!rec) {
  head = `❌ 경매 노트 배치 ${md} — 오늘 실행 기록이 없습니다`;
  body = '\n배치가 실행되지 않았거나 기록을 푸시하기 전에 멈췄습니다. Mac과 Claude 앱이 켜져 있었는지, 사이드바 "Scheduled"에 승인 대기·실패한 실행이 있는지 확인하세요.\n';
} else if (rec.status === 'running') {
  head = `⚠️ 경매 노트 배치 ${md} — 시작은 했지만 끝난 기록이 없습니다`;
  body = `\n${rec.started_at}에 시작한 뒤 결과를 남기지 않았습니다. 아직 도는 중이거나 중간에 멈췄습니다. 사이드바 "Scheduled"의 오늘 실행을 확인하세요.\n`;
} else {
  const ok = rec.status === 'ok';
  head = `${ok ? '✅' : '⚠️'} 경매 노트 배치 ${md} — 결과 ${rec.results?.length ?? 0}건 반영, PR ${rec.prs?.length ?? 0}건${ok ? '' : ', 문제 있음'}`;
  const steps = Object.entries(rec.steps ?? {}).map(([k, v]) => `| ${{ pull: '최신화', results: '결과 반영', scan: '후보 스캔', drafts: '분석 초안' }[k] ?? k} | ${v.status === 'ok' ? '✅' : '⚠️'} | ${v.note ?? ''} |`);
  body = (steps.length ? `\n| 단계 | 상태 | 메모 |\n|---|---|---|\n${steps.join('\n')}\n` : '')
    + list('문제', rec.errors) + list('새 PR', rec.prs) + list('결과 반영', rec.results) + list('할 일', rec.todo);
}
const comment = `@${owner} ${head}\n${body}\n<sub>기록: \`${file}\` · 확인: ${new Date().toISOString()}</sub>`;
console.log(comment);
if (dry) process.exit(0);

const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' }).trim();
try { gh('label', 'create', LABEL, '--color', '0e8a16', '--description', '매일 배치 실행 결과'); } catch { /* 이미 있음 */ }
let issue = gh('issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number', '--jq', '.[0].number');
if (!issue) {
  issue = gh('issue', 'create', '--title', TITLE, '--label', LABEL, '--body', '매일 배치(이 Mac의 Claude 예약 작업) 결과가 이 이슈에 댓글로 쌓입니다. 저장소 주인을 멘션하므로 GitHub 알림 메일로 받습니다. 이 이슈를 닫으면 다음 날 새 이슈가 열립니다.').split('/').pop();
}
gh('issue', 'comment', issue, '--body', comment);
// 실패한 날은 이슈 제목 옆에서도 보이게 라벨을 단다(성공한 날 떼어 낸다)
const bad = !rec || rec.status !== 'ok';
try { gh('issue', 'edit', issue, bad ? '--add-label' : '--remove-label', 'bug'); } catch { /* 라벨 문제는 무시 */ }
