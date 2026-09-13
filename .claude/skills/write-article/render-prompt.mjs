#!/usr/bin/env node
// Run from repo root.
//   render-prompt.mjs --list
//   render-prompt.mjs [--next 3] [--type info]      next N unwritten rows by priority
//   render-prompt.mjs --priority 5 [--type info]    one row
//   render-prompt.mjs --keyword "경매 입찰 방법"
//   render-prompt.mjs --priority 2 --revise        rewrite an existing post
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = path.dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const postsDir = 'content/posts';

const args = {};
const argv = process.argv.slice(2);
argv.forEach((a, i) => {
  if (a.startsWith('--')) args[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
});

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  const [header, ...body] = rows;
  return body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const outPath = r => path.join(postsDir, `${r.slug}.md`);
const exists = r => fs.existsSync(path.join(root, outPath(r)));

const rows = parseCSV(fs.readFileSync(path.join(root, 'keywords.csv'), 'utf8'))
  .sort((a, b) => Number(a.priority) - Number(b.priority));

const bad = rows.filter(r => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug ?? '') || !r.category);
if (bad.length) {
  console.error(`keywords.csv에 slug(영문 소문자·숫자·하이픈) 또는 category가 비었거나 잘못된 행: ${bad.map(r => r.priority).join(', ')}`);
  process.exit(1);
}

if (args.list) {
  for (const r of rows) console.log(`${r.priority.padStart(2)} | ${r.intent} | ${r.category} | ${r.keyword} | ${outPath(r)} | ${exists(r) ? '작성됨' : '-'}`);
  process.exit(0);
}

const type = typeof args.type === 'string' ? args.type : 'info';
const tplPath = path.join(skillDir, 'templates', `${type}.md`);
if (!fs.existsSync(tplPath)) {
  const types = fs.readdirSync(path.join(skillDir, 'templates')).map(f => f.replace(/\.md$/, ''));
  console.error(`템플릿 없음: ${type} (사용 가능: ${types.join(', ')})`);
  process.exit(1);
}
const tpl = fs.readFileSync(tplPath, 'utf8');

function existingPosts(excludeSlug) {
  const dir = path.join(root, postsDir);
  const lines = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== `${excludeSlug}.md`).sort()) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const title = text.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? f;
    const h2 = [...text.matchAll(/^## (.+)$/gm)].map(m => m[1].trim()).filter(h => !/자주 묻는 질문|참고 자료/.test(h));
    const body = text.replace(/^---[\s\S]*?\n---\n/, '').replace(/^# .*\n/m, '');
    const intro = body.split(/^## /m)[0].trim().split('\n')[0]?.slice(0, 60) ?? '';
    lines.push(`- ${title} | 소제목: ${h2.join(' / ') || '(없음)'} | 서론 첫 줄: ${intro}`);
  }
  return lines.join('\n') || '(없음)';
}

let targets, skipped = [];
if (args.priority || args.keyword) {
  const r = args.priority ? rows.find(r => r.priority === String(args.priority)) : rows.find(r => r.keyword === args.keyword);
  if (!r) { console.error(`keywords.csv에서 행을 찾지 못함: ${args.priority ?? args.keyword}`); process.exit(1); }
  targets = exists(r) && !args.revise ? (skipped.push(r), []) : [r];
} else {
  const n = Number(args.next ?? 3);
  targets = rows.filter(r => !exists(r)).slice(0, n);
  const lastP = targets.length ? Number(targets.at(-1).priority) : Infinity;
  skipped = rows.filter(r => exists(r) && Number(r.priority) <= lastP);
}

for (const r of skipped) console.log(`SKIPPED: priority=${r.priority} ${r.keyword} (${outPath(r)} 이미 있음)`);
if (!targets.length) { console.log('생성할 대상 없음'); process.exit(0); }

const related = r => rows
  .filter(o => o.category === r.category && o.slug !== r.slug)
  .map(o => `- ${o.priority} | ${o.keyword} | ${o.intent} | ${exists(o) ? '작성됨' : '미작성'}`)
  .join('\n') || '(없음)';
for (const r of targets) {
  const mode = args.revise && exists(r) ? 'revise' : 'new';
  const vars = {
    ...r,
    date: today(),
    created: exists(r) ? (fs.readFileSync(path.join(root, outPath(r)), 'utf8').match(/^date:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1] ?? today()) : today(),
    existing_posts: existingPosts(r.slug),
    related_keywords: related(r),
    my_experience: r.my_experience || '(없음 — 1인칭 경험 문장 금지, [경험 추가 필요: ...] 표시만)',
    research_path: `research/${r.slug}.md`,
  };
  console.log(`\n=== JOB mode=${mode} priority=${r.priority} keyword=${r.keyword} output=${outPath(r)} research=research/${r.slug}.md type=${type}`);
  console.log(tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m));
}
