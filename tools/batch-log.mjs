#!/usr/bin/env node
// 매일 배치(Claude 예약 작업 "auction-note-daily")의 실행 기록을 logs/batch/<KST 날짜>.json에 남기고 main에 푸시한다.
// GitHub Actions(.github/workflows/batch-watch.yml)가 매일 이 파일을 읽어 "배치 일지" 이슈에 결과를 남기고,
// 운영자는 그 이슈 알림 메일로 배치가 돌았는지·안 돌았는지 받는다.
//
//   node tools/batch-log.mjs start                    # 배치 시작할 때: status "running"
//   node tools/batch-log.mjs finish <요약.json>        # 배치 끝날 때: 요약을 합치고 status를 ok|warn으로
//
// 요약 JSON 형식(모든 필드 선택, 문자열은 짧게 — 공개 저장소라 이름·연락처 금지):
// {
//   "status": "ok" | "warn",
//   "steps": { "pull": {"status":"ok","note":""}, "results": {...}, "scan": {...}, "drafts": {...} },
//   "results": ["seoul-dongbu-2026ta50579 매각 12억 원"],   // 결과 반영한 사건
//   "prs": ["#90 서울 송파구 … 경매"],                       // 새 PR
//   "candidates": ["아파트 서울 강서구 … 최저 2억, 유찰 1"],  // 후보 상위
//   "errors": ["법원경매정보 BLOCKED (서울중앙)"],
//   "todo": ["#90 확인 후 머지"]
// }
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { todayKST } from './lib/paths.mjs';

const [cmd, summaryPath] = process.argv.slice(2);
if (!['start', 'finish'].includes(cmd)) { console.error('사용법: batch-log.mjs start | finish <요약.json>'); process.exit(2); }

const run = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const date = todayKST();
const file = path.join('logs', 'batch', `${date}.json`);
const now = new Date().toISOString();

run('pull', '--rebase', '--autostash', '-q');
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
let rec;
if (cmd === 'start') {
  rec = { date, status: 'running', started_at: now, runs: (prev.runs ?? 0) + 1 };
} else {
  const s = summaryPath ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')) : {};
  const status = s.status === 'ok' ? 'ok' : 'warn';
  rec = { ...prev, ...s, date, status, finished_at: now };
}
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
run('add', file);
run('commit', '-q', '-m', `배치 기록 ${date}: ${rec.status}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, '--', file); // 이 파일만 — 운영자가 스테이징해 둔 다른 변경은 섞지 않는다
for (let i = 0; i < 3; i++) {
  try { run('push', '-q'); console.log(`${file} → ${rec.status} (푸시함)`); process.exit(0); }
  catch { run('pull', '--rebase', '--autostash', '-q'); }
}
console.error(`${file}을 푸시하지 못함 — 감시 워크플로가 "기록 없음"으로 알릴 수 있다`);
process.exit(1);
