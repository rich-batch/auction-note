// data/categories.json — 물건 분석 분류(아파트·빌라·상가·토지·자동차). 분류를 추가하려면 그 파일에 한 줄 추가.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.mjs';

const file = path.join(ROOT, 'data', 'categories.json');
export const CATEGORIES = JSON.parse(fs.readFileSync(file, 'utf8')).categories;
export const categoryBySlug = slug => CATEGORIES.find(c => c.slug === slug) ?? null;
export const categoryName = slug => categoryBySlug(slug)?.name ?? slug;
