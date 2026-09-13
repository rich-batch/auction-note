#!/usr/bin/env node
// Usage (repo root): node .claude/skills/write-article/render-eli5.mjs research/<slug>.eli5.json
// Draws a 1200x630 ELI5 overview card from a JSON spec using plain shapes (no external images),
// writes research/<slug>.eli5.svg and assets/images/<slug>/eli5-overview.png via headless Chrome.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const specPath = process.argv[2];
if (!specPath) { console.error('사용법: render-eli5.mjs research/<slug>.eli5.json'); process.exit(2); }
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const slug = path.basename(specPath).replace(/\.eli5\.json$/, '');

const W = 1200, H = 630, M = 60;
const FONT = "'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif";
const C = { bg: '#FFF8EE', ink: '#1F2A37', muted: '#4B5563', faint: '#6B7280', accent: '#C2410C', soft: '#FDE7C7', card: '#FFFFFF', line: '#E7D8C3' };

// rough glyph widths in em: Hangul ~0.95, space ~0.3, others ~0.58
const textWidth = (s, px) => [...s].reduce((w, ch) => w + (/[ㄱ-힝]/.test(ch) ? 0.95 : ch === ' ' ? 0.3 : 0.58), 0) * px;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wrap(s, px, maxW, maxLines) {
  const words = s.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, px) <= maxW) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = w;
    while (textWidth(cur, px) > maxW) {
      let cut = [...cur];
      let head = '';
      while (cut.length && textWidth(head + cut[0], px) <= maxW) head += cut.shift();
      lines.push(head);
      cur = cut.join('');
    }
  }
  if (cur) lines.push(cur);
  return lines.length <= maxLines ? lines : null;
}

const errors = [];
const need = (ok, msg) => { if (!ok) errors.push(msg); };
const { title = '', analogy = '', steps = [], takeaway = '' } = spec;
const footer = spec.footer || '오늘의 경매 노트';
need(title, 'title 필요');
need(analogy, 'analogy(한 줄 비유) 필요');
need(Array.isArray(steps) && steps.length >= 3 && steps.length <= 4, 'steps는 3~4개');
need(takeaway, 'takeaway(기억할 한 가지) 필요');
const contentText = [title, analogy, takeaway, ...steps.flatMap(s => [s.label || '', s.desc || ''])].join(' ');
need(!/\d/.test(contentText), 'ELI5 이미지에는 숫자를 넣지 않는다(수치는 본문에서 출처와 함께). 순서 번호는 자동으로 붙는다');

const titlePx = 52, analogyPx = 28, labelPx = 30, descPx = 22, takePx = 30;
need(textWidth(title, titlePx) <= W - 2 * M, `title이 너무 김: "${title}"`);
need(textWidth(analogy, analogyPx) <= W - 2 * M, `analogy가 한 줄을 넘음: "${analogy}"`);

const n = steps.length || 3;
const gap = 44;
const boxW = (W - 2 * M - (n - 1) * gap) / n;
const boxY = 238, boxH = 206;
const stepLines = steps.map((s, i) => {
  need(s.label && textWidth(s.label, labelPx) <= boxW - 28, `steps[${i}].label이 칸을 넘음: "${s.label}"`);
  const d = s.desc ? wrap(s.desc, descPx, boxW - 28, 2) : [];
  need(d, `steps[${i}].desc가 두 줄을 넘음: "${s.desc}"`);
  return d || [];
});
const takeLabel = '기억할 한 가지';
const takeLabelW = textWidth(takeLabel, 22) + 36;
need(textWidth(takeaway, takePx) <= W - 2 * M - takeLabelW - 56, `takeaway가 한 줄을 넘음: "${takeaway}"`);

if (errors.length) {
  console.error(`FAIL ${specPath}`);
  errors.forEach(e => console.error(`- ${e}`));
  process.exit(1);
}

const parts = [];
parts.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);
const pill = '한 장 요약';
const pillW = textWidth(pill, 20) + 32;
parts.push(`<rect x="${M}" y="44" width="${pillW}" height="36" rx="18" fill="${C.accent}"/>`);
parts.push(`<text x="${M + pillW / 2}" y="68" font-size="20" font-weight="700" fill="#FFFFFF" text-anchor="middle">${esc(pill)}</text>`);
parts.push(`<text x="${M}" y="146" font-size="${titlePx}" font-weight="800" fill="${C.ink}">${esc(title)}</text>`);
parts.push(`<text x="${M}" y="194" font-size="${analogyPx}" fill="${C.muted}">${esc(analogy)}</text>`);

