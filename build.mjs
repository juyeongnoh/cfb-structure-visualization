/* =====================================================================
 * build.mjs — index.html + src/*.js + assets/styles.css 를
 *             자체 완결적인 단일 HTML 파일로 묶는다.
 *
 *   node build.mjs            → dist/cfb-visualizer.html
 *
 * 외부 요청은 Google Fonts 하나만 남긴다 (Artifact CSP가 허용하는 유일한 호스트).
 * ===================================================================== */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let html = read('index.html');

/* --- <link rel="stylesheet" href="assets/..."> → 인라인 <style> --- */
html = html.replace(
  /<link rel="stylesheet" href="((?!https?:)[^"]+)">/g,
  (_, href) => `<style>\n${read(href).trim()}\n</style>`
);

/* --- <script src="src/..."> → 인라인 <script> --- */
html = html.replace(
  /<script src="((?!https?:)[^"]+)"><\/script>/g,
  (_, src) => `<script>\n${read(src).trim()}\n</script>`
);

/* 남은 로컬 참조가 없는지 확인 */
const leftover = [...html.matchAll(/(?:src|href)="(?!https?:|#|data:)([^"]+)"/g)].map((m) => m[1]);
if (leftover.length) {
  console.error('인라인되지 않은 로컬 참조가 남았다:', leftover);
  process.exit(1);
}

mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/cfb-visualizer.html'), html);

const kb = (html.length / 1024).toFixed(1);
console.log(`dist/cfb-visualizer.html — ${kb} KB, 외부 요청: Google Fonts만`);