steps.forEach((s, i) => {
  const x = M + i * (boxW + gap);
  parts.push(`<rect x="${x}" y="${boxY}" width="${boxW}" height="${boxH}" rx="22" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>`);
  parts.push(`<circle cx="${x + 38}" cy="${boxY + 38}" r="20" fill="${C.accent}"/>`);
  parts.push(`<text x="${x + 38}" y="${boxY + 46}" font-size="22" font-weight="800" fill="#FFFFFF" text-anchor="middle">${i + 1}</text>`);
  parts.push(`<text x="${x + boxW / 2}" y="${boxY + 112}" font-size="${labelPx}" font-weight="700" fill="${C.ink}" text-anchor="middle">${esc(s.label)}</text>`);
  stepLines[i].forEach((line, j) => {
    parts.push(`<text x="${x + boxW / 2}" y="${boxY + 152 + j * 30}" font-size="${descPx}" fill="${C.muted}" text-anchor="middle">${esc(line)}</text>`);
  });
  if (i < n - 1) {
    const ax = x + boxW + 8, ay = boxY + boxH / 2;
    parts.push(`<path d="M${ax} ${ay} H${ax + gap - 16}" stroke="${C.accent}" stroke-width="4" stroke-linecap="round"/>`);
    parts.push(`<path d="M${ax + gap - 26} ${ay - 10} L${ax + gap - 16} ${ay} L${ax + gap - 26} ${ay + 10}" fill="none" stroke="${C.accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
});

const bandY = 474, bandH = 84;
parts.push(`<rect x="${M}" y="${bandY}" width="${W - 2 * M}" height="${bandH}" rx="18" fill="${C.soft}"/>`);
parts.push(`<rect x="${M + 20}" y="${bandY + 24}" width="${takeLabelW}" height="36" rx="18" fill="${C.card}"/>`);
parts.push(`<text x="${M + 20 + takeLabelW / 2}" y="${bandY + 49}" font-size="22" font-weight="700" fill="${C.accent}" text-anchor="middle">${esc(takeLabel)}</text>`);
parts.push(`<text x="${M + 20 + takeLabelW + 22}" y="${bandY + 53}" font-size="${takePx}" font-weight="700" fill="${C.ink}">${esc(takeaway)}</text>`);
parts.push(`<text x="${W - M}" y="${H - 34}" font-size="18" fill="${C.faint}" text-anchor="end">${esc(footer)}</text>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">\n${parts.join('\n')}\n</svg>\n`;
const svgOut = specPath.replace(/\.json$/, '.svg');
fs.writeFileSync(svgOut, svg);

const pngDir = path.join('assets', 'images', slug);
fs.mkdirSync(pngDir, { recursive: true });
const pngOut = path.join(pngDir, 'eli5-overview.png');
const chrome = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(p => fs.existsSync(p));
if (!chrome) { console.error('Chrome을 찾지 못함. CHROME 환경변수로 경로 지정'); process.exit(1); }
// Headless Chrome on macOS writes the screenshot but may never exit with a fresh profile,
// so wait for the PNG to appear and stop growing, then kill it.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'eli5-chrome-'));
fs.rmSync(pngOut, { force: true });
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic',
  `--user-data-dir=${profile}`, `--window-size=${W},${H}`, `--screenshot=${path.resolve(pngOut)}`,
  `file://${path.resolve(svgOut)}`,
], { stdio: 'ignore' });
let exited = false;
proc.on('exit', () => { exited = true; });
const started = Date.now();
let lastSize = -1;
while (true) {
  await new Promise(r => setTimeout(r, 500));
  const size = fs.existsSync(pngOut) ? fs.statSync(pngOut).size : -1;
  if (size > 0 && size === lastSize) break;
  lastSize = size;
  if (exited && size <= 0) { console.error('Chrome이 PNG를 만들지 못하고 종료됨'); process.exit(1); }
  if (Date.now() - started > 60000) { proc.kill('SIGKILL'); console.error('Chrome 렌더링 60초 초과'); process.exit(1); }
}
if (!exited) proc.kill('SIGKILL');
fs.rmSync(profile, { recursive: true, force: true });

const kb = Math.round(fs.statSync(pngOut).size / 1024);
console.log(`OK ${svgOut}\nOK ${pngOut} (${W}x${H}, ${kb}KB)`);
console.log(`cover.image: "images/${slug}/eli5-overview.png"`);
